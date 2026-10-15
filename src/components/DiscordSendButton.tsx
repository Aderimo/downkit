import { useState } from "react";
import { useTranslation } from "react-i18next";
import { siDiscord } from "simple-icons";
import { Check, Loader2 } from "lucide-react";
import { useSettingsStore } from "../lib/appSettings";
import { discordSend } from "../lib/tauri-api";
import { localizeError } from "../lib/errors";
import { IconButton } from "./ui/Button";

function DiscordIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d={siDiscord.path} />
    </svg>
  );
}

/** Dosyayı ayarlardaki Discord kanalına gönderir. Webhook yoksa görünmez. */
export function DiscordSendButton({ path, title }: { path: string; title?: string }) {
  const { t } = useTranslation();
  const webhook = useSettingsStore((s) => s.discordWebhook);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!webhook) return null;
  const label =
    state === "sent"
      ? t("share.discordSent")
      : state === "sending"
        ? t("share.discordSending")
        : (error ?? t("share.discordSend"));
  return (
    <IconButton
      label={label}
      tone={error ? "danger" : state === "sent" ? "accent" : "default"}
      disabled={state === "sending"}
      onClick={() => {
        setError(null);
        setState("sending");
        void discordSend(webhook, path, title ? `🎬 ${title}` : "")
          .then(() => {
            setState("sent");
            window.setTimeout(() => setState("idle"), 2500);
          })
          .catch((err) => {
            setError(localizeError(err, "share.discordFailed").message);
            setState("idle");
          });
      }}
    >
      {state === "sending" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : state === "sent" ? (
        <Check size={16} />
      ) : (
        <DiscordIcon />
      )}
    </IconButton>
  );
}
