import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { MailService } from "./mail.js";
config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const mail = new MailService();
try {
  mail.assertReady();
  const origin = new URL(process.env.WEB_ORIGIN ?? "");
  if (
    origin.origin !== process.env.WEB_ORIGIN ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
  )
    throw new Error("Invalid public application origin");
  console.log(
    "Email configuration is present. This check does not send mail or validate credentials with Resend.",
  );
} catch {
  console.log(
    "Email configuration is incomplete. Set RESEND_API_KEY, EMAIL_FROM and the exact WEB_ORIGIN in the backend environment.",
  );
  process.exitCode = 1;
}
