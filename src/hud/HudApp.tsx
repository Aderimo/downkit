import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, CircleCheck, Info, Rewind } from "lucide-react";
import "@fontsource/nunito/latin-800.css";
import "../styles/globals.css";

// Köşedeki bilgi penceresi: kısayolla yapılan kayıt işlemlerini (oyun oynarken
// bile) kısa süre gösterir. Metinler ana pencerede çevrilip hazır gelir.

interface HudMessage {
  id: number;
  kind: "record" | "saved" | "replayOn" | "replayOff" | "error" | "info";
  title: string;
  detail: string | null;
}

function Icon({ kind }: { kind: HudMessage["kind"] }) {
  switch (kind) {
    case "record":
      return (
        <span className="relative flex h-5 w-5 items-center justify-center">
          <span className="absolute h-5 w-5 animate-ping rounded-full bg-[#f87171]/40" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#f87171]" />
        </span>
      );
    case "saved":
      return <CircleCheck size={22} className="text-[#4ADE80]" />;
    case "replayOn":
      return <Rewind size={22} className="text-[#FFD43B]" />;
    case "replayOff":
      return <Rewind size={22} className="text-[#9aa3b8]" />;
    case "error":
      return <AlertTriangle size={22} className="text-[#f87171]" />;
    default:
      return <Info size={22} className="text-[#8aa2ff]" />;
  }
}

export function Hud() {
  const [message, setMessage] = useState<HudMessage | null>(null);

  useEffect(() => {
    // Pencere ilk mesajla açıldıysa o mesaj sayfa yüklenmeden gönderilmiş olabilir.
    invoke<HudMessage | null>("hud_current")
      .then((m) => m && setMessage(m))
      .catch(() => {});
    const unlisten = listen<HudMessage>("hud-message", (e) => setMessage(e.payload));
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  if (!message) return null;
  return (
    <div className="flex h-screen w-screen items-start justify-end p-1">
      <div
        key={message.id}
        className="dk-hud-in flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-[#0d1224]/92 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur"
      >
        <span className="shrink-0">
          <Icon kind={message.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-white">{message.title}</p>
          {message.detail ? (
            <p className="line-clamp-2 text-xs leading-snug text-[#aab3c8]">{message.detail}</p>
          ) : null}
        </div>
        <span className="font-brand shrink-0 text-[11px] font-extrabold text-[#FFD43B]">
          DownKit
        </span>
      </div>
    </div>
  );
}
