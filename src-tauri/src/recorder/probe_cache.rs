//! Kodlayıcı ve ddagrab denemelerinin disk önbelleği.
//!
//! Her deneme bir FFmpeg süreci açıp ekranı yakalar; ilk kayıtta dört kodlayıcı
//! sırayla denenince geriye dönük kaydın açılması 3–10 sn sürüyordu. Sonuçlar
//! ekran kartı + sürücü + FFmpeg dosyası parmak iziyle saklanır; biri değişince
//! önbellek kendiliğinden geçersiz olur.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::args::Encoder;
use super::gpu;

const FILE: &str = "recorder-probe.json";

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ProbeCache {
    key: String,
    /// Anahtar: kare yolu ("dda"/"gfx") ve seçilen kodlayıcı ("dda:auto").
    #[serde(default)]
    encoders: HashMap<String, Encoder>,
    /// Anahtar: ddagrab çıkış sırası ve çözünürlük ("0:1920x1080").
    #[serde(default)]
    dda_ok: HashMap<String, bool>,
}

pub fn encoder_key(dda: bool, preferred: Option<Encoder>) -> String {
    let path = if dda { "dda" } else { "gfx" };
    let choice = preferred.map_or("auto", |e| e.id());
    format!("{path}:{choice}")
}

pub fn dda_key(index: u32, width: u32, height: u32) -> String {
    format!("{index}:{width}x{height}")
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FILE))
}

/// FFmpeg dosyasının boyutu ve tarihi: güncellenince denemeler yenilenir.
fn ffmpeg_stamp(ffmpeg_exe: &Path) -> String {
    std::fs::metadata(ffmpeg_exe)
        .map(|m| {
            let modified = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("{}-{modified}", m.len())
        })
        .unwrap_or_default()
}

pub fn current_key(ffmpeg_exe: &Path) -> String {
    format!(
        "{}#{}",
        gpu::fingerprint(&gpu::adapters()),
        ffmpeg_stamp(ffmpeg_exe)
    )
}

impl ProbeCache {
    /// Diskteki önbellek; anahtar tutmuyorsa boş (geçersiz) önbellek döner.
    pub fn load(app: &AppHandle, key: &str) -> ProbeCache {
        let cached = path(app)
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<ProbeCache>(&b).ok());
        match cached {
            Some(c) if c.key == key => c,
            _ => ProbeCache {
                key: key.to_string(),
                ..Default::default()
            },
        }
    }

    pub fn encoder(&self, dda: bool, preferred: Option<Encoder>) -> Option<Encoder> {
        self.encoders.get(&encoder_key(dda, preferred)).copied()
    }

    pub fn dda_ok(&self, key: &str) -> Option<bool> {
        self.dda_ok.get(key).copied()
    }

    pub fn set_encoder(&mut self, dda: bool, preferred: Option<Encoder>, encoder: Option<Encoder>) {
        let key = encoder_key(dda, preferred);
        match encoder {
            Some(e) => self.encoders.insert(key, e),
            None => self.encoders.remove(&key),
        };
    }

    pub fn set_dda_ok(&mut self, key: String, ok: bool) {
        self.dda_ok.insert(key, ok);
    }

    /// Yazılamazsa sessizce geçilir: önbellek yalnızca hız içindir.
    pub fn save(&self, app: &AppHandle) {
        if let (Some(p), Ok(bytes)) = (path(app), serde_json::to_vec_pretty(self)) {
            let _ = std::fs::write(p, bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_stable() {
        assert_eq!(encoder_key(true, None), "dda:auto");
        assert_eq!(encoder_key(false, Some(Encoder::Qsv)), "gfx:qsv");
        assert_eq!(dda_key(1, 2560, 1440), "1:2560x1440");
    }

    #[test]
    fn round_trips_through_json() {
        let mut cache = ProbeCache {
            key: "k".into(),
            ..Default::default()
        };
        cache.set_encoder(true, None, Some(Encoder::Nvenc));
        cache.set_dda_ok(dda_key(0, 1920, 1080), true);
        let back: ProbeCache =
            serde_json::from_slice(&serde_json::to_vec(&cache).unwrap()).unwrap();
        assert_eq!(back.encoder(true, None), Some(Encoder::Nvenc));
        assert_eq!(back.encoder(true, Some(Encoder::Amf)), None);
        assert_eq!(back.encoder(false, None), None);
        assert_eq!(back.dda_ok("0:1920x1080"), Some(true));
        cache.set_encoder(true, None, None);
        assert_eq!(cache.encoder(true, None), None);
    }
}
