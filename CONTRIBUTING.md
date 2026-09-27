# Contributing to DownKit

Thanks for helping! DownKit is free and open source (MIT), and every bug report,
translation and pull request makes it better.

**English** · [Türkçe](#türkçe)

## Reporting a bug

Every error in the app has a **Report this** link. It copies a short report (version,
error and technical details, with your user name removed) to the clipboard. Paste it
into a [new issue](../../issues/new) or on [Discord](https://discord.gg/z72EaBazJG) and
add a sentence about what you were doing.

## Translating DownKit

The interface text lives in `src/locales/`. Adding a language takes one file:

1. Copy `src/locales/en.json` to `src/locales/<code>.json`, using a standard language
   code (`de`, `fr`, `es`, `pt-BR`, `ar`…).
2. Set `"language": { "name": "…" }` to the language's own name (e.g. `"Deutsch"`).
   That's what shows up in **Settings → Language**.
3. Translate the values, not the keys. Keep these exactly as they are:
   - placeholders like `{{count}}`, `{{title}}`, `{{percent}}`
   - the small tags `<b>…</b>` (bold) and `<k>…</k>` (a keyboard key) used in the tours
   - plural pairs such as `clips_one` / `clips_other` (add the forms your language needs,
     see [i18next plurals](https://www.i18next.com/translation-function/plurals))
4. Run the app (`pnpm tauri dev`) and click through the pages; the language appears in
   Settings automatically. Anything you didn't translate falls back to English.
5. Open a pull request. Partial translations are welcome.

Turkish and English are maintained together; `pnpm test` checks they have the same keys
and placeholders.

## Code

Requirements and commands are in the [README](README.md#development). Before a pull
request, please run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
pnpm test:e2e   # arayüz testleri / interface tests (Edge)
cd src-tauri && cargo fmt --check && cargo clippy --all-targets && cargo test
```

Comments, commit messages and test names in this repository are written in Turkish;
identifiers are in English. If you don't speak Turkish, write them in English and we'll
take care of it.

DownKit does not break DRM or bypass access restrictions, and pull requests that do
won't be accepted.

---

## Türkçe

**Hata bildirmek:** Programdaki her hatanın yanında **Hatayı bildir** bağlantısı var.
Sürüm, hata ve teknik ayrıntıyı (kullanıcı adın çıkarılarak) panoya kopyalar;
[yeni bir issue](../../issues/new)'ya ya da [Discord](https://discord.gg/z72EaBazJG)'a
yapıştırıp ne yaparken olduğunu bir cümleyle yazman yeterli.

**Çeviri eklemek:** `src/locales/en.json` dosyasını `src/locales/<kod>.json` olarak
kopyala, `"language": { "name": "…" }` alanına dilin kendi adını yaz ve değerleri çevir
(anahtarları değil). `{{count}}` gibi yer tutucuları, `<b>`/`<k>` etiketlerini ve
`_one`/`_other` çoğul eklerini koru. Dil Ayarlar'da kendiliğinden görünür; çevrilmeyen
metinler İngilizce kalır. Yarım çeviriler de memnuniyetle kabul edilir.

**Kod:** Pull request açmadan önce yukarıdaki komutları çalıştır. Yorumlar, commit
mesajları ve test adları Türkçe; tanımlayıcılar İngilizce.
