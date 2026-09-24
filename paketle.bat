@echo off
setlocal EnableExtensions
title DownKit - paketleme
cd /d "%~dp0"

echo.
echo  ==================================================
echo    DOWNKIT - exe ve kurulum dosyasi olusturma
echo  ==================================================
echo.
echo  Sonunda bu klasorde iki dosya olur:
echo    DownKit.exe          - kurulumsuz, cift tiklayinca acilir
echo    DownKit-Setup.exe  - kurulum (istege bagli masaustu kisayolu)
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
tasklist /FI "IMAGENAME eq DownKit.exe" 2>nul | find /I "DownKit.exe" >nul
if not errorlevel 1 (
  echo  [HATA] DownKit su an acik. Programi kapatip bu dosyayi yeniden calistir.
  goto :hata
)

echo  [1/3] Bagimliliklar...
call pnpm install >"%TEMP%\downkit-paketle.log" 2>&1
if errorlevel 1 (
  type "%TEMP%\downkit-paketle.log"
  goto :hata
)
echo         tamam

echo  [2/3] Derleniyor (birkac dakika surer)...
call pnpm tauri build
if errorlevel 1 goto :hata

echo  [3/3] Dosyalar bu klasore kopyalaniyor...
copy /Y "src-tauri\target\release\downkit.exe" "DownKit.exe" >nul
if errorlevel 1 goto :hata
set "KURULUM="
for %%F in ("src-tauri\target\release\bundle\nsis\*-setup.exe") do set "KURULUM=%%F"
if not defined KURULUM (
  echo  [HATA] Kurulum dosyasi bulunamadi.
  goto :hata
)
copy /Y "%KURULUM%" "DownKit-Setup.exe" >nul
if errorlevel 1 goto :hata

echo.
echo  Hazir:
echo    %CD%\DownKit.exe
echo    %CD%\DownKit-Setup.exe
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
