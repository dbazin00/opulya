import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import {
  signupSchema,
  signupPasswordSchema,
  termsVersion,
} from "@opulya/shared";
import { Database } from "../src/db.js";
import { MailService } from "../src/mail.js";

// Fixture-only captured mail must not exhaust the shared test database's delivery budget.
process.env.EMAIL_SENDS_PER_HOUR = "10000";
process.env.EMAIL_SENDS_PER_DAY = "10000";

// Financial fixtures authenticate through the real signup, verification and login endpoints.
export function signupRequestBody(body: unknown) {
  if (!body || typeof body !== "object") return body;
  const registration: Record<string, unknown> = {
    acceptTerms: true,
    termsVersion,
    ...body,
  };
  // Fixture credentials are only used by verification and login, never by signup.
  delete registration.password;
  return registration;
}

export async function completeTestSignup(
  app: INestApplication,
  url: string,
  body: unknown,
) {
  const input = signupSchema
      .extend({ password: signupPasswordSchema })
      .parse({
        acceptTerms: true,
        termsVersion,
        ...(body as Record<string, unknown>),
      }),
    db = app.get(Database),
    mail = app.get(MailService);
  if (
    new URL(process.env.DATABASE_URL!).pathname !== "/opulya_test" ||
    process.env.NODE_ENV !== "test"
  )
    throw new Error("Dedicated test database required");
  const user = await db.user.findUniqueOrThrow({
    where: { email: input.email },
  });
  const headers = {
    Origin: process.env.WEB_ORIGIN!,
    "X-Opulya-Request": "1",
    "Content-Type": "application/json",
  };
  if (!user.emailVerifiedAt) {
    const message = mail.testMail(input.email);
    assert.ok(message, "Verification mail must be captured");
    const token = new URLSearchParams(
      new URL(message.verificationUrl).hash.slice(1),
    ).get("token");
    const verified = await fetch(`${url}/api/auth/verify-email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token, password: input.password }),
    });
    assert.equal(verified.status, 201);
  }
  const login = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  assert.equal(login.status, 201);
  return {
    status: login.status,
    body: await login.json(),
    cookie: login.headers.get("set-cookie")?.split(";")[0],
    headers: login.headers,
  };
}
