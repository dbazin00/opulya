const key = "opulya.pending-verification";
export const verificationCooldownMs = 60_000;

export function pendingVerification() {
  try {
    const value: unknown = JSON.parse(
      window.sessionStorage.getItem(key) ?? "null",
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("email" in value) ||
      !("nextRequestAt" in value)
    )
      return null;
    if (
      typeof value.email !== "string" ||
      value.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
      typeof value.nextRequestAt !== "number" ||
      !Number.isFinite(value.nextRequestAt)
    )
      return null;
    return { email: value.email, nextRequestAt: value.nextRequestAt };
  } catch {
    return null;
  }
}

export function rememberVerification(
  email: string,
  nextRequestAt = Date.now() + verificationCooldownMs,
) {
  const value = { email: email.trim().toLowerCase(), nextRequestAt };
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage restrictions must not block email verification.
  }
  return value;
}

export function forgetVerification() {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The server remains authoritative when browser storage is unavailable.
  }
}
