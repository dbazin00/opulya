"use client";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  passwordMaxLength,
  passwordMinLength,
  signupPasswordSchema,
} from "@opulya/shared";
import { api, ApiError } from "@/lib/api";
import {
  forgetVerification,
  pendingVerification,
  rememberVerification,
} from "@/lib/pending-verification";
import { Button, ErrorNotice, Field, Loading } from "./ui";
import { AuthShell } from "./auth-shell";
export function AuthForm({
  signup,
  verify = false,
  pending = false,
}: {
  signup: boolean;
  verify?: boolean;
  pending?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [repeatVisible, setRepeatVisible] = useState(false);
  const [token, setToken] = useState("");
  const [tokenLoaded, setTokenLoaded] = useState(!verify);
  const [verified, setVerified] = useState(false);
  const [resent, setResent] = useState(false);
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false);
  const [pendingLoaded, setPendingLoaded] = useState(!pending);
  const [nextRequestAt, setNextRequestAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const tokenInitialized = useRef(false);
  const newPassword = verify;
  const repeatInput = useRef<HTMLInputElement>(null);
  const rulesId = useId();
  const lengthMet = signupPasswordSchema.safeParse(password).success;
  const matchMet = password.length > 0 && password === repeatPassword;
  const rules = [
    {
      met: lengthMet,
      label: t("auth.passwordLength", {
        min: passwordMinLength,
        max: passwordMaxLength,
      }),
    },
    {
      met: matchMet,
      label: t(
        repeatPassword && !matchMet
          ? "auth.passwordsMismatch"
          : "auth.passwordsMatch",
      ),
    },
  ];
  useEffect(() => {
    if (!pending) return;
    const saved = pendingVerification();
    if (saved) {
      setEmail(saved.email);
      setEmailLocked(true);
      setNextRequestAt(saved.nextRequestAt);
      setRemaining(
        Math.max(0, Math.ceil((saved.nextRequestAt - Date.now()) / 1000)),
      );
    }
    setPendingLoaded(true);
  }, [pending]);
  useEffect(() => {
    if (!pending || !nextRequestAt) return;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((nextRequestAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pending, nextRequestAt]);
  useEffect(() => {
    if (!verify || tokenInitialized.current) return;
    tokenInitialized.current = true;
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    if (/^[a-f0-9]{64}$/.test(value)) setToken(value);
    else setError(new ApiError("INVALID_VERIFICATION", 400));
    setTokenLoaded(true);
  }, [verify]);
  useEffect(() => {
    repeatInput.current?.setCustomValidity(
      repeatPassword && !matchMet ? t("auth.passwordsMismatch") : "",
    );
  }, [repeatPassword, matchMet, t]);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending && (!pendingLoaded || remaining > 0)) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (
      newPassword &&
      (!signupPasswordSchema.safeParse(data.password).success ||
        data.password !== data.repeatPassword)
    ) {
      repeatInput.current?.focus();
      form.reportValidity();
      return;
    }
    // Password confirmation stays in the browser, not in the verification API body.
    delete data.repeatPassword;
    setBusy(true);
    setError(null);
    try {
      await api(
        `auth/${verify ? "verify-email" : pending ? "resend-verification" : signup ? "signup" : "login"}`,
        {
          ...data,
          ...(verify ? { token } : {}),
          ...(signup
            ? {
                locale,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }
            : {}),
        },
      );
      if (verify) {
        forgetVerification();
        setVerified(true);
        setBusy(false);
      } else if (pending) {
        const saved = rememberVerification(String(data.email));
        setEmail(saved.email);
        setEmailLocked(true);
        setNextRequestAt(saved.nextRequestAt);
        setRemaining(60);
        setResent(true);
        setBusy(false);
      } else {
        if (signup) rememberVerification(String(data.email));
        window.location.assign(signup ? "/check-email" : "/dashboard");
      }
    } catch (e) {
      if (
        !signup &&
        !verify &&
        !pending &&
        e instanceof ApiError &&
        e.code === "EMAIL_NOT_VERIFIED"
      ) {
        rememberVerification(String(data.email), 0);
        window.location.assign("/check-email");
        return;
      }
      setError(e);
      setBusy(false);
    }
  }
  return (
    <AuthShell
      onBeforeLocaleChange={() => {
        if (verify && token)
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}#${new URLSearchParams({ token })}`,
          );
      }}
    >
      <section
        className="auth-form"
        key={
          verified
            ? "verified"
            : verify
              ? "verify"
              : pending
                ? "pending"
                : signup
                  ? "signup"
                  : "login"
        }
      >
        <div className="auth-intro">
          <span className="auth-form-symbol" aria-hidden="true">
            {verified ? (
              <CheckCircle2 size={23} />
            ) : verify || pending ? (
              <MailCheck size={23} />
            ) : signup ? (
              <UserRound size={23} />
            ) : (
              <LockKeyhole size={23} />
            )}
          </span>
          <h1>
            {t(
              verified
                ? "auth.emailVerified"
                : verify
                  ? "auth.verifyEmail"
                  : pending
                    ? "auth.checkEmail"
                    : signup
                      ? "auth.signup"
                      : "auth.login",
            )}
          </h1>
          <p className="muted">
            {t(
              verified
                ? "auth.emailVerifiedBody"
                : verify
                  ? "auth.verifyEmailBody"
                  : pending
                    ? "auth.checkEmailBody"
                    : signup
                      ? "auth.signupSubtitle"
                      : "auth.loginSubtitle",
            )}
          </p>
        </div>
        {(verify && !tokenLoaded) || (pending && !pendingLoaded) ? (
          <Loading />
        ) : verified ? (
          <Link href="/login" className="button full">
            {t("auth.loginLink")}
            <ArrowRight size={17} />
          </Link>
        ) : (
          <form onSubmit={submit}>
            {signup && (
              <div className="form-grid">
                <Field label={t("auth.firstName")}>
                  {(id) => (
                    <input
                      id={id}
                      name="firstName"
                      autoComplete="given-name"
                      required
                      maxLength={100}
                    />
                  )}
                </Field>
                <Field label={t("auth.lastName")}>
                  {(id) => (
                    <input
                      id={id}
                      name="lastName"
                      autoComplete="family-name"
                      required
                      maxLength={100}
                    />
                  )}
                </Field>
              </div>
            )}
            {!verify && (
              <Field label={t("auth.email")}>
                {(id) => (
                  <input
                    id={id}
                    name="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    readOnly={pending && emailLocked}
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                )}
              </Field>
            )}
            {!pending && !signup && (
              <Field label={t("auth.password")}>
                {(id) => (
                  <div className="password-input">
                    <input
                      id={id}
                      name="password"
                      type={passwordVisible ? "text" : "password"}
                      autoComplete={
                        newPassword ? "new-password" : "current-password"
                      }
                      required
                      minLength={newPassword ? passwordMinLength : 1}
                      maxLength={passwordMaxLength}
                      aria-describedby={newPassword ? rulesId : undefined}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t(
                        passwordVisible
                          ? "auth.hidePassword"
                          : "auth.showPassword",
                      )}
                      title={t(
                        passwordVisible
                          ? "auth.hidePassword"
                          : "auth.showPassword",
                      )}
                      aria-pressed={passwordVisible}
                      aria-controls={id}
                      onClick={() => setPasswordVisible(!passwordVisible)}
                    >
                      {passwordVisible ? (
                        <EyeOff size={18} aria-hidden="true" />
                      ) : (
                        <Eye size={18} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                )}
              </Field>
            )}
            {newPassword && (
              <>
                <Field label={t("auth.repeatPassword")}>
                  {(id) => (
                    <div className="password-input">
                      <input
                        ref={repeatInput}
                        id={id}
                        name="repeatPassword"
                        type={repeatVisible ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        maxLength={passwordMaxLength}
                        aria-describedby={rulesId}
                        aria-invalid={repeatPassword.length > 0 && !matchMet}
                        onChange={(event) =>
                          setRepeatPassword(event.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t(
                          repeatVisible
                            ? "auth.hideRepeatPassword"
                            : "auth.showRepeatPassword",
                        )}
                        title={t(
                          repeatVisible
                            ? "auth.hideRepeatPassword"
                            : "auth.showRepeatPassword",
                        )}
                        aria-pressed={repeatVisible}
                        aria-controls={id}
                        onClick={() => setRepeatVisible(!repeatVisible)}
                      >
                        {repeatVisible ? (
                          <EyeOff size={18} aria-hidden="true" />
                        ) : (
                          <Eye size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  )}
                </Field>
                <div id={rulesId} className="password-requirements">
                  <ul aria-label={t("auth.passwordRules")}>
                    {rules.map((rule, index) => (
                      <li key={index} className={rule.met ? "met" : undefined}>
                        {rule.met ? (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        ) : (
                          <Circle size={16} aria-hidden="true" />
                        )}
                        <span>{rule.label}</span>
                        <span className="sr-only">
                          {t(rule.met ? "auth.ruleMet" : "auth.rulePending")}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p>{t("auth.passwordAdvice")}</p>
                </div>
                <span className="sr-only" role="status" aria-atomic="true">
                  {t("auth.passwordProgress", {
                    count: rules.filter((rule) => rule.met).length,
                    total: rules.length,
                  })}
                </span>
              </>
            )}
            <ErrorNotice error={error} />
            {signup && (
              <p className="auth-verification-hint">
                <MailCheck size={17} aria-hidden="true" />
                <span>{t("auth.signupVerificationHint")}</span>
              </p>
            )}
            {resent && (
              <p className="notice" role="status">
                {t("auth.verificationRequested")}
              </p>
            )}
            <Button
              type="submit"
              busy={busy}
              className="full"
              disabled={
                (newPassword && (!lengthMet || !matchMet)) ||
                (verify && !token) ||
                (pending && remaining > 0)
              }
            >
              {t(
                verify
                  ? "auth.verifyEmail"
                  : pending
                    ? "auth.resendVerification"
                    : signup
                      ? "auth.createAccount"
                      : "auth.signIn",
              )}
              <ArrowRight size={17} />
            </Button>
            {pending && remaining > 0 && (
              <p className="muted">
                {t("auth.resendCountdown", { seconds: remaining })}
              </p>
            )}
          </form>
        )}
        {pending && emailLocked && (
          <p className="auth-switch">
            <Link href="/signup" onClick={forgetVerification}>
              {t("auth.changeEmail")}
            </Link>
          </p>
        )}
        {verify && !verified && (
          <p className="auth-switch">
            <Link href="/check-email">{t("auth.resendVerification")}</Link>
          </p>
        )}
        {!pending && !verify && (
          <p className="auth-switch">
            {t(signup ? "auth.hasAccount" : "auth.noAccount")}{" "}
            <Link href={signup ? "/login" : "/signup"}>
              {t(signup ? "auth.loginLink" : "auth.signupLink")}
            </Link>
          </p>
        )}
        <p className="privacy">
          <ShieldCheck size={15} />
          {t("auth.private")}
        </p>
      </section>
    </AuthShell>
  );
}
