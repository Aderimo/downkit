use std::collections::HashMap;
use std::sync::Mutex;

pub struct JobEntry {
    pub pid: u32,
    /// İptal/duraklatma isteği geldiyse işaretlenir; iş koşucusu süreç bitince
    /// buna bakarak "canceled" mı yoksa "error" mı yayınlayacağına karar verir.
    pub canceled: bool,
    /// İptal (duraklatma değil) istendiyse yarım kalan dosyalar da silinir.
    /// Duraklatmada tutulur ki yt-dlp devam ederken kaldığı yerden sürdürsün.
    pub discard_partial: bool,
}

/// Aktif işlerin job_id → süreç kaydı. İptal, PID'i `taskkill /T` ile kullanarak
/// yt-dlp'nin kendi başlattığı ffmpeg çocuğunu da içeren tüm süreç ağacını sonlandırır.
#[derive(Default)]
pub struct AppState {
    pub jobs: Mutex<HashMap<String, JobEntry>>,
}
