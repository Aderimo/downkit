use serde::Serialize;

// Frontend `src/types/media.ts` ile bire bir eşleşir (camelCase üzerinden).

/// Videonun bölümü (YouTube'daki "chapters", MKV/MP4 bölüm işaretleri);
/// düzenleyicinin zaman çizelgesinde işaret olur.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub start: f64,
    pub end: f64,
    /// Başlıksız bölümde boş; arayüz "Bölüm 3" gibi gösterir.
    pub title: String,
}

const MAX_CHAPTERS: usize = 200;

impl Chapter {
    /// Ham bölümleri süreye sığdırır, sıralar, geçersizleri atar. Tek bölüm
    /// (videonun tamamı) işe yaramadığı için boş liste döner.
    pub fn normalize(
        raw: impl IntoIterator<Item = (f64, f64, Option<String>)>,
        duration: Option<f64>,
    ) -> Vec<Chapter> {
        let limit = duration
            .filter(|d| d.is_finite() && *d > 0.0)
            .unwrap_or(f64::MAX);
        let mut chapters: Vec<Chapter> = raw
            .into_iter()
            .filter(|(start, end, _)| start.is_finite() && end.is_finite())
            .map(|(start, end, title)| Chapter {
                start: start.max(0.0).min(limit),
                end: end.min(limit),
                title: title
                    .map(|t| t.trim().chars().take(120).collect())
                    .unwrap_or_default(),
            })
            .filter(|c| c.end - c.start >= 0.5)
            .collect();
        chapters.sort_by(|a, b| a.start.total_cmp(&b.start));
        chapters.truncate(MAX_CHAPTERS);
        if chapters.len() < 2 {
            chapters.clear();
        }
        chapters
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub format_id: String,
    pub container: String,
    pub height: Option<u32>,
    pub is_audio_only: bool,
    pub codec_label: Option<String>,
    pub bitrate_kbps: Option<u32>,
    pub estimated_size_bytes: Option<u64>,
}

/// Basit moddaki tıklanabilir kalite kartları — video+ses birleştirildiğinde
/// oluşacak yaklaşık toplam boyutla birlikte.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityOption {
    pub height: u32,
    pub container: String,
    pub estimated_size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOption {
    pub container: String,
    pub bitrate_kbps: Option<u32>,
    pub estimated_size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadata {
    pub platform: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
    pub fps: Option<f64>,
    pub description: Option<String>,
    pub view_count: Option<u64>,
    /// yt-dlp biçimi: YYYYMMDD
    pub upload_date: Option<String>,
    /// İndirmeden izlemek için yerel aktarıcı üzerinden oynatılabilir akış.
    pub preview: Option<PreviewStream>,
    /// Aktarıcıya kaydedilmeden önceki ham seçim; önyüze gönderilmez.
    #[serde(skip)]
    pub preview_source: Option<PreviewPick>,
    /// Zaman çizelgesindeki kare şeridi (yalnızca YouTube sağlıyor).
    pub storyboard: Option<Storyboard>,
    pub chapters: Vec<Chapter>,
    pub quality_options: Vec<QualityOption>,
    pub audio_option: Option<AudioOption>,
    pub formats: Vec<FormatOption>,
    pub flac_eligible: bool,
}

/// Linkin önizlemesi için seçilen akış (bkz. `ytdlp::metadata::pick_preview`).
#[derive(Debug, Clone)]
pub struct PreviewPick {
    /// "file" | "hls" | "split"
    pub kind: &'static str,
    pub url: String,
    /// "split" türünde ayrı ses dosyası.
    pub audio_url: Option<String>,
    pub headers: Vec<(String, String)>,
    /// Kare şeridi için FFmpeg'e verilecek düşük çözünürlüklü akış.
    pub thumb_url: Option<String>,
    /// Dalga formu için en düşük bit hızlı ses akışı (az veri insin).
    pub wave_url: Option<String>,
    pub has_video: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStream {
    /// "file" | "hls" | "split"
    pub kind: &'static str,
    pub url: String,
    pub audio_url: Option<String>,
    /// Kare şeridi gibi sonraki istekler bu belirteçle kaynağı bulur.
    pub token: String,
    pub has_video: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryboardSheet {
    pub url: String,
    /// Bu sayfadaki ilk karenin zamanı (saniye).
    pub start: f64,
    pub duration: f64,
}

/// Izgara biçiminde kare sayfaları: her sayfada `rows × columns` kare, kareler
/// arası `interval` saniye.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Storyboard {
    pub width: u32,
    pub height: u32,
    pub rows: u32,
    pub columns: u32,
    pub interval: f64,
    pub sheets: Vec<StoryboardSheet>,
}

/// Oynatma listesindeki tek bir video (hızlı "düz" liste — her video ayrıca
/// analiz edilmez; kuyruğa eklenince kendi işi başlarken analiz edilir).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub url: String,
    pub title: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistInfo {
    pub platform: String,
    pub title: String,
    pub uploader: Option<String>,
    pub entries: Vec<PlaylistEntry>,
    /// Platformun bildirdiği toplam video sayısı; `entries` sınırla kesilmiş olabilir.
    pub total_count: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMediaInfo {
    pub file_name: String,
    pub file_path: String,
    pub file_size_bytes: u64,
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Ortalama kare hızı (ör. 29.97, 60).
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub container: String,
    pub chapters: Vec<Chapter>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(start: f64, end: f64) -> (f64, f64, Option<String>) {
        (start, end, None)
    }

    #[test]
    fn bolumler_sureye_sigar_ve_siralanir() {
        let chapters = Chapter::normalize(
            [raw(50.0, 200.0), raw(-3.0, 50.0), raw(f64::NAN, 5.0)],
            Some(100.0),
        );
        let ranges: Vec<(f64, f64)> = chapters.iter().map(|c| (c.start, c.end)).collect();
        assert_eq!(ranges, [(0.0, 50.0), (50.0, 100.0)]);
    }

    #[test]
    fn tek_bolum_ise_yaramaz_bos_doner() {
        assert!(Chapter::normalize([raw(0.0, 100.0)], Some(100.0)).is_empty());
        // Süre dışında kalan bölüm (0,5 sn'den kısa) atılır, geriye tek bölüm kalır.
        assert!(Chapter::normalize([raw(0.0, 100.0), raw(99.8, 120.0)], Some(100.0)).is_empty());
    }
}
