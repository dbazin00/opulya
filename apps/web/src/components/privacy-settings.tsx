"use client";
import { useState, type SubmitEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Mail, Pause, Play, Trash2 } from "lucide-react";
import { passwordMaxLength } from "@opulya/shared";
import { api } from "@/lib/api";
import { forgetVerification } from "@/lib/pending-verification";
import { useUser } from "./providers";
import { Button, ErrorNotice, Field, Modal } from "./ui";

type Action = "export" | "delete" | "restrict" | "resume";

export function PrivacySettings({ contact }: { contact?: string }) {
  const t = useTranslations("privacySettings");
  const common = useTranslations();
  const user = useUser();
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  function open(value: Action) {
    setError(null);
    setAction(value);
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError(null);
    try {
      if (action === "export") {
        const result = await api("auth/export", data);
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(result, null, 2)], {
            type: "application/json",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "opulya-data.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        form.reset();
        setAction(null);
        setBusy(false);
        return;
      }
      if (action === "delete") {
        await api("auth/account", data, "DELETE");
        forgetVerification();
      } else {
        await api(
          "auth/processing",
          { ...data, restricted: action === "restrict" },
          "PATCH",
        );
      }
      form.reset();
      await client.cancelQueries();
      client.clear();
      window.location.replace(action === "delete" ? "/login" : "/settings");
    } catch (error) {
      setError(error);
      setBusy(false);
    }
  }
  return (
    <section
      className="section privacy-settings"
      aria-labelledby="privacy-settings-title"
    >
      <h2 id="privacy-settings-title">{t("title")}</h2>
      <div className="privacy-actions">
        <div>
          <h3>{t("exportTitle")}</h3>
          <p className="muted">{t("exportDescription")}</p>
          <Button className="secondary" onClick={() => open("export")}>
            <Download size={17} aria-hidden />
            {t("exportAction")}
          </Button>
        </div>
        <div>
          <h3>{t("restrictTitle")}</h3>
          <p className="muted">
            {t(
              user.processingRestrictedAt
                ? "restrictedDescription"
                : "restrictDescription",
            )}
          </p>
          <Button
            className="secondary"
            onClick={() =>
              open(user.processingRestrictedAt ? "resume" : "restrict")
            }
          >
            {user.processingRestrictedAt ? (
              <Play size={17} aria-hidden />
            ) : (
              <Pause size={17} aria-hidden />
            )}
            {t(user.processingRestrictedAt ? "resumeAction" : "restrictAction")}
          </Button>
        </div>
        <div>
          <h3>{t("deleteTitle")}</h3>
          <p className="muted">{t("deleteDescription")}</p>
          <Button className="danger" onClick={() => open("delete")}>
            <Trash2 size={17} aria-hidden />
            {t("deleteAction")}
          </Button>
        </div>
      </div>
      <p className="muted">{t("contactDescription")}</p>
      <Link
        className="privacy-contact"
        href={contact ? `mailto:${contact}` : "/privacy"}
      >
        <Mail size={17} aria-hidden />
        {t("contactAction")}
      </Link>
      <Modal
        title={action ? t(`${action}Title`) : t("title")}
        description={action ? t(`${action}Confirmation`) : undefined}
        open={action !== null}
        onClose={() => {
          if (!busy) setAction(null);
        }}
      >
        {action && (
          <form className="entry-form privacy-confirmation" onSubmit={submit}>
            <Field label={common("auth.password")}>
              {(id) => (
                <input
                  id={id}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={passwordMaxLength}
                  required
                  disabled={busy}
                />
              )}
            </Field>
            {action === "delete" && (
              <Field label={t("deleteConfirmLabel")}>
                {(id) => (
                  <input
                    id={id}
                    name="confirm"
                    autoComplete="off"
                    pattern="DELETE"
                    required
                    disabled={busy}
                  />
                )}
              </Field>
            )}
            <ErrorNotice error={error} />
            <div className="form-footer">
              <Button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                {common("common.cancel")}
              </Button>
              <Button
                type="submit"
                className={action === "delete" ? "danger" : ""}
                busy={busy}
              >
                {t(`${action}Action`)}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
