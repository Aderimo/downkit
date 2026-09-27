import { invoke } from "@tauri-apps/api/core";
import { notify } from "./tauri-api";

export type HudKind = "record" | "saved" | "replayOn" | "replayOff" | "error" | "info";

/** Ekranın köşesinde kısa süre görünen bilgi (odak çalmaz, kayda girmez).
 * Gösterilemezse Windows bildirimine düşer. */
export async function showHud(kind: HudKind, title: string, detail?: string | null) {
  try {
    await invoke("hud_show", { kind, title, detail: detail ?? null });
  } catch {
    void notify(title, detail ?? "");
  }
}
