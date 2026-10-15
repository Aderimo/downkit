# Contributing

Bug reports, ideas and pull requests are welcome.

## Reporting a bug

- **From the app:** every error has a **Report** button. It copies a short report (version,
  error and technical details, without your user name) and opens a pre-filled
  [GitHub issue](https://github.com/Aderimo/downkit/issues/new). Add a sentence about what you
  were doing and submit it.
- **Directly:** open an [issue](https://github.com/Aderimo/downkit/issues/new) with the
  DownKit version (Settings → About), Windows version, the link or file type and the steps.
- **Questions and chat:** [Discord](https://discord.gg/z72EaBazJG).

Please do not paste personal files or private links into public issues.

## Pull requests

1. Fork, create a branch, keep the change focused.
2. Run the checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`,
   `pnpm test:e2e`, and in `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
   `cargo test --lib`.
3. Code comments, commit messages and test names are written in Turkish, like the rest of the
   code base; UI texts go into both `src/locales/tr.json` and `src/locales/en.json`.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

---

## Katkı (Türkçe)

Hata bildirimleri, öneriler ve pull request'ler memnuniyetle karşılanır.

- **Programdan:** her hatanın yanındaki **Bildir** düğmesi kısa bir raporu (sürüm, hata ve
  teknik ayrıntılar, kullanıcı adın olmadan) panoya kopyalar ve hazır doldurulmuş bir
  [GitHub bildirimi](https://github.com/Aderimo/downkit/issues/new) açar. Ne yaptığını bir
  cümleyle ekleyip gönder.
- **Sorular:** [Discord](https://discord.gg/z72EaBazJG).
- **Kod:** yukarıdaki denetimleri çalıştır; yorumlar, commit mesajları ve test adları Türkçe;
  arayüz metinleri hem `tr.json` hem `en.json`'a eklenir. Katkın MIT lisansıyla yayımlanır.
