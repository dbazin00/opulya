import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  EMAIL_SENDS_PER_HOUR: z.coerce.number().int().min(0).max(100000).default(20),
  EMAIL_SENDS_PER_DAY: z.coerce.number().int().min(0).max(100000).default(80),
  EMAIL_TEST_OUTBOX_DIR: z.string().optional(),
});
export type VerificationMail = {
  to: string;
  firstName: string;
  locale: string;
  verificationUrl: string;
  minutes: number;
};
const logoContentId = "opulya-logo";
const labels = {
  en: {
    subject: "Verify your Opulya email",
    title: "Verify your email",
    hello: "Hello",
    body: "Confirm your email and choose your final password to activate your Opulya account.",
    action: "Verify email",
    preview: "Confirm your email to finish setting up your Opulya account.",
    tagline: "Your finances, in perspective.",
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
    preview:
      "Potvrdite e-mail adresu i dovršite postavljanje svojeg Opulya računa.",
    tagline: "Vaše financije, u perspektivi.",
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
  const verificationUrl = new URL(mail.verificationUrl);
  const link = escapeHtml(verificationUrl.toString());
  return {
    subject: text.subject,
    text: `Opulya\n\n${text.hello} ${mail.firstName},\n\n${text.body}\n\n${text.action}:\n${verificationUrl.toString()}\n\n${expiry}\n\n${text.ignore}\n\n${text.tagline}`,
    // Presentation tables and inline styles keep the layout usable in mail clients without app CSS.
    html: `<!doctype html>
<html lang="${mail.locale === "hr" ? "hr" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${text.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f5;color:#253238;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${text.preview}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f7f5;">
    <tr><td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #dfe6e2;border-top:3px solid #b18d48;border-radius:8px;">
        <tr><td style="padding:28px 24px 24px;border-bottom:1px solid #e8edea;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-right:12px;vertical-align:middle;"><img src="cid:${logoContentId}" alt="" width="48" height="48" style="display:block;width:48px;height:48px;border:0;object-fit:contain;"></td>
              <td style="vertical-align:middle;color:#075c49;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:40px;">Opulya</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:28px 24px 32px;">
          <h1 style="margin:0 0 24px;font-size:24px;line-height:32px;font-weight:700;color:#253238;">${text.title}</h1>
          <p style="margin:0 0 12px;font-size:16px;line-height:26px;">${text.hello} ${escapeHtml(mail.firstName)},</p>
          <p style="margin:0 0 24px;font-size:16px;line-height:26px;">${text.body}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
            <tr><td align="center" bgcolor="#075c49" style="border-radius:6px;mso-padding-alt:14px 24px;">
              <a href="${link}" style="display:inline-block;padding:14px 24px;border:1px solid #075c49;border-radius:6px;color:#ffffff;background-color:#075c49;font-size:16px;line-height:22px;font-weight:700;text-align:center;text-decoration:none;">${text.action}</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:14px;line-height:22px;color:#5b6d66;">${expiry}</p>
        </td></tr>
        <tr><td style="padding:20px 24px;border-top:1px solid #e8edea;">
          <p style="margin:0;font-size:12px;line-height:20px;color:#5b6d66;">${text.ignore}</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="margin:20px 0 0;color:#5b6d66;font-family:Georgia,'Times New Roman',serif;font-size:14px;line-height:22px;">${text.tagline}</p>
    </td></tr>
  </table>
</body>
</html>`,
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
        attachments: [
          {
            filename: "opulya-mark.png",
            content_type: "image/png",
            content_id: logoContentId,
            content: (
              await readFile(
                new URL("../assets/opulya-mark.png", import.meta.url),
              )
            ).toString("base64"),
          },
        ],
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
