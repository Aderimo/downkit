@echo off
setlocal EnableExtensions
title DownKit - paketleme
cd /d "%~dp0"

echo.
echo  ==================================================
echo    DOWNKIT - kurulum ve tasinabilir paket olusturma
echo  ==================================================
echo.
echo  Proje kokunde: DownKit.exe (cift tikla, calisir) ve DownKit-Kurulum.exe
echo  cikti\vX.Y.Z klasorunde GitHub Releases icin:
echo    DownKit-X.Y.Z.exe             - kurulumsuz, dogrudan calisir
echo    DownKit-X.Y.Z-kurulum.exe     - kurulum
echo    DownKit-X.Y.Z-tasinabilir.zip - en ustte DownKit.exe + BENIOKU.txt
echo    SHA256SUMS.txt                - dosya ozetleri
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo  [HATA] pnpm bulunamadi. Once "corepack enable" komutunu calistir.
  goto :hata
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo  [HATA] Rust/cargo bulunamadi. rustup.rs adresinden kur.
  goto :hata
)

rem Acik bir DownKit varsa eski exe uzerine yazilamaz.
tasklist /FI "IMAGENAME eq downkit.exe" 2>nul | find /I "downkit.exe" >nul
if not errorlevel 1 (
  echo  [HATA] DownKit su an acik. Programi kapatip bu dosyayi yeniden calistir.
  goto :hata
)

rem Surum numarasinin tek kaynagi src-tauri\tauri.conf.json.
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version"`) do set "SURUM=%%V"
if not defined SURUM (
  echo  [HATA] Surum numarasi okunamadi.
  goto :hata
)
set "CIKTI=cikti\v%SURUM%"
echo  Surum: %SURUM%

echo  [1/3] Bagimliliklar...
call pnpm install >"%TEMP%\downkit-paketle.log" 2>&1
if errorlevel 1 (
  type "%TEMP%\downkit-paketle.log"
  goto :hata
)
echo         tamam

echo  [2/3] Derleniyor (birkac dakika surer)...
call pnpm tauri build --ci
if errorlevel 1 goto :hata

echo  [3/3] Paketler hazirlaniyor...
set "KURULUM="
for %%F in ("src-tauri\target\release\bundle\nsis\*-setup.exe") do set "KURULUM=%%F"
if not defined KURULUM (
  echo  [HATA] Kurulum dosyasi bulunamadi.
  goto :hata
)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\paketle.ps1 -Surum "%SURUM%" -Kurulum "%KURULUM%" -Cikti "%CIKTI%"
if errorlevel 1 goto :hata

echo.
echo  Hazir: %CD%\DownKit.exe ve %CD%\%CIKTI%
goto :bitir

:hata
echo.
echo  Paketleme durduruldu.
call :bitir
exit /b 1

:bitir
if not defined DOWNKIT_NO_PAUSE (
  echo.
  pause
)
exit /b 0
