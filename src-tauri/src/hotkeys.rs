//! Kısayol uygunluk denetimi: bir birleşim Windows'ta boş mu, yoksa başka bir
//! program onu kaydetmiş mi?
//!
//! Windows kayıtlı bir birleşimi yalnızca kaydeden programa verir; bu yüzden
//! kullanıcı kısayol seçerken hangisinin çalışacağını baştan görsün. Deneme,
//! kısayolların kendisinin de kullandığı standart `RegisterHotKey` ile yapılır ve
//! kayıt hemen bırakılır.

use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    MOD_SHIFT,
};

use crate::error::AppError;

/// "Ctrl+Alt+F9" → (değiştiriciler, sanal tuş kodu). Tanınmayan yazımda `None`.
fn parse(accelerator: &str) -> Option<(HOT_KEY_MODIFIERS, u32)> {
    let mut mods = MOD_NOREPEAT;
    let mut key = None;
    for part in accelerator.split('+') {
        match part {
            "Ctrl" => mods |= MOD_CONTROL,
            "Alt" => mods |= MOD_ALT,
            "Shift" => mods |= MOD_SHIFT,
            other if key.is_none() => key = Some(virtual_key(other)?),
            _ => return None,
        }
    }
    Some((mods, key?))
}

/// Tuş adı → Windows sanal tuş kodu (arayüzün ürettiği adlar).
fn virtual_key(name: &str) -> Option<u32> {
    if let Some(n) = name.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()) {
        return (1..=24).contains(&n).then_some(0x6F + n);
    }
    if let Some(n) = name
        .strip_prefix("Numpad")
        .and_then(|n| n.parse::<u32>().ok())
    {
        return (n <= 9).then_some(0x60 + n);
    }
    let mut chars = name.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            return Some(c as u32);
        }
    }
    Some(match name {
        "NumpadMultiply" => 0x6A,
        "NumpadAdd" => 0x6B,
        "NumpadSubtract" => 0x6D,
        "NumpadDecimal" => 0x6E,
        "NumpadDivide" => 0x6F,
        "Backspace" => 0x08,
        "Tab" => 0x09,
        "Enter" => 0x0D,
        "Pause" => 0x13,
        "Space" => 0x20,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "End" => 0x23,
        "Home" => 0x24,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "Insert" => 0x2D,
        "Delete" => 0x2E,
        "ScrollLock" => 0x91,
        "Semicolon" => 0xBA,
        "Equal" => 0xBB,
        "Comma" => 0xBC,
        "Minus" => 0xBD,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        "Backquote" => 0xC0,
        "BracketLeft" => 0xDB,
        "Backslash" => 0xDC,
        "BracketRight" => 0xDD,
        "Quote" => 0xDE,
        _ => return None,
    })
}

/// "Ctrl+Alt+F9" → (değiştirici bitleri, sanal tuş kodu); bitler: 1=Ctrl, 2=Alt, 4=Shift.
/// Yedek klavye kancası (hotkey_hook) bunu kullanır.
pub(crate) fn parse_combo(accelerator: &str) -> Option<(u8, u32)> {
    let (mods, vk) = parse(accelerator)?;
    let bits = (mods.contains(MOD_CONTROL) as u8)
        | ((mods.contains(MOD_ALT) as u8) << 1)
        | ((mods.contains(MOD_SHIFT) as u8) << 2);
    Some((bits, vk))
}

/// Her birleşim için: `Some(true)` boş, `Some(false)` başka bir programda,
/// `None` tanınmadı. DownKit'in kendi kısayolları denemeden önce bırakılmış
/// olmalı (arayüz düzenleyici açılınca bırakır), yoksa dolu görünürler.
#[tauri::command]
pub async fn hotkey_probe(accelerators: Vec<String>) -> Result<Vec<Option<bool>>, AppError> {
    // Kayıt, onu yapan iş parçacığına bağlıdır: deneme ve bırakma aynı yerde.
    tauri::async_runtime::spawn_blocking(move || {
        accelerators
            .iter()
            .enumerate()
            .map(|(i, accelerator)| {
                let (mods, vk) = parse(accelerator)?;
                let id = 0x5100 + i as i32;
                let free = unsafe { RegisterHotKey(None, id, mods, vk) }.is_ok();
                if free {
                    let _ = unsafe { UnregisterHotKey(None, id) };
                }
                Some(free)
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::new("Kısayollar denetlenemedi.", Some(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn birlesimler_sanal_tus_koduna_cevrilir() {
        assert_eq!(
            parse("Ctrl+Alt+F9"),
            Some((MOD_NOREPEAT | MOD_CONTROL | MOD_ALT, 0x78))
        );
        assert_eq!(parse("Alt+F"), Some((MOD_NOREPEAT | MOD_ALT, 0x46)));
        assert_eq!(
            parse("Ctrl+Shift+Numpad5"),
            Some((MOD_NOREPEAT | MOD_CONTROL | MOD_SHIFT, 0x65))
        );
        assert_eq!(
            parse("Ctrl+Comma"),
            Some((MOD_NOREPEAT | MOD_CONTROL, 0xBC))
        );
        assert_eq!(parse("F24"), Some((MOD_NOREPEAT, 0x87)));
    }

    #[test]
    fn taninmayan_yazim_reddedilir() {
        assert_eq!(parse("Ctrl+Alt"), None);
        assert_eq!(parse("Ctrl+Ş"), None);
        assert_eq!(parse("F25"), None);
        assert_eq!(parse("Ctrl+A+B"), None);
    }
}
