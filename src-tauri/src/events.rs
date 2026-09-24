use serde::Serialize;

// Frontend `src/types/jobs.ts` olay yükleriyle bire bir eşleşir.
// Her iş, süreç bittiğinde tam olarak BİR terminal olay yayınlar:
// `*-complete`, `*-error` ya da `*-canceled`.

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub job_id: String,
    /// O anki akışın yüzdesi (video ve ses ayrı akışlarsa her biri 0→100).
    pub percent: Option<f64>,
    /// Tüm akışlar boyunca birikimli indirilen bayt.
    pub downloaded_bytes: u64,
    pub stream_total_bytes: Option<u64>,
    pub speed_bps: Option<f64>,
    pub eta_seconds: Option<f64>,
    /// "downloading" | "post_processing"
    pub stage: &'static str,
    /// "video" | "audio"
    pub stream: &'static str,
    pub stream_index: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegProgressPayload {
    pub job_id: String,
    pub percent: Option<f64>,
    pub speed: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCompletePayload {
    pub job_id: String,
    pub file_path: String,
    pub file_size_bytes: u64,
    /// İş başarılı ama kullanıcıya söylenmesi gereken bir şey oldu (ör. "subtitlesFailed").
    /// Arayüz bu kodu kendi dilinde gösterir.
    pub notice: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobErrorPayload {
    pub job_id: String,
    pub message: String,
    pub raw_detail: Option<String>,
    /// Tanınan hatalarda arayüzün kendi dilinde göstereceği kod (bkz. `AppError::code`).
    pub code: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCanceledPayload {
    pub job_id: String,
    /// Duraklatılan indirmede yarım dosyaların hedef yolu. Kullanıcı daha sonra
    /// "İptal"e basarsa arayüz bu yolla yarım dosyaları sildirir.
    pub partial_target: Option<String>,
}
