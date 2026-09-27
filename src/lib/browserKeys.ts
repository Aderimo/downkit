// WebView2, Edge'in kendi kısayollarını da çalıştırır: Ctrl+P yazdırma ekranını,
// F7 "imleç ile gezinme" sorusunu, Alt+← geri gitmeyi açar. Masaüstü uygulamasında
// bunlar yalnızca kafa karıştırır; burada tarayıcının varsayılan davranışı
// engellenir. Olay durdurulmaz: uygulamanın kendi kısayolları onu yine alır.

const CTRL_KEYS = new Set(["p", "f", "g", "r", "s", "o", "j", "h", "u", "n"]);
const FUNCTION_KEYS = new Set(["F3", "F7"]);
const NAVIGATION_KEYS = new Set(["BrowserBack", "BrowserForward", "BrowserRefresh"]);

export function isBrowserShortcut(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  allowReload: boolean,
): boolean {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && CTRL_KEYS.has(key)) {
    return !(allowReload && key === "r");
  }
  if (FUNCTION_KEYS.has(e.key) || NAVIGATION_KEYS.has(e.key)) return true;
  if (e.key === "F5") return !allowReload;
  // Alt+←/→: geri/ileri gitmek arayüzü önceki sayfaya atar.
  return e.altKey && !e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight");
}

export function installBrowserKeyGuard(): void {
  // Geliştirirken yenileme (F5 / Ctrl+R) serbest.
  const allowReload = import.meta.env.DEV;
  window.addEventListener(
    "keydown",
    (e) => {
      if (isBrowserShortcut(e, allowReload)) e.preventDefault();
    },
    true,
  );
}
