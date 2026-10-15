// Sürüm notları: programda Ayarlar → Yama notları bölümünde gösterilir; bir sürüme
// tıklayınca GitHub'daki sürüm sayfası (github.com/Aderimo/downkit/releases) açılır.
// Her sürümde en ÜSTE yeni kayıt eklenir; sürüm numarası "v" öneki olmadan yazılır.

export interface LocalizedNotes {
  /** Yeni özellikler ve iyileştirmeler. */
  added: string[];
  /** Düzeltilen hatalar. */
  fixed: string[];
}

export interface ReleaseNote {
  version: string;
  /** ISO gün: "2026-09-28". */
  date: string;
  tr: LocalizedNotes;
  en: LocalizedNotes;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.4.0",
    date: "2026-10-16",
    tr: {
      added: [
        "DownKit artık tamamen ücretsiz ve açık kaynak (MIT): Pro, lisans ve satın alma kalktı",
        "Tek program: linkten indir, dönüştür, sıkıştır, boyutlandır, toplu işle, düzenle, ekran kaydı ve ekran görüntüsü",
        "İndir: YouTube, TikTok, Instagram ve yüzlerce sitede link yapıştır, biçim ve kalite seç; oynatma listesi, bölüm indirme, altyazı, SponsorBlock",
        "Dönüştür sayfası: biçim, sıkıştırma (hedef MB), sosyal medya boyutları ve çok dosyada toplu iş",
        "İndirdiğin videoyu tek tıkla düzenleyicide aç",
        "Hareketli başlıklar (EffectCraft motoru): 7 hazır şablon ve Lottie (.json) animasyonları",
        "Ses: bas/orta/tiz eşitleyici, sıkıştırıcı ve sınırlayıcı",
        "Göz yormayan yeni varsayılan tema (Sakin) ve arayüz boyutu ayarı (Normal / Büyük / Çok büyük)",
        "Hatayı bildir: GitHub'da hazır doldurulmuş bildirim ya da Discord",
        "Eski ClipKit ve DownKit 0.3 kurulumlarından ayarlar, araçlar ve projeler kendiliğinden taşınır",
      ],
      fixed: [],
    },
    en: {
      added: [
        "DownKit is now completely free and open source (MIT): no Pro, licences or purchases",
        "One app: download from a link, convert, compress, resize, batch, edit, record the screen and take screenshots",
        "Download: paste a link from YouTube, TikTok, Instagram and hundreds of sites, pick format and quality; playlists, section download, subtitles, SponsorBlock",
        "Convert page: format, compression (target MB), social media sizes and batch jobs on many files",
        "Open a downloaded video in the editor with one click",
        "Motion titles (EffectCraft engine): 7 ready-made templates and Lottie (.json) animations",
        "Audio: bass/mid/treble equaliser, compressor and limiter",
        "New easy-on-the-eyes default theme (Calm) and an interface size setting (Normal / Large / Extra large)",
        "Report a bug: a pre-filled GitHub issue or Discord",
        "Settings, tools and projects move over automatically from ClipKit and DownKit 0.3 installs",
      ],
      fixed: [],
    },
  },
];

/** İstenen dilde notlar; sürüm bulunamazsa en yeni kayda, dil yoksa İngilizceye düşer. */
export function notesFor(version: string, lang: string): LocalizedNotes | null {
  const clean = version.replace(/^v/i, "");
  const entry = RELEASE_NOTES.find((n) => n.version === clean) ?? RELEASE_NOTES[0];
  if (!entry) return null;
  return lang.startsWith("tr") ? entry.tr : entry.en;
}
