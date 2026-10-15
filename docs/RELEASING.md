# Sürüm yayınlama

Bakımcı rehberi. Kurulum dosyaları bu deponun **GitHub Releases** sayfasında durur; program
yeni sürümü `api.github.com/repos/Aderimo/downkit/releases/latest` ile denetler
(`src/lib/updateCheck.ts`, `src/lib/links.ts`). Sunucu yok.

## 1. Sürüm numarası

Üç yerde aynı olmalı: `src-tauri/tauri.conf.json` (tek kaynak), `src-tauri/Cargo.toml`,
`package.json`. Yeni sürüm notunu `src/lib/releaseNotes.ts`'in en üstüne (Türkçe + İngilizce)
ve `CHANGELOG.md`'ye ekle.

## 2. Denetimler

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm test:e2e
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --lib
```

Aynıları her push'ta GitHub Actions'ta da çalışır (`.github/workflows/ci.yml`).

## 3. Paketleme

`paketle.bat`'ı çalıştır. Sonunda `cikti\vX.Y.Z\` içinde şunlar olur:

- `DownKit-X.Y.Z.exe` (kurulumsuz, doğrudan çalışır)
- `DownKit-X.Y.Z-kurulum.exe`
- `DownKit-X.Y.Z-tasinabilir.zip` (en üstte `DownKit.exe` + `BENIOKU.txt`)
- `SHA256SUMS.txt`

Ayrıca proje kökünde `DownKit.exe` ve `DownKit-Kurulum.exe` (git dışı) güncellenir.

**Sürüm numarası:** küçük değişiklikte son hane artar (0.4.0 → 0.4.1 → 0.4.2), ağır
değişiklikte orta hane (0.4.x → 0.5.0).

Kurulumu temiz bir Windows'ta (ya da sanal makinede) bir kez aç: bir link indir, bir dosya
dönüştür, kayıt al, hareketli başlıklı bir video dışa aktar.

## 4. GitHub Releases

```bash
git tag vX.Y.Z
git push origin main --tags
gh release create vX.Y.Z cikti/vX.Y.Z/* --title "DownKit X.Y.Z" --notes-file <notlar.md>
```

Notlara `CHANGELOG.md`'deki bölümü yapıştır. Yayından sonra eski sürümle açılan program (Ayarlar → **Açılışta yeni sürümü denetle**
açıkken) durum çubuğunda yeni sürümü haber vermeli.

## Asla yayınlanmayanlar

`.env*`, imza anahtarları (`%USERPROFILE%\.tauri\`), `cikti/`, `src-tauri/target/`,
`test-results/`. `.gitignore` bunları dışarıda tutar; yine de `git status`'a göz at.
