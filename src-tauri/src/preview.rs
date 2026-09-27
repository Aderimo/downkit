//! Düzenleyici önizlemesi için yerel aktarıcı (yalnızca 127.0.0.1).
//!
//! Neden gerekli: 1 saatlik bir videoyu indirmeden izleyip sahne seçebilmek için
//! akışı doğrudan oynatmak gerekiyor. Ancak YouTube'un HLS listeleri CORS başlığı
//! göndermiyor (hls.js reddedilir), TikTok gibi siteler ise yt-dlp'nin verdiği
//! başlıklar olmadan 403 döndürüyor. Aktarıcı isteği bu başlıklarla yapar, CORS
//! ekler ve HLS listelerindeki adresleri kendi üzerinden geçecek şekilde yeniden yazar.
//!
//! Bilgisayardaki dosyalar da buradan (parça parça, `Range` ile) sunulur; böylece
//! web görünümüne diskin tamamını açan geniş bir izin vermek gerekmez — yalnızca
//! kullanıcının düzenleyiciye açtığı dosya erişilebilir olur.
//!
//! Güvenlik: yalnızca geri döngü adresinde dinler; her kaynak tahmin edilemez bir
//! belirteçle (UUID) kayıtlıdır, belirteç olmadan hiçbir adres ya da dosya sunulmaz.

use std::convert::Infallible;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use bytes::Bytes;
use futures_util::TryStreamExt;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use url::Url;

use crate::error::AppError;

/// Önizlemesi sunulacak kaynak.
#[derive(Debug, Clone)]
pub enum PreviewSource {
    /// İnternetteki akış: yt-dlp'nin verdiği istek başlıklarıyla alınır.
    Remote {
        headers: Vec<(String, String)>,
        /// Kare şeridi için FFmpeg'e verilecek düşük çözünürlüklü akış.
        thumb_url: Option<String>,
        /// Dalga formu için düşük bit hızlı ses akışı.
        wave_url: Option<String>,
    },
    /// Bilgisayardaki dosya.
    Local { path: PathBuf },
}

/// Aynı anda tutulan kayıt sınırı; eski analizlerin belirteçleri düşer.
const MAX_SOURCES: usize = 48;
const FILE_CHUNK: usize = 256 * 1024;

type Body = BoxBody<Bytes, std::io::Error>;

fn sources() -> &'static Mutex<Vec<(String, PreviewSource)>> {
    static SOURCES: OnceLock<Mutex<Vec<(String, PreviewSource)>>> = OnceLock::new();
    SOURCES.get_or_init(|| Mutex::new(Vec::new()))
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// Aktarıcının portu; ilk ihtiyaçta başlatılır.
async fn port() -> Result<u16, AppError> {
    static PORT: tokio::sync::OnceCell<u16> = tokio::sync::OnceCell::const_new();
    PORT.get_or_try_init(|| async {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| {
            AppError::coded(
                "previewUnavailable",
                "Önizleme başlatılamadı.",
                Some(e.to_string()),
            )
        })?;
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    continue;
                };
                tauri::async_runtime::spawn(async move {
                    let _ = http1::Builder::new()
                        .serve_connection(
                            TokioIo::new(stream),
                            service_fn(move |req| handle(req, port)),
                        )
                        .await;
                });
            }
        });
        Ok(port)
    })
    .await
    .copied()
}

fn proxy_url(port: u16, token: &str, target: &str) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(target.as_bytes()).collect();
    format!("http://127.0.0.1:{port}/p/{token}?u={encoded}")
}

fn insert(source: PreviewSource) -> String {
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut list = sources().lock().unwrap();
    if list.len() >= MAX_SOURCES {
        list.remove(0);
    }
    list.push((token.clone(), source));
    token
}

pub fn lookup(token: &str) -> Option<PreviewSource> {
    sources()
        .lock()
        .unwrap()
        .iter()
        .find(|(t, _)| t == token)
        .map(|(_, s)| s.clone())
}

/// İnternetteki bir akışı kaydeder; belirteci ve `targets` içindeki her adresin
/// aktarıcı üzerinden oynatılabilir karşılığını (aynı sırayla) döner.
pub async fn register_remote(
    headers: Vec<(String, String)>,
    thumb_url: Option<String>,
    wave_url: Option<String>,
    targets: &[&str],
) -> Result<(String, Vec<String>), AppError> {
    let port = port().await?;
    let token = insert(PreviewSource::Remote {
        headers,
        thumb_url,
        wave_url,
    });
    let urls = targets.iter().map(|t| proxy_url(port, &token, t)).collect();
    Ok((token, urls))
}

/// Bilgisayardaki bir dosyayı kaydeder; belirteci ve oynatılabilir adresini döner.
pub async fn register_local(path: &Path) -> Result<(String, String), AppError> {
    let port = port().await?;
    let token = insert(PreviewSource::Local {
        path: path.to_path_buf(),
    });
    let url = format!("http://127.0.0.1:{port}/f/{token}");
    Ok((token, url))
}

fn with_cors(mut response: Response<Body>) -> Response<Body> {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Length, Content-Range, Accept-Ranges"),
    );
    response
}

fn full(bytes: Bytes) -> Body {
    Full::new(bytes).map_err(|never| match never {}).boxed()
}

fn simple(status: StatusCode, text: &'static str) -> Response<Body> {
    let mut response = Response::new(full(Bytes::from_static(text.as_bytes())));
    *response.status_mut() = status;
    with_cors(response)
}

async fn handle(req: Request<Incoming>, port: u16) -> Result<Response<Body>, Infallible> {
    if req.method() == Method::OPTIONS {
        let mut response = simple(StatusCode::NO_CONTENT, "");
        let headers = response.headers_mut();
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, HEAD, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Range"),
        );
        return Ok(response);
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return Ok(simple(StatusCode::METHOD_NOT_ALLOWED, "method"));
    }

    let path = req.uri().path().to_string();
    if let Some(token) = path.strip_prefix("/f/") {
        return Ok(match lookup(token) {
            Some(PreviewSource::Local { path }) => serve_file(&req, &path).await,
            _ => simple(StatusCode::NOT_FOUND, "token"),
        });
    }
    let Some(token) = path.strip_prefix("/p/") else {
        return Ok(simple(StatusCode::NOT_FOUND, "path"));
    };
    let Some(PreviewSource::Remote { headers, .. }) = lookup(token) else {
        return Ok(simple(StatusCode::NOT_FOUND, "token"));
    };
    let target = req.uri().query().and_then(|q| {
        url::form_urlencoded::parse(q.as_bytes())
            .find(|(k, _)| k == "u")
            .map(|(_, v)| v.into_owned())
    });
    let Some(target) = target.and_then(|t| Url::parse(&t).ok()) else {
        return Ok(simple(StatusCode::BAD_REQUEST, "url"));
    };
    if !matches!(target.scheme(), "http" | "https") {
        return Ok(simple(StatusCode::BAD_REQUEST, "scheme"));
    }
    Ok(forward(&req, &target, &headers, port, token).await)
}

async fn forward(
    req: &Request<Incoming>,
    target: &Url,
    headers: &[(String, String)],
    port: u16,
    token: &str,
) -> Response<Body> {
    let mut upstream = client().request(req.method().clone(), target.clone());
    for (name, value) in headers {
        upstream = upstream.header(name.as_str(), value.as_str());
    }
    if let Some(range) = req.headers().get(header::RANGE) {
        upstream = upstream.header(header::RANGE, range.clone());
    }
    let Ok(response) = upstream.send().await else {
        return simple(StatusCode::BAD_GATEWAY, "upstream");
    };

    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::OK);
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if is_playlist(target, &content_type) {
        let text = response.text().await.unwrap_or_default();
        let rewritten = rewrite_playlist(&text, target, |abs| proxy_url(port, token, abs));
        let mut out = Response::new(full(Bytes::from(rewritten)));
        *out.status_mut() = status;
        out.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/vnd.apple.mpegurl"),
        );
        return with_cors(out);
    }

    let passthrough: Vec<(header::HeaderName, HeaderValue)> = [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ]
    .into_iter()
    .filter_map(|name| {
        response
            .headers()
            .get(&name)
            .and_then(|v| HeaderValue::from_bytes(v.as_bytes()).ok())
            .map(|v| (name, v))
    })
    .collect();

    let stream = response
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(std::io::Error::other);
    let mut out = Response::new(BodyExt::boxed(StreamBody::new(stream)));
    *out.status_mut() = status;
    for (name, value) in passthrough {
        out.headers_mut().insert(name, value);
    }
    with_cors(out)
}

fn content_type_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" | "mov" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        // Ekran görüntüsü aracı (snip) da görüntüleri bu sunucudan gösterir.
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    }
}

/// `Range: bytes=a-b` başlığını dosya boyutuna göre kapsayıcı [a, b] aralığına çevirir.
/// Tek aralık desteklenir (oynatıcılar yalnızca bunu ister).
fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || size == 0 {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        ("", suffix) => {
            let len: u64 = suffix.parse().ok()?;
            (size.saturating_sub(len), size - 1)
        }
        (start, "") => (start.parse().ok()?, size - 1),
        (start, end) => (start.parse().ok()?, end.parse::<u64>().ok()?.min(size - 1)),
    };
    (start <= end && start < size).then_some((start, end))
}

async fn serve_file(req: &Request<Incoming>, path: &Path) -> Response<Body> {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return simple(StatusCode::NOT_FOUND, "file");
    };
    let size = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|v| parse_range(v, size));

    let (status, start, end) = match range {
        Some(Some((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end),
        Some(None) => {
            let mut response = simple(StatusCode::RANGE_NOT_SATISFIABLE, "");
            if let Ok(value) = HeaderValue::from_str(&format!("bytes */{size}")) {
                response.headers_mut().insert(header::CONTENT_RANGE, value);
            }
            return response;
        }
        None => (StatusCode::OK, 0, size.saturating_sub(1)),
    };
    let length = if size == 0 { 0 } else { end - start + 1 };
    if file.seek(SeekFrom::Start(start)).await.is_err() {
        return simple(StatusCode::INTERNAL_SERVER_ERROR, "seek");
    }

    let body = if req.method() == Method::HEAD {
        full(Bytes::new())
    } else {
        let stream =
            futures_util::stream::try_unfold((file, length), |(mut file, left)| async move {
                if left == 0 {
                    return Ok(None);
                }
                let mut buf = vec![0u8; FILE_CHUNK.min(left as usize)];
                let read = file.read(&mut buf).await?;
                if read == 0 {
                    return Ok(None);
                }
                buf.truncate(read);
                Ok(Some((
                    Frame::data(Bytes::from(buf)),
                    (file, left - read as u64),
                )))
            });
        BodyExt::boxed(StreamBody::new(stream))
    };

    let mut response = Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type_for(path)),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    if status == StatusCode::PARTIAL_CONTENT {
        if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")) {
            headers.insert(header::CONTENT_RANGE, value);
        }
    }
    with_cors(response)
}

fn is_playlist(url: &Url, content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.contains("mpegurl") || url.path().to_ascii_lowercase().ends_with(".m3u8")
}

/// HLS listesindeki her adresi (satır olarak ya da `URI="…"` içinde) mutlak hale
/// getirip `map` ile aktarıcı adresine çevirir. Oynatıcı alt listeleri, parçaları,
/// ses gruplarını ve şifre anahtarlarını da böylece aktarıcıdan ister.
pub fn rewrite_playlist(text: &str, base: &Url, map: impl Fn(&str) -> String) -> String {
    let resolve = |raw: &str| {
        base.join(raw)
            .map(|u| u.to_string())
            .unwrap_or_else(|_| raw.to_string())
    };
    let mut out = String::with_capacity(text.len() * 2);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push_str(line);
        } else if trimmed.starts_with('#') {
            out.push_str(&rewrite_uri_attributes(trimmed, |uri| map(&resolve(uri))));
        } else {
            out.push_str(&map(&resolve(trimmed)));
        }
        out.push('\n');
    }
    out
}

fn rewrite_uri_attributes(line: &str, map: impl Fn(&str) -> String) -> String {
    const KEY: &str = "URI=\"";
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find(KEY) {
        let value_start = start + KEY.len();
        let Some(len) = rest[value_start..].find('"') else {
            break;
        };
        out.push_str(&rest[..value_start]);
        out.push_str(&map(&rest[value_start..value_start + len]));
        out.push('"');
        rest = &rest[value_start + len + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(u: &str) -> String {
        format!("P[{u}]")
    }

    #[test]
    fn medya_listesindeki_parcalar_mutlak_adresle_aktarilir() {
        let base = Url::parse("https://cdn.example.com/vod/360p/index.m3u8?sig=1").unwrap();
        let text = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4.0,\nseg-1.m4s\n\n#EXTINF:4.0,\nhttps://other.example.com/seg-2.m4s\n#EXT-X-ENDLIST";
        let out = rewrite_playlist(text, &base, map);
        assert!(out.contains("#EXT-X-MAP:URI=\"P[https://cdn.example.com/vod/360p/init.mp4]\""));
        assert!(out.contains("\nP[https://cdn.example.com/vod/360p/seg-1.m4s]\n"));
        assert!(out.contains("\nP[https://other.example.com/seg-2.m4s]\n"));
        assert!(out.contains("#EXTINF:4.0,") && out.contains("#EXT-X-ENDLIST"));
    }

    #[test]
    fn ana_listedeki_ses_grubu_ve_varyantlar_aktarilir() {
        let base = Url::parse("https://m.example.com/master.m3u8").unwrap();
        let text = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",URI=\"audio/index.m3u8\",DEFAULT=YES\n#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO=\"a\"\nvideo/360.m3u8";
        let out = rewrite_playlist(text, &base, map);
        assert!(out.contains("URI=\"P[https://m.example.com/audio/index.m3u8]\",DEFAULT=YES"));
        assert!(out.contains("P[https://m.example.com/video/360.m3u8]"));
        assert!(
            out.contains("GROUP-ID=\"a\""),
            "URI olmayan tırnaklı değerlere dokunulmaz"
        );
    }

    #[test]
    fn liste_turu_uzanti_ya_da_icerik_turunden_anlasilir() {
        let playlist = Url::parse("https://x.com/a/index.m3u8").unwrap();
        let segment = Url::parse("https://x.com/a/seg.ts").unwrap();
        assert!(is_playlist(&playlist, ""));
        assert!(is_playlist(&segment, "application/vnd.apple.mpegURL"));
        assert!(!is_playlist(&segment, "video/mp2t"));
    }

    #[test]
    fn aktarici_adresi_hedefi_kodlar() {
        let url = proxy_url(5000, "abc", "https://x.com/a b?c=1&d=2");
        assert!(url.starts_with("http://127.0.0.1:5000/p/abc?u="));
        assert!(!url.contains(' ') && !url.contains("&d="));
    }

    #[test]
    fn bayt_araligi_dosya_boyutuna_gore_cozulur() {
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=100-199", 1000), Some((100, 199)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(
            parse_range("bytes=1000-", 1000),
            None,
            "dosya sonundan sonrası"
        );
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), None, "çoklu aralık");
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn kayit_siniri_asilinca_en_eski_belirtec_duser() {
        let first = insert(PreviewSource::Local {
            path: PathBuf::from("a.mp4"),
        });
        for _ in 0..MAX_SOURCES {
            insert(PreviewSource::Local {
                path: PathBuf::from("b.mp4"),
            });
        }
        assert!(lookup(&first).is_none());
        assert!(sources().lock().unwrap().len() <= MAX_SOURCES);
    }

    /// Gerçek bir akışın aktarıcı üzerinden alınabildiğini doğrular:
    /// ana liste → ilk varyant → ilk parça (CORS başlığıyla). Ağ gerektirir:
    /// `DOWNKIT_HLS_URL=<manifest_url> cargo test hls_aktarici -- --ignored`
    #[test]
    #[ignore]
    fn hls_aktarici_gercek_akista_calisir() {
        let Ok(master) = std::env::var("DOWNKIT_HLS_URL") else {
            return;
        };
        tauri::async_runtime::block_on(async move {
            let (_, urls) = register_remote(Vec::new(), None, None, &[&master])
                .await
                .unwrap();
            let get = |u: String| async move {
                let r = reqwest::get(&u).await.unwrap();
                assert_eq!(
                    r.headers()
                        .get("access-control-allow-origin")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string),
                    Some("*".to_string())
                );
                (r.status().as_u16(), r.bytes().await.unwrap())
            };
            let first_proxied = |body: &Bytes| {
                String::from_utf8_lossy(body)
                    .lines()
                    .find(|l| l.starts_with("http://127.0.0.1"))
                    .map(str::to_string)
            };
            let (status, body) = get(urls[0].clone()).await;
            assert_eq!(status, 200);
            let variant = first_proxied(&body).expect("varyant adresi aktarıcıya yazılmalı");
            let (status, body) = get(variant).await;
            assert_eq!(status, 200);
            let segment = first_proxied(&body).expect("parça adresi aktarıcıya yazılmalı");
            let (status, body) = get(segment).await;
            assert_eq!(status, 200);
            assert!(body.len() > 1000, "parça boş geldi");
        });
    }
}
