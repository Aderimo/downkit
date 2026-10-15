//! Düzenleyici, kayıt ve ekran görüntüsü önizlemeleri için yerel dosya sunucusu
//! (yalnızca 127.0.0.1).
//!
//! Bilgisayardaki dosyalar buradan parça parça (`Range` ile) sunulur; böylece web
//! görünümüne diskin tamamını açan geniş bir izin vermek gerekmez — yalnızca
//! kullanıcının açtığı dosya erişilebilir olur.
//!
//! Güvenlik: yalnızca geri döngü adresinde dinler; her kaynak tahmin edilemez bir
//! belirteçle (UUID) kayıtlıdır, belirteç olmadan hiçbir adres ya da dosya sunulmaz.

use std::convert::Infallible;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;

use crate::error::AppError;

/// Önizlemesi sunulacak kaynak: bilgisayardaki dosya.
#[derive(Debug, Clone)]
pub enum PreviewSource {
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
                        .serve_connection(TokioIo::new(stream), service_fn(handle))
                        .await;
                });
            }
        });
        Ok(port)
    })
    .await
    .copied()
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

async fn handle(req: Request<Incoming>) -> Result<Response<Body>, Infallible> {
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
    Ok(simple(StatusCode::NOT_FOUND, "path"))
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
