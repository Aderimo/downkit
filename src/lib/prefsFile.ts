// Ayarların dosya yedeği (Rust `prefs`). WebView2'nin localStorage'ı bazı
// makinelerde oturumda yazılanları sonraki açılışta kaybedebildiği için
// `downkit.*` anahtarları ayrıca uygulamanın ayar dosyasına yazılır; açılışta
// localStorage bu dosyadan doldurulur. Ayarları okuyan modüller bundan sonra
// yüklenmelidir (bkz. main.tsx).

import { invoke } from "@tauri-apps/api/core";

const PREFIX = "downkit.";

function snapshot(): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) data[key] = localStorage.getItem(key) ?? "";
  }
  return data;
}

// Yazmalar birleştirilir: biri sürerken gelen değişiklikler bittiğinde tek
// seferde yazılır, böylece son değişiklik hiç kaybolmaz.
let dirty = false;
let writing: Promise<void> | null = null;

async function writeLoop() {
  while (dirty) {
    dirty = false;
    try {
      await invoke("prefs_save", { data: snapshot() });
    } catch {
      // Dosyaya yazılamazsa localStorage'daki kopya yine de geçerli.
    }
  }
  writing = null;
}

function schedule() {
  dirty = true;
  writing ??= writeLoop();
}

/** Bekleyen yazma bitene kadar bekler (programı kapatmadan önce). */
export async function flushPrefs(): Promise<void> {
  while (writing) await writing;
}

/** Dosyadaki ayarları localStorage'a yazar ve bundan sonraki her `downkit.*`
 * değişikliğini dosyaya da yansıtır. Tauri dışında (tarayıcı önizlemesi) bir
 * şey yapmaz. */
export async function initPrefsFile(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  let stored: Record<string, string>;
  try {
    stored = await invoke<Record<string, string>>("prefs_load");
  } catch {
    return;
  }
  try {
    const keys = Object.keys(stored);
    if (keys.length > 0) {
      for (const key of keys) localStorage.setItem(key, stored[key]);
      // Dosyada olmayan ama localStorage'da kalmış eski anahtarlar temizlenir.
      for (const key of Object.keys(snapshot())) {
        if (!(key in stored)) localStorage.removeItem(key);
      }
    } else {
      // İlk açılış (ya da güncelleme sonrası): mevcut ayarlar dosyaya taşınır.
      schedule();
    }
  } catch {
    return;
  }

  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  const clear = Storage.prototype.clear;
  const isOurs = (storage: Storage, key: string) =>
    storage === localStorage && String(key).startsWith(PREFIX);
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (isOurs(this, key)) schedule();
  };
  Storage.prototype.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (isOurs(this, key)) schedule();
  };
  Storage.prototype.clear = function (this: Storage) {
    clear.call(this);
    if (this === localStorage) schedule();
  };
}
