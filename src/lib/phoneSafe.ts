import { create } from "zustand";

// Telefon önizlemesinin güvenli alan şablonları: kısa video uygulamalarının düğme,
// açıklama ve üst çubuk alanları (genel ölçüler; marka adı yok). Oranlar telefon
// ekranının 0–1'i.

export interface SafeZone {
  kind: "top" | "side" | "bottom";
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SAFE_TEMPLATES = {
  /** Sağda düğme sütunu, altta iki satır açıklama. */
  sideButtons: [
    { kind: "top", x: 0, y: 0, w: 1, h: 0.09 },
    { kind: "side", x: 0.84, y: 0.4, w: 0.16, h: 0.42 },
    { kind: "bottom", x: 0, y: 0.8, w: 1, h: 0.2 },
  ],
  /** Altta geniş açıklama ve abone çubuğu, dar düğme sütunu. */
  wideCaption: [
    { kind: "top", x: 0, y: 0, w: 1, h: 0.07 },
    { kind: "side", x: 0.86, y: 0.46, w: 0.14, h: 0.3 },
    { kind: "bottom", x: 0, y: 0.74, w: 1, h: 0.26 },
  ],
  /** Akışta kare / dikey gönderi: üstte ad, altta beğeni satırı. */
  feed: [
    { kind: "top", x: 0, y: 0, w: 1, h: 0.06 },
    { kind: "bottom", x: 0, y: 0.88, w: 1, h: 0.12 },
  ],
} as const satisfies Record<string, readonly SafeZone[]>;

export type SafeTemplate = keyof typeof SAFE_TEMPLATES;

const KEY = "downkit.phoneTemplate";

function load(): SafeTemplate {
  try {
    const v = localStorage.getItem(KEY);
    return v && v in SAFE_TEMPLATES ? (v as SafeTemplate) : "sideButtons";
  } catch {
    return "sideButtons";
  }
}

export const usePhoneTemplate = create<{ template: SafeTemplate; set: (t: SafeTemplate) => void }>(
  (set) => ({
    template: load(),
    set: (template) => {
      set({ template });
      try {
        localStorage.setItem(KEY, template);
      } catch {
        // Saklanamazsa yalnızca bu oturumda.
      }
    },
  }),
);
