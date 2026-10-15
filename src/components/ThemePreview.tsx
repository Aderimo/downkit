import type { Theme } from "../lib/themes";

/** Temanın küçük önizlemesi: kenar çubuğu, kart ve vurgu düğmesi kendi renkleriyle. */
export function ThemePreview({ theme }: { theme: Theme }) {
  const p = theme.palette;
  return (
    <div
      className="flex h-16 overflow-hidden rounded-lg border"
      style={{ background: p.bg, borderColor: p.border }}
      aria-hidden
    >
      <div className="flex w-5 flex-col gap-1 p-1" style={{ background: p.sidebar }}>
        <span className="h-1.5 rounded-sm" style={{ background: p.accent }} />
        <span className="h-1.5 rounded-sm" style={{ background: p.border }} />
        <span className="h-1.5 rounded-sm" style={{ background: p.border }} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-2">
        <div
          className="flex flex-col gap-1 rounded-md border p-1.5"
          style={{ background: p.surface, borderColor: p.border }}
        >
          <span className="h-1.5 w-3/4 rounded-sm" style={{ background: p.text }} />
          <span className="h-1.5 w-1/2 rounded-sm" style={{ background: p.textMuted }} />
        </div>
        <span className="h-2.5 w-1/2 self-end rounded-sm" style={{ background: p.accent }} />
      </div>
    </div>
  );
}
