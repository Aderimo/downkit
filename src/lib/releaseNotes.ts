// Yama notları: Ayarlar → Yama notları bölümünde ve güncelleme (ya da ilk kurulum)
// sonrası açılan "Yenilikler" penceresinde gösterilir. Her sürümde en ÜSTE yeni
// kayıt eklenir; sürüm numarası "v" öneki olmadan yazılır.

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
    version: "0.3.0",
    date: "2026-09-28",
    tr: {
      added: [
        "Ayarlar'da yeni Sayaç bölümü: toplam indirme ve aktif kullanıcı sayısı",
        "Ayarlar'da Yama notları bölümü; güncelleme sonrası ilk açılışta yenilikler penceresi",
        "Klip düzenleyicide kaynak küçük resimleri ve zaman çizelgesi görünümleri iyileştirildi",
        "Klip düzenleyicide kaynak ekleme, silme ve yeniden adlandırma geri alınabilir",
      ],
      fixed: [
        "Klip düzenleyicide ikinci videoya geçince oynatmanın donması",
        "Ekran kaydında tek monitörde ekran seçiminin onaylanmaması",
        "Bazı sistemlerdeki \"Ekran yakalanamadı\" hatası (otomatik yedek yakalama yolu)",
        "Ekran görüntüsü silinirken programın kapanması",
      ],
    },
    en: {
      added: [
        "New Counter section in Settings: total downloads and active users",
        "Patch notes section in Settings plus a What's New window on first launch after an update",
        "Improved source thumbnails and timeline visuals in the clip editor",
        "Adding, removing and renaming sources in the clip editor is now undoable",
      ],
      fixed: [
        "Playback freezing when the clip editor moved to the second video",
        "Screen selection not being applied on single-monitor setups",
        "\"Screen could not be captured\" error on some systems (automatic fallback capture path)",
        "App closing when a screenshot was deleted",
      ],
    },
  },
  {
    version: "0.2.1",
    date: "2026-09-26",
    tr: {
      added: ["Klip düzenleyicide Clipchamp tarzı medya paneli"],
      fixed: [],
    },
    en: {
      added: ["Clipchamp-style media panel in the clip editor"],
      fixed: [],
    },
  },
  {
    version: "0.2.0",
    date: "2026-09-25",
    tr: {
      added: [
        "Klip düzenleyicide çoklu kaynak birleştirme",
        "Aynı anda birden çok ekran kaydı",
        "Güncelleme akışı: kendiliğinden kurulum yok; yeni sürüm sorulur ve iki onayla sürüm sayfası açılır",
      ],
      fixed: [],
    },
    en: {
      added: [
        "Multi-source merging in the clip editor",
        "Multiple simultaneous screen recordings",
        "Update flow: no self-installing; new versions are asked about and the release page opens after two confirmations",
      ],
      fixed: [],
    },
  },
  {
    version: "0.1.0",
    date: "2026-09-24",
    tr: {
      added: [
        "İlk sürüm: indirme, dönüştürme, sıkıştırma, klip düzenleyici, ekran kaydı ve ekran görüntüsü",
      ],
      fixed: [],
    },
    en: {
      added: [
        "First release: download, convert, compress, clip editor, screen recorder and screenshots",
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
