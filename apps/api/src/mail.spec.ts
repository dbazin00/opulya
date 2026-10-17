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
  it("references an embedded logo without a remote image request", () => {
    const rendered = verificationMessage(message);
    expect(rendered.html).toContain('src="cid:opulya-logo"');
    expect(rendered.html.match(/<img[^>]+>/g)).toHaveLength(1);
    expect(rendered.html.match(/<img[^>]+>/g)?.[0]).not.toContain("token=");
    expect(rendered.html).not.toContain("data:image");
    expect(rendered.html).not.toMatch(/<img[^>]*src="https?:/);
    expect(rendered.html).toContain('role="presentation"');
    expect(rendered.html).toContain('name="viewport"');
  });
  it("shows only the verification button in HTML and keeps the plain-text link", () => {
    const rendered = verificationMessage(message);
    expect(rendered.html).toContain(
      'href="https://app.example.test/verify-email#token=abc"',
    );
    expect(rendered.html).toMatch(
      /<a [^>]*padding:14px 24px[^>]*>Verify email<\/a>/,
    );
    expect(rendered.html).not.toContain("If the button does not work");
    expect(rendered.html.match(/<a\s/g)).toHaveLength(1);
    expect(rendered.html).not.toContain(`>${message.verificationUrl}</a>`);
    expect(rendered.text).toContain(
      `Verify email:\n${message.verificationUrl}`,
    );
    expect(rendered.text).not.toContain("<table");
  });
  it("localizes the button and expiry, with English for unknown locales", () => {
    const hr = verificationMessage({ ...message, locale: "hr" });
    expect(hr.html).toContain('<html lang="hr">');
    expect(hr.html).toContain(">Potvrdi e-mail</a>");
    expect(hr.html).not.toContain("Ako gumb ne radi");
    expect(hr.html).toContain("60 minuta");
    expect(hr.html).toContain("Vaše financije, u perspektivi.");
    expect(
      verificationMessage({ ...message, locale: "unknown" }).html,
    ).toContain('<html lang="en">');
  });
  it("escapes verification link attributes", () => {
    const rendered = verificationMessage({
      ...message,
      verificationUrl:
        "https://app.example.test/verify-email?one=1&two=2#token=abc",
    });
    expect(rendered.html).toContain(
      'href="https://app.example.test/verify-email?one=1&amp;two=2#token=abc"',
    );
    expect(rendered.html).not.toContain("?one=1&two=2");
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
    const body = JSON.parse(options.body);
    expect(body.attachments).toHaveLength(1);
    const [logo] = body.attachments;
    expect(logo).toMatchObject({
      filename: "opulya-mark.png",
      content_type: "image/png",
      content_id: "opulya-logo",
    });
    expect(body.html).toContain(`src="cid:${logo.content_id}"`);
    expect(logo).not.toHaveProperty("path");
    const png = Buffer.from(logo.content, "base64");
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
    expect(png.length).toBeLessThan(20_000);
    fetch.mockResolvedValue({ ok: false });
    await expect(new MailService().sendVerification(message)).rejects.toThrow(
      "EMAIL_DELIVERY_FAILED",
    );
  });
});
