# paketle.bat'in son adimi. Exe her zaman en ustte durur:
# - proje kokunde DownKit.exe (kurulumsuz) ve DownKit-Kurulum.exe (git disi),
# - cikti\vX.Y.Z icinde GitHub Releases'e yuklenecek dosyalar ve SHA256SUMS.txt,
# - tasinabilir zip'in en ustunde DownKit.exe (alt klasor yok).
param(
  [Parameter(Mandatory)] [string] $Surum,
  [Parameter(Mandatory)] [string] $Kurulum,
  [Parameter(Mandatory)] [string] $Cikti
)
$ErrorActionPreference = "Stop"

$exe = "src-tauri\target\release\downkit.exe"
New-Item -ItemType Directory -Force $Cikti | Out-Null
$kurulumAdi = "DownKit-$Surum-kurulum.exe"
$exeAdi = "DownKit-$Surum.exe"
$zipAdi = "DownKit-$Surum-tasinabilir.zip"
Copy-Item $Kurulum (Join-Path $Cikti $kurulumAdi) -Force
Copy-Item $exe (Join-Path $Cikti $exeAdi) -Force

# Proje kokunde: cift tiklayip hemen calistirmak icin.
Copy-Item $exe "DownKit.exe" -Force
Copy-Item $Kurulum "DownKit-Kurulum.exe" -Force

$gecici = Join-Path ([IO.Path]::GetTempPath()) "downkit-paket-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $gecici | Out-Null
Copy-Item $exe (Join-Path $gecici "DownKit.exe")
$beniOku = @"
DownKit $Surum - kurulumsuz surum

1. DownKit.exe'yi ac (istersen once istedigin klasore ya da USB bellege tasi).
2. Windows "bilinmeyen yayinci" uyarisi verirse: "Ek bilgi" > "Yine de calistir".

Gereksinim: Windows 10 / 11 (64 bit) ve Microsoft Edge WebView2 (Windows 11'de hazir gelir).
Program ilk acilista FFmpeg, yt-dlp ve Deno'yu bir kez indirir. Ayarlar %APPDATA%\com.aderimo.downkit klasorunde durur.

(c) 2026 aderimo - MIT lisansi, acik kaynak: https://github.com/Aderimo/downkit
"@
Set-Content -Path (Join-Path $gecici "BENIOKU.txt") -Value $beniOku -Encoding ascii
$zipYolu = Join-Path $Cikti $zipAdi
if (Test-Path $zipYolu) { Remove-Item $zipYolu }
# Klasorun kendisi degil icindekiler: zip acilinca ilk gorunen DownKit.exe.
Compress-Archive -Path (Join-Path $gecici "*") -DestinationPath $zipYolu
Remove-Item -Recurse -Force $gecici

$satirlar = foreach ($ad in $exeAdi, $kurulumAdi, $zipAdi) {
  $h = (Get-FileHash (Join-Path $Cikti $ad) -Algorithm SHA256).Hash.ToLower()
  "$h  $ad"
}
Set-Content -Path (Join-Path $Cikti "SHA256SUMS.txt") -Value $satirlar -Encoding ascii
$satirlar | ForEach-Object { Write-Host "  $_" }
