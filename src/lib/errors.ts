import i18n from "../i18n";

/** Rust `AppError` / hata olayı yükünün arayüze gelen biçimi. */
export interface BackendError {
  message?: string;
  detail?: string | null;
  rawDetail?: string | null;
  code?: string | null;
}

export interface LocalizedError {
  message: string;
  detail: string | null;
}

/** Arka ucun hata kodunu seçili dilde metne çevirir. Kod yoksa ya da çevirisi
 * yoksa arka ucun (Türkçe) mesajı, o da yoksa `fallbackKey` kullanılır. */
export function localizeError(err: unknown, fallbackKey: string): LocalizedError {
  if (typeof err === "string") return { message: err, detail: null };
  const e = (err ?? {}) as BackendError;
  const key = e.code ? `backendError.${e.code}` : null;
  const message = key && i18n.exists(key) ? i18n.t(key) : (e.message ?? i18n.t(fallbackKey));
  return { message, detail: e.detail ?? e.rawDetail ?? null };
}
