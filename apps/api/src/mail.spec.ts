import { afterEach, describe, expect, it, vi } from "vitest";
import { MailService, verificationMessage } from "./mail.js";
const message = {
  to: "owner@example.test",
  firstName: '<img src=x onerror="alert(1)">',
  locale: "en",
  verificationUrl: "https://app.example.test/verify-email#token=abc",
  minutes: 60,
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("verification email transport", () => {
  it("escapes user names, localizes mail, and does not include a password", () => {
    const rendered = verificationMessage(message);
    expect(rendered.html).toContain("&lt;img");
    expect(rendered.html).not.toContain("<img src=x");
    expect(verificationMessage({ ...message, locale: "hr" }).subject).toBe(
      "Potvrdite svoju Opulya e-mail adresu",
    );
    expect(rendered.text).toContain("60 minutes");
  });
  it("refuses unconfigured real sending and rejects production test transport", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(() => new MailService().assertReady()).toThrow(
      "MAIL_NOT_CONFIGURED",
    );
    vi.stubEnv("EMAIL_TRANSPORT", "test");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new MailService()).toThrow("Test mail transport requires");
  });
  it("rejects the test transport against the main database", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "test");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://local:local@localhost/opulya");
    expect(() => new MailService()).toThrow("Test mail transport requires");
  });
  it("uses the Resend REST API without exposing provider errors", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "resend");
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "test-message" }),
    });
    vi.stubGlobal("fetch", fetch);
    await new MailService().sendVerification(message);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.any(Object),
    );
    const [call] = fetch.mock.calls;
    if (!call) throw new Error("Expected a verification email request");
    const options = call[1];
    expect(options.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(options.body).to).toEqual([message.to]);
    fetch.mockResolvedValue({ ok: false });
    await expect(new MailService().sendVerification(message)).rejects.toThrow(
      "EMAIL_DELIVERY_FAILED",
    );
  });
});
