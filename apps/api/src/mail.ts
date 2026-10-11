import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "@opulya/shared";

export const mailSettingsSchema = z.object({
  EMAIL_TRANSPORT: z.enum(["resend", "test"]).default("resend"),
  RESEND_API_KEY: z.string().trim().default(""),
  EMAIL_FROM: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .refine((v) => !/[\r\n]/.test(v))
    .default("Opulya <onboarding@resend.dev>"),
  EMAIL_VERIFICATION_MINUTES: z.coerce
    .number()
    .int()
    .min(10)
    .max(1440)
    .default(60),
  EMAIL_TEST_OUTBOX_DIR: z.string().optional(),
});
export type VerificationMail = {
  to: string;
  firstName: string;
  locale: string;
  verificationUrl: string;
  minutes: number;
};
const labels = {
  en: {
    subject: "Verify your Opulya email",
    title: "Verify your email",
    hello: "Hello",
    body: "Confirm your email and choose your final password to activate your Opulya account.",
    action: "Verify email",
    expiry: "This link expires in {minutes} minutes and works once.",
    ignore:
      "If you did not request an Opulya account or verification, ignore this email. Your account will not be activated.",
  },
  hr: {
    subject: "Potvrdite svoju Opulya e-mail adresu",
    title: "Potvrdite e-mail adresu",
    hello: "Pozdrav",
    body: "Potvrdite svoju e-mail adresu i odaberite konačnu lozinku kako biste aktivirali svoj Opulya račun.",
    action: "Potvrdi e-mail",
    expiry: "Poveznica istječe za {minutes} minuta i vrijedi jednom.",
    ignore:
      "Ako niste zatražili Opulya račun ili potvrdu, zanemarite ovu poruku. Vaš račun neće biti aktiviran.",
  },
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export function verificationMessage(mail: VerificationMail) {
  const text = mail.locale === "hr" ? labels.hr : labels.en;
  const expiry = text.expiry.replace("{minutes}", String(mail.minutes));
  return {
    subject: text.subject,
    text: `${text.hello} ${mail.firstName},\n\n${text.body}\n\n${mail.verificationUrl}\n\n${expiry}\n\n${text.ignore}`,
    html: `<html lang="${mail.locale === "hr" ? "hr" : "en"}"><body style="font-family:Arial,sans-serif;color:#253238;line-height:1.6"><h1 style="color:#075c49;font-size:28px">Opulya</h1><h2>${text.title}</h2><p>${text.hello} ${escapeHtml(mail.firstName)},</p><p>${text.body}</p><p><a href="${escapeHtml(mail.verificationUrl)}" style="color:#075c49">${text.action}</a></p><p>${expiry}</p><p>${text.ignore}</p></body></html>`,
  };
}
@Injectable()
export class MailService {
  readonly settings = mailSettingsSchema.parse(process.env);
  private readonly outbox = new Map<string, VerificationMail>();
  constructor() {
    if (
      this.settings.EMAIL_TRANSPORT === "test" &&
      (process.env.NODE_ENV !== "test" ||
        !process.env.DATABASE_URL ||
        new URL(process.env.DATABASE_URL).pathname !== "/opulya_test")
    )
      throw new Error(
        "Test mail transport requires NODE_ENV=test and opulya_test",
      );
  }
  assertReady() {
    if (
      this.settings.EMAIL_TRANSPORT !== "test" &&
      !this.settings.RESEND_API_KEY
    )
      throw new ServiceUnavailableException("MAIL_NOT_CONFIGURED");
  }
  testMail(email: string) {
    if (this.settings.EMAIL_TRANSPORT !== "test")
      throw new Error("Test mailbox unavailable");
    return this.outbox.get(email.trim().toLowerCase());
  }
  async sendVerification(mail: VerificationMail) {
    this.assertReady();
    const message = verificationMessage(mail);
    if (this.settings.EMAIL_TRANSPORT === "test") {
      this.outbox.set(mail.to, mail);
      if (this.settings.EMAIL_TEST_OUTBOX_DIR) {
        await mkdir(this.settings.EMAIL_TEST_OUTBOX_DIR, {
          recursive: true,
          mode: 0o700,
        });
        const name = createHash("sha256").update(mail.to).digest("hex");
        await writeFile(
          join(this.settings.EMAIL_TEST_OUTBOX_DIR, `${name}.json`),
          JSON.stringify(mail),
          { mode: 0o600 },
        );
      }
      return;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.settings.EMAIL_FROM,
        to: [mail.to],
        ...message,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException("EMAIL_DELIVERY_FAILED");
    const receipt = z
      .object({ id: z.string().min(1).max(200) })
      .safeParse(await response.json());
    if (!receipt.success)
      throw new ServiceUnavailableException("EMAIL_DELIVERY_FAILED");
  }
}
