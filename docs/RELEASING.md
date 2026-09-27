# Sürüm yayınlama / Releasing

Bakımcı için adım adım rehber. _Maintainer guide; the steps are the same in English —
the commands and file names are what matter._

## 0. Bir kez: GitHub deposu

1. github.com → **New repository** → ad `downkit`, sahibi `Aderimo`, **Public**. README,
   .gitignore ya da lisans **ekleme** (hepsi depoda zaten var).
2. Yerelde: `git remote add origin https://github.com/Aderimo/downkit.git` ve
   `git push -u origin main`.
3. Depo sayfasında sağdaki **About** (⚙) kutusu — aramada bulunmak için İngilizce:
   - **Description:** `Free, open-source media tool for Windows: download from YouTube, TikTok,
Instagram & more, cut scenes without downloading the whole video, compress, convert, record
your screen and take Lightshot-style screenshots.`
   - **Website:** `https://github.com/Aderimo/downkit/releases/latest`
   - **Topics:** `video-downloader`, `youtube-downloader`, `yt-dlp`, `ffmpeg`, `tauri`,
     `screen-recorder`, `screenshot-tool`, `lightshot-alternative`, `video-editor`,
     `windows`, `open-source`, `turkish`
4. **Settings → General → Social preview:** `docs/screenshots/en/home.png` yükle (link
   paylaşılınca bu görünür).

## 1. Bir kez: güncelleme anahtarı

DownKit, kurulumla gelen kopyalarda güncellemeyi uygulamanın içinden kurar. Güncelleme
dosyaları bir anahtarla imzalanır; uygulama yalnızca bu anahtarla imzalanmış dosyayı
kabul eder (`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`).

- Özel anahtar: `%USERPROFILE%\.tauri\downkit.key` — **depoya girmez, kaybetme.**
  Kaybolursa eski sürümler yeni güncellemeyi kabul etmez; bir yere yedekle.
- Yeniden oluşturmak gerekirse:
  `pnpm tauri signer generate -w "%USERPROFILE%\.tauri\downkit.key" --ci`
  ve yeni `.pub` içeriğini `tauri.conf.json`'daki `pubkey`'e yaz.
- `paketle.bat` anahtarı buradan kendisi okur.

GitHub'da (**Settings → Secrets and variables → Actions → New repository secret**):

| Ad                                   | Değer                                      |
| ------------------------------------ | ------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | `downkit.key` dosyasının içeriğinin tamamı |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | boş bırak (anahtar parolasız oluşturuldu)  |

## 2. Sürüm

1. `src-tauri/tauri.conf.json` ve `package.json` içindeki `version`'ı artır, `CHANGELOG.md`'ye ekle.
2. Commit + etiket: `git tag v0.2.0 && git push --tags`.
3. [Release iş akışı](../.github/workflows/release.yml) kurulum dosyasını, kurulumsuz exe'yi ve
   güncelleme bildirimini (`latest.json`) derleyip **taslak** bir sürüme ekler.
4. GitHub'da taslağı kontrol et ve **Publish** de. Yayınlanınca kurulu DownKit'ler
   durum çubuğunda "Güncelle"yi gösterir.

## 3. Kod imzalama (SmartScreen uyarısı)

İmzasız exe'lerde Windows "bilgisayarınızı korudu" der. Açık kaynak projeler için ücretsiz
imzalama: **[SignPath Foundation](https://signpath.org/)**.

1. signpath.org'dan başvur (proje: GitHub deposu, lisans: MIT). Onay birkaç gün sürebilir.
2. Onaylanınca SignPath'in verdiği GitHub Action adımını release iş akışına, derlemeden
   sonra ve `gh release upload`'dan önce ekle; `SIGNPATH_API_TOKEN` gizli değişkenini gir.
3. İmzalı `DownKit-Setup.exe` ve `DownKit.exe` yüklenir; SmartScreen uyarısı itibar
   oluştukça kaybolur.

Alternatif: ücretli bir kod imzalama sertifikası ya da Azure Trusted Signing.

## 4. winget

Sürüm yayınlandıktan sonra (`winget install aderimo.DownKit` ile kurulabilmesi için):

1. Karma değer: PowerShell'de
   `Get-FileHash .\DownKit-Setup.exe -Algorithm SHA256`
   (GitHub sürümündeki dosya).
2. `packaging/winget/aderimo.DownKit/` içindeki dört dosyada `PackageVersion`'ı,
   kurulum dosyasındaki `InstallerUrl` ve `InstallerSha256`'yı güncelle.
3. Gönder: [wingetcreate](https://github.com/microsoft/winget-create) ile
   `wingetcreate submit packaging/winget/aderimo.DownKit` ya da dosyaları
   [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) deposuna
   `manifests/a/aderimo/DownKit/<sürüm>/` altına koyup pull request aç.
4. Microsoft'un otomatik denetimi geçince (genelde 1–3 gün) paket yayına girer.

Sonraki sürümlerde `wingetcreate update aderimo.DownKit --version <sürüm> --urls <url> --submit`
tek komutla günceller.

## 5. Microsoft Store (isteğe bağlı)

Store için [Partner Center](https://partner.microsoft.com/) geliştirici hesabı gerekir
(bireysel hesap şu an ücretsiz). Store, NSIS kurulum dosyasını doğrudan kabul eder
("EXE/MSI uygulaması" olarak): kurulum dosyasının adresini ve sessiz kurulum
parametresini (`/S`) girmek yeterli.
