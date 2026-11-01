"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type SubmitEvent,
} from "react";
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
  termsVersion,
} from "@opulya/shared";
import { api, ApiError } from "@/lib/api";
import {
  forgetVerification,
  pendingVerification,
  rememberVerification,
} from "@/lib/pending-verification";
import { Button, ErrorNotice, Field, Loading } from "./ui";
import { AuthShell } from "./auth-shell";
function PasswordInput({
  repeat = false,
  ...props
}: ComponentProps<"input"> & { repeat?: boolean }) {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  const label = t(
    repeat
      ? visible
        ? "auth.hideRepeatPassword"
        : "auth.showRepeatPassword"
      : visible
        ? "auth.hidePassword"
        : "auth.showPassword",
  );
  return (
    <div className="password-input">
      <input
        {...props}
        type={visible ? "text" : "password"}
        aria-description={t("auth.passwordVisibilityShortcut")}
        aria-keyshortcuts="Alt+V"
        onKeyDown={(event) => {
          if (
            event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            event.code === "KeyV"
          ) {
            event.preventDefault();
            setVisible((current) => !current);
          }
        }}
      />
      <button
        type="button"
        className="icon-button"
        tabIndex={-1}
        aria-keyshortcuts="Alt+V"
        aria-label={label}
        title={`${label} (Alt+V)`}
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <EyeOff size={18} aria-hidden="true" />
        ) : (
          <Eye size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
export function AuthForm({
  signup,
  verify = false,
  pending = false,
  legalDraft = false,
  registrationClosed = false,
  recovery,
}: {
  signup: boolean;
  verify?: boolean;
  pending?: boolean;
  legalDraft?: boolean;
  registrationClosed?: boolean;
  recovery?: "forgot" | "reset";
}) {
  const t = useTranslations();
  const locale = useLocale();
  const reset = recovery === "reset";
  const forgot = recovery === "forgot";
  const newPassword = verify || reset;
  const mode =
    recovery ??
    (verify ? "verify" : pending ? "pending" : signup ? "signup" : "login");
  const copy = {
    login: {
      endpoint: "login",
      title: "auth.login",
      body: "auth.loginSubtitle",
      action: "auth.signIn",
    },
    signup: {
      endpoint: "signup",
      title: "auth.signup",
      body: "auth.signupSubtitle",
      action: "auth.createAccount",
    },
    verify: {
      endpoint: "verify-email",
      title: "auth.verifyEmail",
      body: "auth.verifyEmailBody",
      action: "auth.verifyEmail",
    },
    pending: {
      endpoint: "resend-verification",
      title: "auth.checkEmail",
      body: "auth.checkEmailBody",
      action: "auth.resendVerification",
    },
    forgot: {
      endpoint: "forgot-password",
      title: "auth.forgotPassword",
      body: "auth.forgotPasswordBody",
      action: "auth.sendResetLink",
    },
    reset: {
      endpoint: "reset-password",
      title: "auth.resetPassword",
      body: "auth.resetPasswordBody",
      action: "auth.resetPassword",
    },
  }[mode];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [token, setToken] = useState("");
  const [tokenLoaded, setTokenLoaded] = useState(!newPassword);
  const [complete, setComplete] = useState(false);
  const [resent, setResent] = useState(false);
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false);
  const [pendingLoaded, setPendingLoaded] = useState(!pending);
  const [nextRequestAt, setNextRequestAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const tokenInitialized = useRef(false);
  const repeatInput = useRef<HTMLInputElement>(null);
  const rulesId = useId();
  const termsId = useId();
  const [acceptTerms, setAcceptTerms] = useState(false);
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
    if ((!pending && !forgot) || !nextRequestAt) return;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((nextRequestAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pending, forgot, nextRequestAt]);
  useEffect(() => {
    if (!newPassword || tokenInitialized.current) return;
    tokenInitialized.current = true;
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    if (/^[a-f0-9]{64}$/.test(value)) setToken(value);
    else
      setError(
        new ApiError(
          reset ? "INVALID_PASSWORD_RESET" : "INVALID_VERIFICATION",
          400,
        ),
      );
    setTokenLoaded(true);
  }, [newPassword, reset]);
  useEffect(() => {
    repeatInput.current?.setCustomValidity(
      repeatPassword && !matchMet ? t("auth.passwordsMismatch") : "",
    );
  }, [repeatPassword, matchMet, t]);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (newPassword && !token)) return;
    if ((pending || forgot) && (!pendingLoaded || remaining > 0)) return;
    if (signup && registrationClosed) return;
    const form = event.currentTarget;
    if (signup && !acceptTerms) {
      form.reportValidity();
      return;
    }
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
    // Password confirmation stays in the browser, not in the API body.
    delete data.repeatPassword;
    setBusy(true);
    setError(null);
    try {
      await api(`auth/${copy.endpoint}`, {
        ...data,
        ...(newPassword ? { token } : {}),
        ...(signup
          ? {
              locale,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              acceptTerms,
              termsVersion,
            }
          : {}),
      });
      if (newPassword) {
        if (verify) forgetVerification();
        setToken("");
        setPassword("");
        setRepeatPassword("");
        setComplete(true);
        setBusy(false);
      } else if (forgot) {
        setNextRequestAt(Date.now() + 60000);
        setRemaining(60);
        setResent(true);
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
        mode === "login" &&
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
        if (newPassword && token)
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}#${new URLSearchParams({ token })}`,
          );
      }}
    >
      <section className="auth-form" key={complete ? "complete" : mode}>
        <div className="auth-intro">
          <span className="auth-form-symbol" aria-hidden="true">
            {complete ? (
              <CheckCircle2 size={23} />
            ) : verify || pending || forgot ? (
              <MailCheck size={23} />
            ) : signup ? (
              <UserRound size={23} />
            ) : (
              <LockKeyhole size={23} />
            )}
          </span>
          <h1>
            {t(
              complete
                ? reset
                  ? "auth.passwordResetDone"
                  : "auth.emailVerified"
                : copy.title,
            )}
          </h1>
          <p className="muted">
            {t(
              complete
                ? reset
                  ? "auth.passwordResetDoneBody"
                  : "auth.emailVerifiedBody"
                : copy.body,
            )}
          </p>
        </div>
        {(newPassword && !tokenLoaded) || (pending && !pendingLoaded) ? (
          <Loading />
        ) : complete ? (
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
            {!newPassword && (
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
            {!pending && !signup && !forgot && (
              <Field label={t("auth.password")}>
                {(id) => (
                  <PasswordInput
                    id={id}
                    name="password"
                    autoComplete={
                      newPassword ? "new-password" : "current-password"
                    }
                    required
                    minLength={newPassword ? passwordMinLength : 1}
                    maxLength={passwordMaxLength}
                    aria-describedby={newPassword ? rulesId : undefined}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
              </Field>
            )}
            {newPassword && (
              <>
                <Field label={t("auth.repeatPassword")}>
                  {(id) => (
                    <PasswordInput
                      repeat
                      ref={repeatInput}
                      id={id}
                      name="repeatPassword"
                      autoComplete="new-password"
                      required
                      maxLength={passwordMaxLength}
                      aria-describedby={rulesId}
                      aria-invalid={repeatPassword.length > 0 && !matchMet}
                      onChange={(event) =>
                        setRepeatPassword(event.target.value)
                      }
                    />
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
            {mode === "login" && (
              <Link href="/forgot-password" className="auth-recovery-link">
                {t("auth.forgotPasswordLink")}
              </Link>
            )}
            <ErrorNotice error={error} />
            {signup && (
              <>
                <p className="auth-verification-hint">
                  <MailCheck size={17} aria-hidden="true" />
                  <span>{t("auth.signupVerificationHint")}</span>
                </p>
                <p className="signup-legal">
                  {t.rich("legal.signupNotice", {
                    terms: (text) => (
                      <Link
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {text}
                      </Link>
                    ),
                    privacy: (text) => (
                      <Link
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {text}
                      </Link>
                    ),
                    security: (text) => (
                      <Link
                        href="/security"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {text}
                      </Link>
                    ),
                  })}
                </p>
                <div className="terms-acceptance">
                  <input
                    id={termsId}
                    name="acceptTerms"
                    type="checkbox"
                    checked={acceptTerms}
                    required
                    disabled={busy}
                    onChange={(event) => setAcceptTerms(event.target.checked)}
                  />
                  <label htmlFor={termsId}>
                    {t.rich("legal.acceptTerms", {
                      terms: (text) => (
                        <Link
                          href="/terms"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {text}
                        </Link>
                      ),
                    })}
                  </label>
                </div>
                {legalDraft && (
                  <p className="signup-legal-draft" role="note">
                    {t(
                      registrationClosed
                        ? "legal.signupClosed"
                        : "legal.signupDraft",
                    )}
                  </p>
                )}
              </>
            )}
            {resent && (
              <p className="notice" role="status">
                {t(
                  forgot
                    ? "auth.passwordResetRequested"
                    : "auth.verificationRequested",
                )}
              </p>
            )}
            <Button
              type="submit"
              busy={busy}
              className="full"
              disabled={
                (newPassword && (!lengthMet || !matchMet)) ||
                (newPassword && !token) ||
                ((pending || forgot) && remaining > 0) ||
                (signup && (!acceptTerms || registrationClosed))
              }
            >
              {t(copy.action)}
              <ArrowRight size={17} />
            </Button>
            {(pending || forgot) && remaining > 0 && (
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
        {verify && !complete && (
          <p className="auth-switch">
            <Link href="/check-email">{t("auth.resendVerification")}</Link>
          </p>
        )}
        {recovery && !complete && (
          <p className="auth-switch">
            <Link href={reset ? "/forgot-password" : "/login"}>
              {t(reset ? "auth.requestNewResetLink" : "auth.backToLogin")}
            </Link>
          </p>
        )}
        {!pending && !verify && !recovery && (
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
