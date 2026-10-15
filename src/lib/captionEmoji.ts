import type { TextItem } from "./textItems";

// Altyazı emojileri: satırdaki anahtar kelimeye göre öneri (Türkçe ve İngilizce),
// satırın üstünde gösterilir. Önizleme ve dışa aktarma aynı PNG'yi (lib/emojiImage)
// aynı yerde çizer; konum `emojiBox` ile çıkış karesine göre hesaplanır.

/**
 * Emoji → anahtar kelime kökleri. Kök kelimenin başıyla eşleşir (Türkçe ekler:
 * "paralar", "parayı" → "para"); "=" ile biten yalnızca tam kelimeyle eşleşir.
 * Birden çok kök eşleşirse en uzunu kazanır ("kazandık" → 🏆, "kazanç" → 💰).
 */
const KEYWORDS: [string, string[]][] = [
  [
    "🔥",
    [
      "ateş",
      "yanıyor",
      "yangın",
      "efsane",
      "müthiş",
      "fire",
      "hot=",
      "lit=",
      "insane",
      "legendary",
    ],
  ],
  ["😂", ["güldüm", "gülmek", "gülüyor", "komik", "kahkaha", "haha", "lol=", "funny", "laugh"]],
  [
    "💰",
    [
      "para",
      "zengin",
      "kazanç",
      "kazan",
      "lira",
      "dolar",
      "maaş",
      "money",
      "cash",
      "rich",
      "earn",
      "salary",
    ],
  ],
  [
    "🏆",
    [
      "kazandı",
      "kazandık",
      "kazandım",
      "şampiyon",
      "zafer",
      "kupa",
      "win=",
      "won=",
      "winner",
      "champion",
      "victory",
      "trophy",
    ],
  ],
  ["❤️", ["aşk", "sevgi", "seviyorum", "sevdim", "kalp", "love", "heart"]],
  ["😱", ["şok", "inanılmaz", "korkunç", "korktum", "korku", "shock", "scary", "omg="]],
  ["🤯", ["çıldır", "çılgın", "akıl almaz", "crazy", "mind"]],
  ["🎮", ["oyun", "game", "gaming", "gamer", "play="]],
  ["💪", ["güçlü", "kuvvet", "antrenman", "spor=", "strong", "power", "workout", "gym="]],
  ["🚀", ["hızlı", "roket", "fırla", "fast=", "rocket", "boost", "launch"]],
  ["💡", ["fikir", "ipucu", "taktik", "öneri", "idea", "tip=", "tips=", "trick", "hack="]],
  ["⚠️", ["dikkat", "uyarı", "tehlike", "sakın", "warning", "careful", "danger"]],
  ["✅", ["başardı", "başarı", "onaylı", "correct", "done=", "success"]],
  ["❌", ["hayır", "yanlış", "asla", "no=", "wrong", "never"]],
  ["🤔", ["neden", "niye", "acaba", "düşün", "why=", "think", "wonder"]],
  ["👀", ["izle", "bakın=", "bakalım", "bak=", "gördün", "look", "watch"]],
  ["🎉", ["kutla", "tebrik", "parti", "doğum günü", "party", "celebrat", "congrat"]],
  ["😍", ["güzel", "muhteşem", "harika", "beautiful", "gorgeous", "cute=", "awesome"]],
  ["😢", ["üzgün", "ağla", "üzül", "sad=", "cry=", "crying"]],
  ["😡", ["sinir", "kızgın", "öfke", "angry", "mad="]],
  ["🍕", ["yemek", "pizza", "acıktım", "food", "eat=", "hungry"]],
  ["☕", ["kahve", "çay=", "coffee", "tea="]],
  ["📱", ["telefon", "uygulama", "phone", "app=", "mobile"]],
  [
    "💻",
    ["bilgisayar", "yazılım", "kodla", "kod=", "computer", "code", "coding", "software", "laptop"],
  ],
  ["📈", ["artış", "yüksel", "büyüme", "growth", "increase", "profit"]],
  ["📉", ["düşüş", "azal", "kayıp", "drop=", "decrease", "loss="]],
  ["⏰", ["dakika", "saniye", "acele", "geç kal", "minute", "hurry"]],
  ["🎵", ["müzik", "şarkı", "music", "song"]],
  ["📸", ["fotoğraf", "kamera", "photo", "camera"]],
  ["🌍", ["dünya", "ülke", "seyahat", "gezi", "world", "travel", "country"]],
  ["✈️", ["uçak", "tatil", "plane", "flight", "vacation"]],
  ["🏠", ["ev=", "evde", "evim", "eve=", "home=", "house"]],
  ["🐶", ["köpek", "dog=", "dogs=", "puppy"]],
  ["🐱", ["kedi", "cat=", "cats=", "kitten"]],
  ["⚽", ["futbol", "maç", "gol=", "football", "soccer"]],
  ["🎯", ["hedef", "amaç", "odak", "target", "focus", "goal"]],
  ["🧠", ["beyin", "akıl", "zeka", "öğren", "brain", "smart", "learn"]],
  ["📚", ["kitap", "ders=", "dersi", "okul", "eğitim", "book", "study", "school"]],
  ["💯", ["kesinlikle", "yüzde", "absolutely", "definitely", "100="]],
  ["🙏", ["teşekkür", "lütfen", "thanks", "thank", "please"]],
  ["👋", ["merhaba", "selam", "görüşürüz", "hoşça", "hello", "hi=", "bye="]],
  ["🔔", ["abone", "bildirim", "subscribe", "notification"]],
  ["👉", ["takip", "tıkla", "link=", "follow", "click"]],
  ["😎", ["havalı", "cool="]],
  ["💥", ["patla", "bomba", "boom", "explo", "bang="]],
  ["⭐", ["yıldız", "star="]],
  ["🎁", ["hediye", "çekiliş", "bedava", "ücretsiz", "gift", "giveaway", "free="]],
  ["🛒", ["alışveriş", "satın", "indirim", "shopping", "buy=", "sale="]],
  ["🚗", ["araba", "car=", "cars=", "drive"]],
  ["🌙", ["gece", "night"]],
  ["☀️", ["güneş", "sabah", "sun=", "sunny", "morning"]],
  ["💤", ["uyku", "uyudum", "yorgun", "sleep", "tired"]],
  ["🤝", ["anlaşma", "birlikte", "ortak", "deal=", "together", "partner"]],
  ["🔑", ["anahtar", "sırrı", "sır=", "gizli", "key=", "secret"]],
  ["🎬", ["video", "film", "sahne", "movie", "scene"]],
  ["🔴", ["canlı", "yayın", "live=", "stream"]],
  ["🙌", ["sonunda", "nihayet", "finally"]],
];

/** Elle seçmek için sık kullanılanlar (önerinin dışında). */
export const EMOJI_PICKS = [
  "🔥",
  "😂",
  "😱",
  "🤯",
  "😍",
  "😎",
  "🤔",
  "👀",
  "💰",
  "🏆",
  "💪",
  "🚀",
  "💡",
  "⚠️",
  "✅",
  "❌",
  "❤️",
  "🎉",
  "💯",
  "👉",
  "🔔",
  "🎮",
  "⏰",
  "🎯",
  "😢",
  "😡",
  "🙏",
  "👋",
  "⭐",
  "💥",
  "📈",
  "🎁",
];

const SEPARATOR = /[^\p{L}\p{N}\s]/gu;

/** Kelimenin karşılaştırma biçimleri: Türkçe ve İngilizce küçük harf ("IDEA" → "idea"). */
function forms(word: string): string[] {
  const clean = word.replace(SEPARATOR, "");
  const tr = clean.toLocaleLowerCase("tr");
  const en = clean.toLowerCase();
  return tr === en ? [tr] : [tr, en];
}

/** Kökle başlayan ama başka anlama gelen kelimeler ("paralel" ≠ para). */
const NOT_MATCHING = [
  "paralel",
  "parantez",
  "paragraf",
  "parazit",
  "ateşkes",
  "izlenim",
  "kalpazan",
  "partition",
];

function matchLength(word: string, key: string): number {
  if (NOT_MATCHING.some((x) => word.startsWith(x))) return 0;
  if (key.endsWith("=")) return word === key.slice(0, -1) ? key.length : 0;
  if (key.length < 3) return word === key ? key.length : 0;
  return word.startsWith(key) ? key.length : 0;
}

function bestFor(phrase: string): { emoji: string; score: number } | null {
  const words = phrase.split(" ");
  let best: { emoji: string; score: number } | null = null;
  for (const [emoji, keys] of KEYWORDS) {
    for (const key of keys) {
      // Çok kelimeli kök ("doğum günü") ifadenin içinde aranır.
      const score = key.includes(" ")
        ? phrase.includes(key)
          ? key.length
          : 0
        : Math.max(...words.map((w) => matchLength(w, key)));
      if (score > (best?.score ?? 0)) best = { emoji, score };
    }
  }
  return best;
}

/**
 * Satıra uygun emoji (yoksa null). Anahtar kelime işaretli (★) kelimeler önce
 * denenir; sonra satırın tamamında en uzun eşleşme.
 */
export function suggestEmoji(item: Pick<TextItem, "text" | "words">): string | null {
  const emphasized = (item.words ?? []).filter((w) => w.emph).map((w) => w.text);
  for (const phrase of [emphasized.join(" "), item.text]) {
    const text = phrase.replace(/\s+/g, " ").trim();
    if (!text) continue;
    let best: { emoji: string; score: number } | null = null;
    for (const form of forms(text)) {
      const hit = bestFor(form);
      if (hit && hit.score > (best?.score ?? 0)) best = hit;
    }
    if (best) return best.emoji;
  }
  return null;
}

/**
 * Otomatik altyazılara emoji önerir. Elle seçilmiş emoji korunur (`replace` değilse);
 * art arda gelen satırlarda aynı emoji tekrarlanmaz.
 */
export function applyAutoEmoji(texts: readonly TextItem[], replace = false): TextItem[] {
  const order = texts
    .filter((t) => t.auto)
    .sort((a, b) => a.start - b.start)
    .map((t) => t.id);
  const next = new Map<string, string | undefined>();
  let previous: { emoji: string; end: number } | null = null;
  for (const id of order) {
    const item = texts.find((t) => t.id === id)!;
    let emoji: string | undefined = replace ? undefined : item.emoji;
    if (!emoji) {
      const suggested = suggestEmoji(item);
      const repeated: boolean =
        previous !== null && previous.emoji === suggested && item.start - previous.end < 3;
      emoji = suggested && !repeated ? suggested : undefined;
    }
    next.set(id, emoji);
    if (emoji) previous = { emoji, end: item.end };
  }
  return texts.map((t) => {
    if (!next.has(t.id)) return t;
    const emoji = next.get(t.id);
    if (emoji === t.emoji) return t;
    return withEmoji(t, emoji);
  });
}

/** Satırın emojisini değiştirir (undefined: kaldırır). */
export function withEmoji(item: TextItem, emoji: string | undefined): TextItem {
  const next = { ...item };
  if (emoji) next.emoji = emoji;
  else delete next.emoji;
  return next;
}

/** Bütün otomatik altyazıların emojisini kaldırır. */
export function clearEmoji(texts: readonly TextItem[]): TextItem[] {
  return texts.map((t) => (t.auto && t.emoji ? withEmoji(t, undefined) : t));
}

/**
 * Satırlar yeniden bölününce (satır başına kelime değişti) emojiler yeni satırlara
 * taşınır: eski satırın emojisi, onunla çakışan ilk yeni satıra.
 */
export function carryEmoji(old: readonly TextItem[], fresh: readonly TextItem[]): TextItem[] {
  const taken = new Set<string>();
  const out = fresh.map((t) => ({ ...t }));
  for (const line of old) {
    if (!line.emoji) continue;
    const target = out.find((t) => !taken.has(t.id) && t.start < line.end && t.end > line.start);
    if (!target) continue;
    taken.add(target.id);
    target.emoji = line.emoji;
  }
  return out;
}

/** Dosya adı için kod noktaları: "❤️" → "2764-fe0f". */
export function emojiCode(emoji: string): string {
  return [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join("-");
}

/** Geçerli bir emoji mi (projeden gelen değer için). */
export function isEmoji(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 16 &&
    /\p{Extended_Pictographic}/u.test(v) &&
    !/[\p{L}\p{N}\s]/u.test(v.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, ""))
  );
}

interface Frame {
  width: number;
  height: number;
}

/**
 * Emojinin yeri: yazının üstünde ortada; yazı karenin tepesine yakınsa altında.
 * `x`, `y` merkez (0–1), `size` genişliğin çıkış genişliğine oranı (resim katmanı gibi).
 */
export function emojiBox(item: TextItem, frame: Frame): { x: number; y: number; size: number } {
  const short = Math.min(frame.width, frame.height);
  const font = Math.max(8, item.size * short);
  const px = font * 1.5;
  const lines = Math.max(1, item.text.split("\n").length);
  const half = lines * font * 0.5 + (item.bg ? font * 0.3 : 0);
  const center = item.y * frame.height;
  // PNG kenarlarında boşluk var: şeklin kendisi kutunun yaklaşık %80'i.
  let y = center - half - px * 0.42;
  if (y - px * 0.5 < frame.height * 0.02) y = center + half + px * 0.42;
  return { x: item.x, y: y / frame.height, size: px / frame.width };
}
