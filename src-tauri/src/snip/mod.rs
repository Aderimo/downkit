//! Ekran görüntüsü aracı (Lightshot / Ekran Alıntısı Aracı gibi): ekranın bir
//! bölgesini seçip düzenleme, kopyalama, kaydetme; görüntüdeki yazıyı okuma
//! (`ocr`, Windows'un kendi motoru, çevrimdışı) ve çeviri (`translate`).
//!
//! Akış: `snip_start` imlecin bulunduğu ekranın tam boy görüntüsünü alır ve
//! "snip" penceresini o ekranı kaplayacak şekilde açar. Pencere donmuş görüntüyü
//! gösterir, kullanıcı alanı seçer; `snip_finish` kırpar ve sonucu ana pencereye
//! `snip-result` olayıyla iletir. Ne yapılacağına (düzenle, kopyala, kaydet,
//! çevir) ana pencere karar verir: kayıt klasörü gibi ayarlar orada.

pub mod ocr;
pub mod translate;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use crate::commands::edit::sanitize_name;
use crate::error::AppError;
use crate::{jobs, preview};

const LABEL: &str = "snip";
/// Geçici görüntüler bir günden eskiyse açılışta silinir.
const TEMP_MAX_AGE: Duration = Duration::from_secs(24 * 3600);
/// Seçim bundan küçükse (yanlışlıkla tıklama) kırpılmaz.
const MIN_SIDE: u32 = 4;
/// Yalnızca bu uzantılar düzenleyicide açılır (OCR da bunları çözebilir).
const IMAGE_EXTENSIONS: [&str; 3] = ["png", "jpg", "jpeg"];

/// Seçim penceresinin gösterdiği donmuş ekran.
struct Frozen {
    /// RGBA, satır satır.
    rgba: Arc<Vec<u8>>,
    width: u32,
    height: u32,
    url: String,
    mode: String,
    /// Seçim bitince ana pencere yeniden gösterilsin mi (DownKit'teki düğmeyle başladıysa).
    restore_main: bool,
}

static FROZEN: Mutex<Option<Frozen>> = Mutex::new(None);

/// Seçim penceresinin açılışta istediği bilgi.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipState {
    url: String,
    width: u32,
    height: u32,
    /// "edit" | "translate": Enter'a basınca yapılacak iş.
    mode: String,
}

/// Düzenleyiciye giden görüntü.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipImage {
    path: String,
    url: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnipResult {
    image: SnipImage,
    /// "edit" | "translate" | "copy" | "save"
    action: String,
}

/// Seçim, donmuş görüntünün piksel koordinatlarında.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Seçimi görüntünün içine sığdırır; çok küçükse `None`.
fn clamp_rect(rect: Rect, width: u32, height: u32) -> Option<Rect> {
    let x = rect.x.min(width);
    let y = rect.y.min(height);
    let w = rect.width.min(width - x);
    let h = rect.height.min(height - y);
    (w >= MIN_SIDE && h >= MIN_SIDE).then_some(Rect {
        x,
        y,
        width: w,
        height: h,
    })
}

fn crop(rgba: &[u8], width: u32, rect: Rect) -> Vec<u8> {
    let stride = width as usize * 4;
    let mut out = Vec::with_capacity(rect.width as usize * rect.height as usize * 4);
    for row in rect.y..rect.y + rect.height {
        let start = row as usize * stride + rect.x as usize * 4;
        out.extend_from_slice(&rgba[start..start + rect.width as usize * 4]);
    }
    out
}

fn encode_png(rgba: &[u8], width: u32, height: u32, fast: bool) -> Result<Vec<u8>, AppError> {
    let mut png = Vec::new();
    let encoder = if fast {
        // Tam ekran geçici görüntü: hız önemli (4K'da varsayılan sıkıştırma ~0,5 sn).
        PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Sub)
    } else {
        PngEncoder::new(&mut png)
    };
    encoder
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|e| AppError::new("Görüntü kodlanamadı.", Some(e.to_string())))?;
    Ok(png)
}

fn temp_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::new("Geçici klasör bulunamadı.", Some(e.to_string())))?
        .join("snips");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new("Geçici klasör oluşturulamadı.", Some(e.to_string())))?;
    Ok(dir)
}

/// Bir günden eski geçici görüntüleri siler (düzenleyicide açık olan bugünkülerdir).
fn clean_temp(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > TEMP_MAX_AGE);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn temp_file(dir: &Path, prefix: &str) -> PathBuf {
    dir.join(format!("{prefix}-{}.png", uuid::Uuid::new_v4().simple()))
}

/// İmlecin bulunduğu ekran: tutamaç ve fiziksel dikdörtgeni (sol, üst, genişlik, yükseklik).
fn monitor_under_cursor() -> Option<(u64, i32, i32, u32, u32)> {
    unsafe {
        let mut point = POINT::default();
        GetCursorPos(&mut point).ok()?;
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let r = info.rcMonitor;
        Some((
            monitor.0 as usize as u64,
            r.left,
            r.top,
            (r.right - r.left) as u32,
            (r.bottom - r.top) as u32,
        ))
    }
}

async fn register(path: &Path, width: u32, height: u32) -> Result<SnipImage, AppError> {
    let (_, url) = preview::register_local(path).await?;
    Ok(SnipImage {
        path: path.to_string_lossy().into_owned(),
        url,
        width,
        height,
    })
}

fn show_main(app: &AppHandle, focus: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        if focus {
            let _ = window.set_focus();
        }
    }
}

/// Bölge seçimini başlatır: imlecin olduğu ekranı dondurur ve seçim penceresini
/// açar. `hide_main`: DownKit'teki düğmeyle başlatıldıysa önce ana pencere gizlenir
/// (yoksa görüntüde DownKit'in kendisi olur).
#[tauri::command]
pub async fn snip_start(app: AppHandle, mode: String, hide_main: bool) -> Result<(), AppError> {
    let mode = if mode == "translate" {
        "translate"
    } else {
        "edit"
    };
    let main = app.get_webview_window("main");
    let restore_main =
        hide_main && main.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false));
    if restore_main {
        if let Some(window) = &main {
            let _ = window.hide();
        }
        // Pencerenin kaybolma animasyonu bitsin.
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let captured = tokio::task::spawn_blocking(|| {
        let (hmonitor, left, top, _, _) = monitor_under_cursor()?;
        let (bgra, w, h) = crate::recorder::screenshot::grab_monitor(hmonitor)?;
        Some((crate::recorder::screenshot::to_rgba(&bgra), w as u32, h as u32, left, top))
    })
    .await
    .map_err(|e| AppError::new("Ekran görüntüsü alınamadı.", Some(e.to_string())))?;
    let Some((rgba, width, height, left, top)) = captured else {
        if restore_main {
            show_main(&app, false);
        }
        return Err(AppError::coded(
            "screenshotFailed",
            "Ekran görüntüsü alınamadı.",
            None,
        ));
    };

    let dir = temp_dir(&app)?;
    clean_temp(&dir);
    let rgba = Arc::new(rgba);
    let png = {
        let rgba = rgba.clone();
        tokio::task::spawn_blocking(move || encode_png(&rgba, width, height, true))
            .await
            .map_err(|e| AppError::new("Görüntü kodlanamadı.", Some(e.to_string())))??
    };
    let full = temp_file(&dir, "ekran");
    tokio::fs::write(&full, &png)
        .await
        .map_err(|e| AppError::new("Görüntü yazılamadı.", Some(e.to_string())))?;
    let image = register(&full, width, height).await?;

    *FROZEN.lock().unwrap() = Some(Frozen {
        rgba,
        width,
        height,
        url: image.url,
        mode: mode.to_string(),
        restore_main,
    });

    // Pencere ilk seferde kurulur, sonra gizlenip yeniden kullanılır.
    let window = match app.get_webview_window(LABEL) {
        Some(window) => {
            let _ = app.emit_to(LABEL, "snip-open", ());
            window
        }
        None => WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?snip=1".into()))
            .title("DownKit")
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|e| AppError::new("Seçim penceresi açılamadı.", Some(e.to_string())))?,
    };
    // Önce taşı, sonra boyutla: hedef ekranın ölçeği geçerli olsun.
    let _ = window.set_position(PhysicalPosition::new(left, top));
    let _ = window.set_size(PhysicalSize::new(width, height));
    // Pencere, görüntü yüklenince `snip_show` ile görünür olur (boş kare yanıp sönmesin).
    Ok(())
}

/// Seçim penceresi açılınca bunu sorar.
#[tauri::command]
pub fn snip_state() -> Option<SnipState> {
    FROZEN.lock().unwrap().as_ref().map(|f| SnipState {
        url: f.url.clone(),
        width: f.width,
        height: f.height,
        mode: f.mode.clone(),
    })
}

/// Görüntü yüklendi: seçim penceresi gösterilir ve odaklanır (Esc çalışsın).
#[tauri::command]
pub fn snip_show(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Seçim bitti: `rect` yoksa vazgeçildi. Kırpılan görüntü ana pencereye gider.
#[tauri::command]
pub async fn snip_finish(
    app: AppHandle,
    rect: Option<Rect>,
    action: String,
) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    let Some(frozen) = FROZEN.lock().unwrap().take() else {
        return Ok(());
    };
    let Some(rect) = rect.and_then(|r| clamp_rect(r, frozen.width, frozen.height)) else {
        if frozen.restore_main {
            show_main(&app, false);
        }
        return Ok(());
    };
    let rgba = frozen.rgba.clone();
    let width = frozen.width;
    let png = tokio::task::spawn_blocking(move || {
        encode_png(&crop(&rgba, width, rect), rect.width, rect.height, false)
    })
    .await
    .map_err(|e| AppError::new("Görüntü kırpılamadı.", Some(e.to_string())))??;
    let path = temp_file(&temp_dir(&app)?, "secim");
    tokio::fs::write(&path, &png)
        .await
        .map_err(|e| AppError::new("Görüntü yazılamadı.", Some(e.to_string())))?;
    let image = register(&path, rect.width, rect.height).await?;

    let action = match action.as_str() {
        "copy" | "save" | "translate" => action,
        _ => "edit".to_string(),
    };
    // Düzenle ve çevir DownKit'te açılır; kopyala ve kaydet arka planda biter.
    let opens = action == "edit" || action == "translate";
    if opens || frozen.restore_main {
        show_main(&app, opens);
    }
    app.emit_to("main", "snip-result", SnipResult { image, action })
        .map_err(|e| AppError::new("Görüntü iletilemedi.", Some(e.to_string())))
}

/// Ekran görüntülerinin varsayılan klasörü: ResimlerDownKit.
#[tauri::command]
pub fn snip_default_dir(app: AppHandle) -> Result<String, AppError> {
    let pictures = app
        .path()
        .picture_dir()
        .map_err(|e| AppError::new("Resimler klasörü bulunamadı.", Some(e.to_string())))?;
    Ok(pictures.join("DownKit").to_string_lossy().into_owned())
}

/// Bilgisayardaki bir görüntüyü düzenleyicide açar (yalnız PNG/JPEG).
#[tauri::command]
pub async fn snip_open_file(path: String) -> Result<SnipImage, AppError> {
    let file = Path::new(&path);
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) || !file.is_file() {
        return Err(AppError::coded(
            "unsupportedFile",
            "Yalnızca PNG ve JPEG görüntüler açılabilir.",
            Some(path),
        ));
    }
    let (width, height) = image::image_dimensions(file)
        .map_err(|e| AppError::new("Görüntü okunamadı.", Some(e.to_string())))?;
    register(file, width, height).await
}

/// Düzenlenmiş görüntünün baytları ham gövdeyle gelir (büyük görüntüyü JSON'a
/// çevirmemek için). Klasör ve ad başlıklarda, yüzde kodlamalı.
fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, AppError> {
    let raw = request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::new("Eksik bilgi.", Some(name.to_string())))?;
    Ok(url::form_urlencoded::parse(format!("v={raw}").as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default())
}

fn body(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, AppError> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err(AppError::new("Görüntü verisi gelmedi.", None)),
    }
}

/// Düzenlenmiş görüntüyü kaydeder; dosya yolunu döndürür. Uzantı yalnızca png/jpg/webp.
#[tauri::command]
pub async fn image_write(request: tauri::ipc::Request<'_>) -> Result<String, AppError> {
    let bytes = body(&request)?;
    let dir = PathBuf::from(header(&request, "x-dir")?);
    let name = sanitize_name(&header(&request, "x-name")?);
    let ext = match header(&request, "x-ext")?.as_str() {
        "jpg" => "jpg",
        "webp" => "webp",
        _ => "png",
    };
    if name.is_empty() || !dir.is_absolute() {
        return Err(AppError::new("Kayıt yeri geçersiz.", None));
    }
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::new("Klasör oluşturulamadı.", Some(e.to_string())))?;
    let output = jobs::unique_output_path(&dir, &name, ext);
    tokio::fs::write(&output, &bytes)
        .await
        .map_err(|e| AppError::new("Görüntü kaydedilemedi.", Some(e.to_string())))?;
    Ok(output.to_string_lossy().into_owned())
}

fn copy_png(app: &AppHandle, png: &[u8]) -> Result<(), AppError> {
    let image = tauri::image::Image::from_bytes(png)
        .map_err(|e| AppError::new("Görüntü okunamadı.", Some(e.to_string())))?;
    app.clipboard()
        .write_image(&image)
        .map_err(|e| AppError::new("Panoya kopyalanamadı.", Some(e.to_string())))
}

/// PNG baytlarını (ham gövde) panoya görüntü olarak kopyalar.
#[tauri::command]
pub async fn image_copy(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), AppError> {
    copy_png(&app, &body(&request)?)
}

/// Kırpılmış (henüz düzenlenmemiş) seçimi panoya kopyalar; yalnız geçici klasörden.
#[tauri::command]
pub async fn snip_copy(app: AppHandle, path: String) -> Result<(), AppError> {
    let file = inside_temp(&app, &path)?;
    let png = tokio::fs::read(&file)
        .await
        .map_err(|e| AppError::new("Görüntü okunamadı.", Some(e.to_string())))?;
    copy_png(&app, &png)
}

/// Kırpılmış seçimi kayıt klasörüne kopyalar; yeni dosyanın yolunu döndürür.
#[tauri::command]
pub async fn snip_save(
    app: AppHandle,
    path: String,
    dir: String,
    name: String,
) -> Result<String, AppError> {
    let file = inside_temp(&app, &path)?;
    let dir = PathBuf::from(dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::new("Klasör oluşturulamadı.", Some(e.to_string())))?;
    let output = jobs::unique_output_path(&dir, &sanitize_name(&name), "png");
    tokio::fs::copy(&file, &output)
        .await
        .map_err(|e| AppError::new("Görüntü kaydedilemedi.", Some(e.to_string())))?;
    Ok(output.to_string_lossy().into_owned())
}

/// Yalnızca bu modülün geçici klasöründeki dosyalar kopyalanır/kaydedilir.
fn inside_temp(app: &AppHandle, path: &str) -> Result<PathBuf, AppError> {
    let dir = temp_dir(app)?;
    let file = Path::new(path);
    let ok = file.parent().is_some_and(|p| p == dir) && file.is_file();
    if !ok {
        return Err(AppError::new("Görüntü bulunamadı.", Some(path.to_string())));
    }
    Ok(file.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secim_goruntuye_sigdirilir() {
        let r = clamp_rect(
            Rect {
                x: 90,
                y: 10,
                width: 50,
                height: 20,
            },
            100,
            100,
        )
        .unwrap();
        assert_eq!((r.x, r.y, r.width, r.height), (90, 10, 10, 20));
        // Görüntü dışından başlayan ya da çok küçük seçim kırpılmaz.
        let tiny = Rect {
            x: 10,
            y: 10,
            width: 2,
            height: 40,
        };
        assert!(clamp_rect(tiny, 100, 100).is_none());
        let outside = Rect {
            x: 200,
            y: 0,
            width: 50,
            height: 50,
        };
        assert!(clamp_rect(outside, 100, 100).is_none());
    }

    #[test]
    fn kirpma_dogru_satirlari_alir() {
        // 3×2 görüntü, her piksel kendi sırasıyla işaretli.
        let rgba: Vec<u8> = (0..6u8).flat_map(|i| [i, i, i, 255]).collect();
        let out = crop(
            &rgba,
            3,
            Rect {
                x: 1,
                y: 0,
                width: 2,
                height: 2,
            },
        );
        let marks: Vec<u8> = out.chunks(4).map(|p| p[0]).collect();
        assert_eq!(marks, vec![1, 2, 4, 5]);
    }
}
