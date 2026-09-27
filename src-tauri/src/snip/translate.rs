//! İngilizce ↔ Türkçe çeviri: MyMemory'nin herkese açık, anahtarsız API'si
//! (https://mymemory.translated.net/doc/spec.php). Yalnızca kullanıcı "Çevir"e
//! basınca ve yalnızca metin gönderilir; görüntü bilgisayardan çıkmaz.
//! Sınırlar: istek başına 500 bayt (metin cümle cümle bölünür), anonim kullanımda
//! günde ~5000 karakter.

use std::time::Duration;

use serde::Deserialize;

use crate::error::AppError;

const ENDPOINT: &str = "https://api.mymemory.translated.net/get";
/// API'nin 500 baytlık sınırının altında kal (yüzde kodlama öncesi UTF-8 bayt).
const MAX_CHUNK: usize = 450;
const LANGUAGES: [&str; 2] = ["en", "tr"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    response_data: ResponseData,
    /// Çoğunlukla sayı, bazen metin ("403").
    response_status: serde_json::Value,
    #[serde(default)]
    response_details: serde_json::Value,
    #[serde(default)]
    quota_finished: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResponseData {
    translated_text: String,
}

/// Paragrafı en fazla `max` baytlık parçalara böler: önce cümle sonlarından,
/// gerekirse sözcük aralarından, en son (çok uzun tek sözcükte) karakterden.
pub fn split_chunks(paragraph: &str, max: usize) -> Vec<String> {
    let mut sentences: Vec<&str> = Vec::new();
    let mut start = 0;
    let bytes = paragraph.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        let end_of_sentence = matches!(b, b'.' | b'!' | b'?' | b';' | b':')
            && bytes.get(i + 1).is_some_and(|n| *n == b' ');
        if end_of_sentence {
            sentences.push(&paragraph[start..=i]);
            start = i + 1;
        }
    }
    sentences.push(&paragraph[start..]);

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let push_piece = |piece: &str, current: &mut String, chunks: &mut Vec<String>| {
        if current.len() + piece.len() > max && !current.trim().is_empty() {
            chunks.push(current.trim().to_string());
            current.clear();
        }
        current.push_str(piece);
    };
    for sentence in sentences {
        if sentence.len() <= max {
            push_piece(sentence, &mut current, &mut chunks);
            continue;
        }
        // Tek cümle sınırı aşıyor: sözcük sözcük.
        for word in sentence.split_inclusive(' ') {
            if word.len() <= max {
                push_piece(word, &mut current, &mut chunks);
            } else {
                // Aşırı uzun "sözcük" (ör. bağlantı): karakter sınırından bölünür.
                let mut rest = word;
                while !rest.is_empty() {
                    let mut cut = rest.len().min(max);
                    while !rest.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    push_piece(&rest[..cut], &mut current, &mut chunks);
                    rest = &rest[cut..];
                }
            }
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }
    chunks
}

/// API bazı karakterleri HTML varlığı olarak döndürür ("don&#39;t").
pub fn decode_entities(text: &str) -> String {
    text.replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn status_ok(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Number(n) => n.as_u64() == Some(200),
        serde_json::Value::String(s) => s == "200",
        _ => false,
    }
}

async fn translate_chunk(
    client: &reqwest::Client,
    text: &str,
    from: &str,
    to: &str,
) -> Result<String, AppError> {
    let mut url = url::Url::parse(ENDPOINT).expect("sabit adres");
    url.query_pairs_mut()
        .append_pair("q", text)
        .append_pair("langpair", &format!("{from}|{to}"));
    let response = client.get(url).send().await.map_err(|e| {
        AppError::coded(
            "translateOffline",
            "Çeviri hizmetine ulaşılamadı. İnternet bağlantını kontrol et.",
            Some(e.to_string()),
        )
    })?;
    if response.status().as_u16() == 429 {
        return Err(quota_error(None));
    }
    let body: Response = response
        .json()
        .await
        .map_err(|e| AppError::new("Çeviri yanıtı okunamadı.", Some(e.to_string())))?;
    let text = body.response_data.translated_text;
    if body.quota_finished == Some(true) || text.starts_with("MYMEMORY WARNING") {
        return Err(quota_error(Some(text)));
    }
    if !status_ok(&body.response_status) {
        return Err(AppError::new(
            "Çeviri yapılamadı.",
            Some(format!(
                "{} {}",
                body.response_status, body.response_details
            )),
        ));
    }
    Ok(decode_entities(&text))
}

fn quota_error(detail: Option<String>) -> AppError {
    AppError::coded(
        "translateQuota",
        "Bugünkü ücretsiz çeviri sınırı doldu (yaklaşık 5000 karakter). Yarın yeniden deneyebilirsin.",
        detail,
    )
}

/// Metni çevirir; paragraf yapısı (satır sonları) korunur. Diller: "en" ya da "tr".
#[tauri::command]
pub async fn translate_text(text: String, from: String, to: String) -> Result<String, AppError> {
    if !LANGUAGES.contains(&from.as_str()) || !LANGUAGES.contains(&to.as_str()) || from == to {
        return Err(AppError::new(
            "Bu dil çifti desteklenmiyor.",
            Some(format!("{from}→{to}")),
        ));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("DownKit/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::new("Çeviri başlatılamadı.", Some(e.to_string())))?;
    let mut out = Vec::new();
    for paragraph in text.split('\n') {
        if paragraph.trim().is_empty() {
            out.push(String::new());
            continue;
        }
        let mut parts = Vec::new();
        for chunk in split_chunks(paragraph, MAX_CHUNK) {
            parts.push(translate_chunk(&client, &chunk, &from, &to).await?);
        }
        out.push(parts.join(" "));
    }
    Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kisa_paragraf_tek_parca() {
        assert_eq!(split_chunks("Hello world.", 450), vec!["Hello world."]);
    }

    #[test]
    fn uzun_metin_cumle_sonlarindan_bolunur() {
        let text = "Birinci cümle burada. İkinci cümle de burada! Üçüncü mü? Evet.";
        let chunks = split_chunks(text, 30);
        assert!(chunks.iter().all(|c| c.len() <= 30), "{chunks:?}");
        assert_eq!(chunks.join(" "), text);
        assert!(chunks[0].ends_with('.'));
    }

    #[test]
    fn cok_uzun_cumle_sozcuklerden_bolunur() {
        let text = "kelime ".repeat(100);
        let chunks = split_chunks(text.trim(), 50);
        assert!(chunks.iter().all(|c| c.len() <= 50));
        assert_eq!(chunks.join(" "), text.trim());
    }

    #[test]
    fn tek_uzun_sozcuk_karakter_sinirindan_bolunur() {
        // Türkçe karakterler çok baytlı: kesim karakterin ortasına düşmemeli.
        let text = "ğ".repeat(100);
        let chunks = split_chunks(&text, 31);
        assert!(chunks.iter().all(|c| c.len() <= 31));
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn html_varliklari_cozulur() {
        assert_eq!(
            decode_entities("don&#39;t &amp; &quot;x&quot;"),
            "don't & \"x\""
        );
    }

    #[test]
    fn durum_sayi_ya_da_metin_olabilir() {
        assert!(status_ok(&serde_json::json!(200)));
        assert!(status_ok(&serde_json::json!("200")));
        assert!(!status_ok(&serde_json::json!(403)));
    }
}
