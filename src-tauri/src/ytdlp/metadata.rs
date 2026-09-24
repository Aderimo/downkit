use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::error::AppError;
use crate::types::{
    AudioOption, FormatOption, MediaMetadata, PlaylistEntry, PlaylistInfo, QualityOption,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(45);

// Basit moddaki kart listesinde gösterilecek çözünürlükler, en yüksekten en düşüğe.
const CURATED_HEIGHTS: [u32; 8] = [2160, 1440, 1080, 720, 480, 360, 240, 144];

// Boyutlar bazı platformlarda ondalık gelir; u64 tanımlı tek bir alan bütün
// JSON'un ayrıştırılmasını düşürmesin diye f64 okunup sonra çevrilir.
#[derive(Debug, Deserialize)]
struct RawFormat {
    format_id: String,
    ext: Option<String>,
    height: Option<u32>,
    vcodec: Option<String>,
    acodec: Option<String>,
    abr: Option<f64>,
    filesize: Option<f64>,
    filesize_approx: Option<f64>,
    url: Option<String>,
    protocol: Option<String>,
}

impl RawFormat {
    fn is_storyboard(&self) -> bool {
        self.ext.as_deref() == Some("mhtml")
    }

    fn is_audio_only(&self) -> bool {
        matches!(self.vcodec.as_deref(), None | Some("none")) && !self.is_storyboard()
    }

    fn is_playable_video(&self) -> bool {
        !matches!(self.vcodec.as_deref(), None | Some("none")) && !self.is_storyboard()
    }

    fn size(&self) -> Option<u64> {
        self.filesize.or(self.filesize_approx).map(|v| v as u64)
    }

    fn has_audio(&self) -> bool {
        !matches!(self.acodec.as_deref(), None | Some("none"))
    }
}

/// Uygulama içi önizleme için doğrudan oynatılabilecek bir URL seçer:
/// ses+görüntü birleşik, düz HTTPS (m3u8/DASH değil), tercihen mp4 ve ≤720p.
fn pick_preview_url(formats: &[RawFormat]) -> Option<String> {
    formats
        .iter()
        .filter(|f| f.is_playable_video() && f.has_audio())
        .filter(|f| matches!(f.protocol.as_deref(), Some("https") | Some("http")))
        .filter(|f| f.url.is_some())
        .max_by_key(|f| {
            let height = f.height.unwrap_or(0);
            let fits = height <= 720;
            (
                f.ext.as_deref() == Some("mp4"),
                fits,
                if fits { height } else { u32::MAX - height },
            )
        })
        .and_then(|f| f.url.clone())
}

#[derive(Debug, Deserialize)]
struct RawInfo {
    #[serde(rename = "_type")]
    kind: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f64>,
    description: Option<String>,
    view_count: Option<f64>,
    upload_date: Option<String>,
    #[serde(default)]
    formats: Vec<RawFormat>,
    #[serde(default)]
    entries: Vec<Option<RawEntry>>,
    playlist_count: Option<f64>,
}

/// `--flat-playlist` ile gelen liste öğesi: yalnızca özet bilgi.
#[derive(Debug, Deserialize)]
struct RawEntry {
    id: Option<String>,
    url: Option<String>,
    title: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    thumbnails: Vec<RawThumbnail>,
}

#[derive(Debug, Deserialize)]
struct RawThumbnail {
    url: Option<String>,
    width: Option<f64>,
}

/// Analiz sonucu: tek video ya da oynatma listesi. Arayüzde `kind` alanıyla ayrılır.
// Analiz başına bir kez oluşup hemen JSON'a çevrildiği için boyut farkı önemsiz.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AnalyzeResult {
    Video(MediaMetadata),
    Playlist(PlaylistInfo),
}

/// Liste ilk bu kadar videoyla sınırlanır; çok büyük kanallar arayüzü kilitlemesin.
pub const MAX_PLAYLIST_ENTRIES: usize = 500;
const PLAYLIST_TIMEOUT: Duration = Duration::from_secs(120);

/// Linki analiz eder. `--flat-playlist` sayesinde tek bir çağrı hem tek videoyu
/// (tam bilgiyle) hem oynatma listesini (her videoyu ayrıca açmadan, hızlıca) tanır.
///
/// `force_playlist`: "watch?v=…&list=…" gibi hem videoya hem listeye işaret eden
/// linklerde varsayılan tek videodur; kullanıcı "Listeyi aç" derse true gelir.
pub async fn analyze(
    ytdlp_path: &Path,
    url: &str,
    platform: &str,
    extra_args: &[String],
    force_playlist: bool,
) -> Result<AnalyzeResult, AppError> {
    let mut command = Command::new(ytdlp_path);
    command
        .args([
            "--dump-single-json",
            "--flat-playlist",
            if force_playlist {
                "--yes-playlist"
            } else {
                "--no-playlist"
            },
            "--playlist-items",
            &format!("1:{MAX_PLAYLIST_ENTRIES}"),
            "--no-warnings",
        ])
        .args(extra_args)
        .arg(url)
        .creation_flags(CREATE_NO_WINDOW);

    let timeout = if force_playlist {
        PLAYLIST_TIMEOUT
    } else {
        ANALYZE_TIMEOUT
    };
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| {
            AppError::coded(
                "analyzeTimeout",
                "Video bilgileri zaman aşımına uğradı. Bağlantıyı kontrol edin veya daha sonra tekrar deneyin.",
                None,
            )
        })?
        .map_err(|e| {
            AppError::coded("toolStartFailed", "yt-dlp çalıştırılamadı.", Some(e.to_string()))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(match super::errors::friendly(&stderr) {
            Some(f) => AppError::coded(f.code, f.message, Some(stderr)),
            None => AppError::coded(
                "analyzeFailed",
                "Video bilgileri alınamadı. Bağlantıyı kontrol edin veya daha sonra tekrar deneyin.",
                Some(stderr),
            ),
        });
    }

    parse_analyze_output(&output.stdout, platform)
}

fn parse_analyze_output(stdout: &[u8], platform: &str) -> Result<AnalyzeResult, AppError> {
    let raw: RawInfo = serde_json::from_slice(stdout).map_err(|e| {
        AppError::coded(
            "analyzeParse",
            "Video bilgileri okunamadı.",
            Some(format!("{e}\n---\n{}", String::from_utf8_lossy(stdout))),
        )
    })?;

    if matches!(raw.kind.as_deref(), Some("playlist") | Some("multi_video")) {
        let playlist = map_playlist(raw, platform);
        if playlist.entries.is_empty() {
            return Err(AppError::coded(
                "emptyPlaylist",
                "Bu oynatma listesinde indirilebilecek video bulunamadı.",
                None,
            ));
        }
        return Ok(AnalyzeResult::Playlist(playlist));
    }
    Ok(AnalyzeResult::Video(map_metadata(raw, platform)))
}

fn map_playlist(raw: RawInfo, platform: &str) -> PlaylistInfo {
    let entries = raw
        .entries
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let title = entry.title.unwrap_or_default();
            // Gizli/silinmiş videolar listede yer tutar ama indirilemez.
            if title.is_empty() || matches!(title.as_str(), "[Private video]" | "[Deleted video]") {
                return None;
            }
            let url = entry
                .url
                .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
                .or_else(|| {
                    (platform == "youtube")
                        .then_some(entry.id.as_ref())
                        .flatten()
                        .map(|id| format!("https://www.youtube.com/watch?v={id}"))
                })?;
            Some(PlaylistEntry {
                url,
                title,
                duration_seconds: entry.duration,
                thumbnail_url: pick_thumbnail(&entry.thumbnails),
            })
        })
        .take(MAX_PLAYLIST_ENTRIES)
        .collect();

    PlaylistInfo {
        platform: platform.to_string(),
        title: raw.title.unwrap_or_else(|| "Playlist".to_string()),
        uploader: raw.uploader.or(raw.channel),
        entries,
        total_count: raw.playlist_count.map(|v| v as u64),
    }
}

/// Listede küçük gösterileceği için ≤480 px genişliğin en büyüğü seçilir.
fn pick_thumbnail(thumbnails: &[RawThumbnail]) -> Option<String> {
    thumbnails
        .iter()
        .filter(|t| t.url.is_some())
        .filter(|t| t.width.is_none_or(|w| w <= 480.0))
        .max_by(|a, b| a.width.unwrap_or(0.0).total_cmp(&b.width.unwrap_or(0.0)))
        .or_else(|| thumbnails.iter().rev().find(|t| t.url.is_some()))
        .and_then(|t| t.url.clone())
}

fn codec_label(codec: &str) -> String {
    let head = codec.split('.').next().unwrap_or(codec).to_lowercase();
    match head.as_str() {
        "avc1" | "h264" => "H.264".to_string(),
        "vp9" | "vp09" => "VP9".to_string(),
        "av01" => "AV1".to_string(),
        "vp8" => "VP8".to_string(),
        "mp4a" => "AAC".to_string(),
        "opus" => "Opus".to_string(),
        "none" => "-".to_string(),
        other => other.to_uppercase(),
    }
}

fn best_audio(formats: &[RawFormat]) -> Option<&RawFormat> {
    formats.iter().filter(|f| f.is_audio_only()).max_by(|a, b| {
        a.abr
            .unwrap_or(0.0)
            .total_cmp(&b.abr.unwrap_or(0.0))
            .then_with(|| a.size().unwrap_or(0).cmp(&b.size().unwrap_or(0)))
    })
}

fn best_video_at_height(formats: &[RawFormat], height: u32) -> Option<&RawFormat> {
    formats
        .iter()
        .filter(|f| f.is_playable_video() && f.height == Some(height))
        // mp4/avc1 en geniş uyumluluk için tercih edilir; eşitlikte en büyük dosya kazanır.
        .max_by(|a, b| {
            let mp4_a = a.ext.as_deref() == Some("mp4");
            let mp4_b = b.ext.as_deref() == Some("mp4");
            mp4_a
                .cmp(&mp4_b)
                .then_with(|| a.size().unwrap_or(0).cmp(&b.size().unwrap_or(0)))
        })
}

fn map_metadata(raw: RawInfo, platform: &str) -> MediaMetadata {
    let playable_formats: Vec<&RawFormat> =
        raw.formats.iter().filter(|f| !f.is_storyboard()).collect();

    let audio = best_audio(&raw.formats);
    let audio_size = audio.and_then(|a| a.size());

    let mut quality_options = Vec::new();
    for &height in &CURATED_HEIGHTS {
        if let Some(video) = best_video_at_height(&raw.formats, height) {
            // "none" acodec = video-only DASH akışı, indirirken ayrı ses dosyasıyla
            // birleştirilecek; aksi halde format zaten sesi içeriyor demektir.
            let needs_separate_audio = matches!(video.acodec.as_deref(), None | Some("none"));
            let combined_size = video.size().map(|v| {
                if needs_separate_audio {
                    v + audio_size.unwrap_or(0)
                } else {
                    v
                }
            });
            quality_options.push(QualityOption {
                height,
                container: "mp4".to_string(),
                estimated_size_bytes: combined_size,
            });
        }
    }

    let audio_option = audio.map(|a| AudioOption {
        container: a.ext.clone().unwrap_or_else(|| "m4a".to_string()),
        bitrate_kbps: a.abr.map(|v| v.round() as u32),
        estimated_size_bytes: a.size(),
    });

    let formats = playable_formats
        .into_iter()
        .map(|f| {
            let codec = if f.is_audio_only() {
                f.acodec.as_deref()
            } else {
                f.vcodec.as_deref()
            };
            FormatOption {
                format_id: f.format_id.clone(),
                container: f.ext.clone().unwrap_or_else(|| "mp4".to_string()),
                height: f.height,
                is_audio_only: f.is_audio_only(),
                codec_label: codec.map(codec_label),
                bitrate_kbps: f.abr.map(|v| v.round() as u32),
                estimated_size_bytes: f.size(),
            }
        })
        .collect();

    let preview_url = pick_preview_url(&raw.formats);

    MediaMetadata {
        platform: platform.to_string(),
        title: raw.title.unwrap_or_else(|| "Untitled".to_string()),
        uploader: raw.uploader,
        duration_seconds: raw.duration,
        thumbnail_url: raw.thumbnail,
        source_width: raw.width,
        source_height: raw.height,
        fps: raw.fps,
        description: raw.description,
        view_count: raw.view_count.map(|v| v as u64),
        upload_date: raw.upload_date,
        preview_url,
        quality_options,
        audio_option,
        formats,
        // Gerçek kayıpsız (lossless) tespiti yt-dlp'nin acodec alanına güvenilir
        // biçimde dayandırılamıyor; V1'de temkinli davranıp hep false dönüyoruz.
        flac_eligible: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tek_video_video_olarak_doner() {
        let json = br#"{"title":"Deneme","duration":12.5,"formats":[
            {"format_id":"18","ext":"mp4","height":360,"vcodec":"avc1","acodec":"mp4a","filesize":1000}
        ]}"#;
        match parse_analyze_output(json, "youtube").unwrap() {
            AnalyzeResult::Video(m) => {
                assert_eq!(m.title, "Deneme");
                assert_eq!(m.quality_options.len(), 1);
            }
            AnalyzeResult::Playlist(_) => panic!("video bekleniyordu"),
        }
    }

    #[test]
    fn oynatma_listesi_gizli_videolar_atilarak_doner() {
        let json = br#"{"_type":"playlist","title":"Liste","channel":"Kanal","playlist_count":3,"entries":[
            {"id":"aaa","url":"https://www.youtube.com/watch?v=aaa","title":"Bir","duration":61.0,
             "thumbnails":[{"url":"https://i/small.jpg","width":168},{"url":"https://i/mid.jpg","width":336},{"url":"https://i/big.jpg","width":1280}]},
            {"id":"bbb","title":"[Private video]"},
            {"id":"ccc","title":"Uc"},
            null
        ]}"#;
        match parse_analyze_output(json, "youtube").unwrap() {
            AnalyzeResult::Playlist(p) => {
                assert_eq!(p.title, "Liste");
                assert_eq!(p.uploader.as_deref(), Some("Kanal"));
                assert_eq!(p.total_count, Some(3));
                assert_eq!(p.entries.len(), 2);
                assert_eq!(
                    p.entries[0].thumbnail_url.as_deref(),
                    Some("https://i/mid.jpg")
                );
                // URL'si olmayan YouTube öğesi kimlikten tamamlanır.
                assert_eq!(p.entries[1].url, "https://www.youtube.com/watch?v=ccc");
            }
            AnalyzeResult::Video(_) => panic!("liste bekleniyordu"),
        }
    }

    #[test]
    fn indirilebilir_videosu_olmayan_liste_hata_verir() {
        let json = br#"{"_type":"playlist","title":"Bos","entries":[{"id":"x","title":"[Deleted video]"}]}"#;
        let err = parse_analyze_output(json, "youtube").unwrap_err();
        assert_eq!(err.code, Some("emptyPlaylist"));
    }

    #[test]
    fn bozuk_json_kodlu_hata_verir() {
        let err = parse_analyze_output(b"{bozuk", "youtube").unwrap_err();
        assert_eq!(err.code, Some("analyzeParse"));
    }
}
