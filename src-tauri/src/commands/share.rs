//! Klibi kullanıcının kendi Discord kanalına gönderme (kanal ayarlarındaki
//! "Webhook" bağlantısıyla). Bağlantı yalnızca discord.com webhook adresi olabilir:
//! dosyalar başka bir sunucuya gönderilemesin.

use std::time::Duration;

use crate::commands::files::is_openable;
use crate::error::AppError;

/// Discord'un sunucu yükseltmesi olmadan kabul ettiği en büyük dosya.
pub const DISCORD_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// Geçerli bir Discord webhook adresi mi (yalnızca https, discord.com).
pub fn is_discord_webhook(url: &str) -> bool {
    let Some(rest) = url
        .strip_prefix("https://discord.com/api/webhooks/")
        .or_else(|| url.strip_prefix("https://discordapp.com/api/webhooks/"))
        .or_else(|| url.strip_prefix("https://ptb.discord.com/api/webhooks/"))
        .or_else(|| url.strip_prefix("https://canary.discord.com/api/webhooks/"))
    else {
        return false;
    };
    let mut parts = rest.split('/');
    let (Some(id), Some(token), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !id.is_empty()
        && id.chars().all(|c| c.is_ascii_digit())
        && !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Çok parçalı gövde: mesaj (payload_json) ve isteğe bağlı dosya.
fn multipart(boundary: &str, content: &str, file: Option<(&str, &[u8])>) -> Vec<u8> {
    let payload = serde_json::json!({ "content": content, "allowed_mentions": { "parse": [] } });
    let mut body = Vec::new();
    body.extend(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n{payload}\r\n"
        )
        .as_bytes(),
    );
    if let Some((name, bytes)) = file {
        // Dosya adındaki tırnak ve satır sonları başlığı bozmasın.
        let safe: String = name
            .chars()
            .map(|c| {
                if c == '"' || c == '\r' || c == '\n' {
                    '_'
                } else {
                    c
                }
            })
            .collect();
        body.extend(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"files[0]\"; filename=\"{safe}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend(b"\r\n");
    }
    body.extend(format!("--{boundary}--\r\n").as_bytes());
    body
}

/// Kanala mesaj (ve verilirse dosya) gönderir. Dosyasız çağrı bağlantıyı denemek içindir.
#[tauri::command]
pub async fn discord_send(
    webhook: String,
    path: Option<String>,
    content: String,
) -> Result<(), AppError> {
    if !is_discord_webhook(&webhook) {
        return Err(AppError::coded(
            "discordWebhook",
            "Bu bir Discord webhook bağlantısı değil.",
            None,
        ));
    }
    let file = match &path {
        Some(p) => {
            let file_path = std::path::Path::new(p);
            if !is_openable(file_path) || !file_path.is_file() {
                return Err(AppError::new("Bu dosya gönderilemiyor.", Some(p.clone())));
            }
            let size = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
            if size > DISCORD_MAX_BYTES {
                return Err(AppError::coded(
                    "discordTooLarge",
                    "Dosya Discord'un 10 MB sınırını aşıyor. Düzenleyicide \"Discord (10 MB)\" hazır ayarıyla dışa aktar.",
                    None,
                ));
            }
            let bytes = tokio::fs::read(file_path)
                .await
                .map_err(|e| AppError::new("Dosya okunamadı.", Some(e.to_string())))?;
            let name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("clip.mp4")
                .to_string();
            Some((name, bytes))
        }
        None => None,
    };
    let boundary = format!("downkit{}", uuid::Uuid::new_v4().simple());
    let body = multipart(
        &boundary,
        &content.chars().take(1900).collect::<String>(),
        file.as_ref().map(|(n, b)| (n.as_str(), b.as_slice())),
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::new("Bağlantı kurulamadı.", Some(e.to_string())))?;
    let response = client
        .post(&webhook)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| {
            AppError::coded(
                "discordNetwork",
                "Discord'a ulaşılamadı. İnternet bağlantını kontrol et.",
                Some(e.to_string()),
            )
        })?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let detail = response.text().await.unwrap_or_default();
    Err(match status.as_u16() {
        404 | 401 => AppError::coded(
            "discordWebhook",
            "Bu webhook bulunamadı ya da silinmiş. Discord'da yeni bir webhook bağlantısı oluştur.",
            Some(detail),
        ),
        413 => AppError::coded(
            "discordTooLarge",
            "Dosya Discord'un sınırını aşıyor. \"Discord (10 MB)\" hazır ayarıyla dışa aktar.",
            Some(detail),
        ),
        429 => AppError::new(
            "Discord çok sık gönderim yapıldığını söylüyor. Biraz bekle.",
            Some(detail),
        ),
        _ => AppError::new("Discord gönderimi kabul etmedi.", Some(detail)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yalnizca_discord_webhook_kabul_edilir() {
        assert!(is_discord_webhook(
            "https://discord.com/api/webhooks/123456/abc-DEF_9"
        ));
        assert!(is_discord_webhook(
            "https://discordapp.com/api/webhooks/1/x"
        ));
        assert!(!is_discord_webhook("http://discord.com/api/webhooks/1/x"));
        assert!(!is_discord_webhook("https://evil.com/api/webhooks/1/x"));
        assert!(!is_discord_webhook(
            "https://discord.com.evil.com/api/webhooks/1/x"
        ));
        assert!(!is_discord_webhook(
            "https://discord.com/api/webhooks/1/x/../../y"
        ));
        assert!(!is_discord_webhook(
            "https://discord.com/api/webhooks/abc/x"
        ));
        assert!(!is_discord_webhook(
            "https://discord.com/api/webhooks/1/x?wait=true"
        ));
    }

    #[test]
    fn govde_mesaj_ve_dosya_icerir() {
        let body = multipart("B", "selam", Some(("klip \"1\".mp4", b"DATA")));
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"payload_json\""));
        assert!(text.contains("\"content\":\"selam\""));
        assert!(text.contains("filename=\"klip _1_.mp4\""));
        assert!(text.contains("DATA\r\n--B--"));
    }
}
