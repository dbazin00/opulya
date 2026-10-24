"use client";
import { Dropdown } from "./dropdown";
import { useState, type SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, ErrorNotice, Field } from "./ui";
import { useUser } from "./providers";
import { LanguageSelect } from "./language-select";
import { LegalLinks } from "./legal-links";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";
export function SettingsView() {
  const t = useTranslations();
  const user = useUser();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("auth/settings", data, "PATCH");
      document.cookie = `OPULYA_LOCALE=${data.locale}; Path=/; SameSite=Lax; Max-Age=31536000`;
      router.refresh();
      setSaved(true);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <section className="section">
        <h2>{t("settings.profile")}</h2>
        <dl className="profile-list">
          <dt>{t("auth.firstName")}</dt>
          <dd>{user.firstName}</dd>
          <dt>{t("auth.lastName")}</dt>
          <dd>{user.lastName}</dd>
          <dt>{t("auth.email")}</dt>
          <dd>{user.email}</dd>
        </dl>
      </section>
      <section className="section">
        <h2>{t("settings.preferences")}</h2>
        <form className="entry-form" onSubmit={submit}>
          <div className="field">
            <span className="field-label" id="appearance-label">
              {t("settings.appearance")}
            </span>
            <div
              className="segmented theme-options"
              role="group"
              aria-labelledby="appearance-label"
            >
              {(["light", "dark"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={theme === value ? "selected" : ""}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  {value === "light" ? (
                    <Sun size={17} aria-hidden />
                  ) : (
                    <Moon size={17} aria-hidden />
                  )}
                  {t(`settings.${value}`)}
                </button>
              ))}
            </div>
          </div>
          <Field label={t("settings.locale")}>
            {(id) => (
              <LanguageSelect
                id={id}
                label={t("settings.locale")}
                name="locale"
                defaultValue={user.locale}
                disabled={busy}
              />
            )}
          </Field>
          <Field label={t("common.timeZone")} hint={t("settings.timezoneHint")}>
            {(id) => (
              <Dropdown id={id} name="timeZone" defaultValue={user.timeZone}>
                {[
                  ...new Set([
                    user.timeZone,
                    "UTC",
                    ...Intl.supportedValuesOf("timeZone"),
                  ]),
                ].map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </Dropdown>
            )}
          </Field>
          <ErrorNotice error={error} />
          {saved && (
            <p role="status" className="positive">
              {t("settings.saved")}
            </p>
          )}
          <div className="form-footer">
            <Button type="submit" busy={busy}>
              {t("common.save")}
            </Button>
          </div>
        </form>
        <LegalLinks />
      </section>
    </div>
  );
}
