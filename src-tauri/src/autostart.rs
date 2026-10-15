//! Windows açılınca DownKit'i başlatma (Ayarlar → Genel). Kullanıcının kendi
//! "Run" kaydına yazılır (yönetici izni gerekmez). Bu yolla açılınca program
//! pencereyi göstermeden tepside başlar: geriye dönük kayıt hazır bekler.

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ, RRF_RT_REG_SZ,
};

use crate::error::AppError;

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME: &str = "DownKit";
/// Önceki adın kaydı (ClipKit): DownKit'e geçince silinir, yerine DownKit yazılır.
const OLD_VALUE_NAME: &str = "ClipKit";
/// Bu bağımsız değişkenle açılırsa pencere gösterilmez.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Program Windows açılışında (otomatik) mı başlatıldı.
pub fn launched_by_autostart() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

fn command_line() -> Result<String, AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::new("Program yolu bulunamadı.", Some(e.to_string())))?;
    Ok(format!("\"{}\" {AUTOSTART_ARG}", exe.display()))
}

fn current_value() -> Option<String> {
    value_of(VALUE_NAME)
}

fn value_of(name: &str) -> Option<String> {
    let mut buffer = [0u16; 1024];
    let mut size = (buffer.len() * 2) as u32;
    // SAFETY: tampon ve boyutu doğru verilir.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &HSTRING::from(RUN_KEY),
            &HSTRING::from(name),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

/// Açık mı: kayıt var ve bu programı gösteriyor (taşınmış eski kopyayı değil).
#[tauri::command]
pub fn autostart_get() -> bool {
    match (current_value(), command_line()) {
        (Some(value), Ok(expected)) => value.eq_ignore_ascii_case(&expected),
        _ => false,
    }
}

/// ClipKit Windows açılışında başlıyorsa: o kayıt silinir, DownKit açılışta başlar
/// (iki program birden açılmasın). Hata sessizce geçilir.
pub fn migrate_old_value() {
    if value_of(OLD_VALUE_NAME).is_none() {
        return;
    }
    if set_value(OLD_VALUE_NAME, false).is_ok() {
        let _ = set_value(VALUE_NAME, true);
    }
}

#[tauri::command]
pub fn autostart_set(enabled: bool) -> Result<bool, AppError> {
    set_value(VALUE_NAME, enabled)?;
    Ok(autostart_get())
}

fn set_value(value_name: &str, enabled: bool) -> Result<(), AppError> {
    let mut key = HKEY::default();
    // SAFETY: anahtar açılır, iş bitince kapatılır.
    let opened = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(RUN_KEY),
            None,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if opened.is_err() {
        return Err(AppError::new(
            "Başlangıç ayarı değiştirilemedi.",
            Some(format!("{opened:?}")),
        ));
    }
    let name = HSTRING::from(value_name);
    let result = if enabled {
        let line = command_line()?;
        let wide: Vec<u16> = line.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes =
            unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
        // SAFETY: REG_SZ için sonu sıfırla biten UTF-16 baytları verilir.
        unsafe { RegSetValueExW(key, PCWSTR(name.as_ptr()), None, REG_SZ, Some(bytes)) }
    } else {
        // SAFETY: değer yoksa hata döner; kapalı istenmişse sorun değil.
        let status = unsafe { RegDeleteValueW(key, &name) };
        if status.is_err() {
            windows::Win32::Foundation::ERROR_SUCCESS
        } else {
            status
        }
    };
    // SAFETY: yukarıda açılan anahtar.
    unsafe {
        let _ = RegCloseKey(key);
    }
    if result.is_err() {
        return Err(AppError::new(
            "Başlangıç ayarı değiştirilemedi.",
            Some(format!("{result:?}")),
        ));
    }
    Ok(())
}
