use serde::Serialize;

// Frontend `src/types/media.ts` ile bire bir eşleşir (camelCase üzerinden).

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
    pub preview_url: Option<String>,
    pub quality_options: Vec<QualityOption>,
    pub audio_option: Option<AudioOption>,
    pub formats: Vec<FormatOption>,
    pub flac_eligible: bool,
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
}
