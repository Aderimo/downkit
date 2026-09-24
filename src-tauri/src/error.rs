use serde::Serialize;

/// Kullanıcıya gösterilecek mesaj ile ham hata detayını ayrı tutar —
/// frontend `message`'ı doğrudan gösterir, `detail`'i "Teknik detayları göster" arkasında sunar.
///
/// `code` varsa arayüz mesajı kendi dilinde (`backendError.<code>`) gösterir;
/// `message` yalnızca kodu tanınmayan durumlar için Türkçe yedektir.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub message: String,
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
}

impl AppError {
    pub fn new(message: impl Into<String>, detail: Option<String>) -> Self {
        Self {
            message: message.into(),
            detail,
            code: None,
        }
    }

    pub fn coded(code: &'static str, message: impl Into<String>, detail: Option<String>) -> Self {
        Self {
            message: message.into(),
            detail,
            code: Some(code),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}
