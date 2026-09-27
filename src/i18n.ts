import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Diller `src/locales/*.json` dosyalarından kendiliğinden yüklenir: yeni bir dil
// eklemek için dosyayı koymak yeter (bkz. CONTRIBUTING.md). Her dosyanın
// `language.name` alanı Ayarlar'daki listede görünen addır (ör. "Deutsch").
const modules = import.meta.glob<{ default: Record<string, unknown> }>("./locales/*.json", {
  eager: true,
});

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [file, module] of Object.entries(modules)) {
  const code = /\/([a-zA-Z-]+)\.json$/.exec(file)?.[1];
  if (code) resources[code] = { translation: module.default };
}

export interface LanguageOption {
  code: string;
  name: string;
}

/** Ayarlar'daki dil listesi (kendi dilindeki adıyla). */
export const LANGUAGES: LanguageOption[] = Object.entries(resources)
  .map(([code, { translation }]) => ({
    code,
    name: String((translation.language as { name?: string } | undefined)?.name ?? code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const LANGUAGE_KEY = "downkit.language";

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved && saved in resources) return saved;
  } catch {
    // Depolama yoksa sistem dili kullanılır.
  }
  const system = navigator.language?.toLowerCase() ?? "en";
  return (
    Object.keys(resources).find((code) => system === code.toLowerCase()) ??
    Object.keys(resources).find((code) => system.startsWith(code.toLowerCase())) ??
    "en"
  );
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// Sayfanın dili arayüz diline uysun: CSS "uppercase" Türkçede "İ", İngilizcede "I"
// üretir ("PLAYLİST" hatası); ekran okuyucular da doğru dili seçer.
document.documentElement.lang = i18n.language;

// Ayarlar'da seçilen dil yeniden açılışta da korunsun.
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(LANGUAGE_KEY, lng);
  } catch {
    // Kaydedilemezse yalnızca bu oturumda geçerli olur.
  }
});

export default i18n;
