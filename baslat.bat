@echo off
setlocal EnableExtensions
chcp 65001 >nul
title DownKit
cd /d "%~dp0"

echo.
echo  ==================================================
echo    DOWNKIT - kontrol ve baslatma
echo  ==================================================
echo.

rem --- Araclar ------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [HATA] Node.js bulunamadi. nodejs.org adresinden 22 ya da ustunu kur.
  goto :hata
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo  [HATA] pnpm bulunamadi. Bu proje npm degil pnpm kullaniyor.
  echo         Bir kez su komutu calistir, sonra bu dosyayi yeniden ac:
  echo.
  echo           corepack enable
  goto :hata
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo  [HATA] Rust/cargo bulunamadi. rustup.rs adresinden kur.
  goto :hata
)

rem --- Kontroller ---------------------------------------------------------
rem Her adimin ciktisi yalnizca HATA olursa gosterilir; yesilse ekran temiz kalir.
call :adim 1 "Bagimliliklar" "pnpm install"
if errorlevel 1 goto :hata
call :adim 2 "Tip denetimi" "pnpm typecheck"
if errorlevel 1 goto :hata
call :adim 3 "Lint" "pnpm lint"
if errorlevel 1 goto :hata
call :adim 4 "Testler" "pnpm test"
if errorlevel 1 goto :hata
call :adim 5 "Bicim" "pnpm format:check"
if errorlevel 1 (
  echo         Duzeltmek icin: pnpm format
  goto :hata
)

echo.
echo  Butun kontroller yesil.
echo.
echo  Uygulama baslatiliyor (ilk acilista Rust tarafi derlenir, biraz surebilir)...
echo.
call pnpm tauri dev
goto :bitir

rem --- Alt program: tek bir kontrol adimi --------------------------------
rem %1 = adim no, %2 = ad, %3 = komut
:adim
echo  [%~1/5] %~2...
set "LOG=%TEMP%\downkit-adim-%~1.log"
call %~3 >"%LOG%" 2>&1
if errorlevel 1 (
  echo.
  type "%LOG%"
  echo.
  echo  [HATA] %~2 adimi basarisiz. Ayrintilar yukarida.
  exit /b 1
)
echo         tamam
exit /b 0

:hata
echo.
echo  Baslatma durduruldu.
echo  "cargo/rustc bulunamadi" veya linker hatasi goruyorsan:
echo    https://tauri.app/start/prerequisites/
call :bitir
exit /b 1

:bitir
rem Otomasyonda pencereyi bekletme: DOWNKIT_NO_PAUSE=1
if not defined DOWNKIT_NO_PAUSE (
  echo.
  pause
)
exit /b 0
