import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

const LANGUAGE_KEY = "downkit.language";

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === "tr" || saved === "en") return saved;
  } catch {
    // Depolama yoksa sistem dili kullanılır.
  }
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
  },
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
