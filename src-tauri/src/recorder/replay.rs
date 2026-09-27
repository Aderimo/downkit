//! Geriye dönük kayıt (anlık tekrar): FFmpeg son parçaları halka hâlinde yazar,
//! `list.csv` bitmiş parçaları eskiden yeniye tutar. "Kaydet" denince son N
//! saniyeyi kapsayan parçalar ve o an yazılmakta olan parça birleştirilir.

use super::args::SEGMENT_SECONDS;

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub file: String,
    pub start: f64,
    pub end: f64,
}

impl Segment {
    fn duration(&self) -> f64 {
        (self.end - self.start).max(0.0)
    }
}

/// `seg0003.ts,6.050000,8.050000` satırları. Bozuk satırlar atlanır.
pub fn parse_list(csv: &str) -> Vec<Segment> {
    csv.lines()
        .filter_map(|line| {
            let mut parts = line.trim().rsplitn(3, ',');
            let end = parts.next()?.parse().ok()?;
            let start = parts.next()?.parse().ok()?;
            let file = parts.next()?.trim_matches('"').to_string();
            (!file.is_empty()).then_some(Segment { file, start, end })
        })
        .collect()
}

/// Halkadaki parça sayısı: istenen süre + yazılmakta olan + kaydederken üzerine
/// yazılmasın diye pay.
pub fn wrap_for(seconds: u32) -> u32 {
    seconds.div_ceil(SEGMENT_SECONDS) + 3
}

fn segment_index(file: &str) -> Option<u32> {
    let digits: String = file
        .trim_end_matches(".ts")
        .chars()
        .rev()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.chars().rev().collect::<String>().parse().ok()
}

pub fn segment_name(index: u32) -> String {
    format!("seg{index:04}.ts")
}

/// Kaydedilecek parçalar ve bir sonraki kaydın başlayacağı yer.
#[derive(Debug, Clone, PartialEq)]
pub struct Picked {
    /// Eskiden yeniye dosya adları; sonuncusu yazılmakta olan parça.
    pub files: Vec<String>,
    /// Yazılmakta olan parçanın başladığı an (akış saniyesi). Kaydettikten sonra
    /// arabellek buradan yeniden sayılır (NVIDIA'daki gibi): sonraki kayıt yalnızca
    /// bu andan sonrasını kapsar.
    pub current_start: f64,
}

/// Son `seconds`'ı kapsayan bitmiş parçalar ve yazılmakta olan parça.
/// `floor`: son kaydın alındığı parça başı; ondan eski parçalar alınmaz.
pub fn pick(list: &[Segment], seconds: f64, wrap: u32, floor: f64) -> Picked {
    let current = match list.last().and_then(|s| segment_index(&s.file)) {
        Some(index) => segment_name((index + 1) % wrap.max(1)),
        None => segment_name(0),
    };
    let current_start = list.last().map_or(0.0, |s| s.end);
    let after_floor = |start: f64| start >= floor - 0.05;
    let mut files: Vec<String> = Vec::new();
    let mut covered = 0.0;
    // Halka dolunca listedeki en eski parça, şu an üzerine yazılan dosyadır: atlanır.
    for segment in list
        .iter()
        .rev()
        .filter(|s| s.file != current && after_floor(s.start))
    {
        if covered >= seconds {
            break;
        }
        covered += segment.duration();
        files.push(segment.file.clone());
    }
    files.reverse();
    if after_floor(current_start) {
        files.push(current);
    }
    Picked {
        files,
        current_start,
    }
}

/// Arabellekte biriken süre (bitmiş parçalar).
pub fn buffered_seconds(list: &[Segment]) -> f64 {
    list.iter().map(Segment::duration).sum()
}

/// FFmpeg concat listesi; yoldaki tek tırnak kaçırılır.
pub fn concat_list(paths: &[String]) -> String {
    paths
        .iter()
        .map(|p| format!("file '{}'\n", p.replace('\'', "'\\''")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = "seg0002.ts,2.050000,4.050000\nseg0000.ts,4.050000,6.050000\n\
                        bozuk satır\nseg0001.ts,6.050000,8.050000\n";

    #[test]
    fn liste_eskiden_yeniye_okunur() {
        let list = parse_list(LIST);
        assert_eq!(list.len(), 3);
        assert_eq!(list[2].file, "seg0001.ts");
        assert!((buffered_seconds(&list) - 6.0).abs() < 1e-9);
    }

    #[test]
    fn son_saniyeler_ve_yazilan_parca_secilir() {
        let list = parse_list(LIST);
        // 3 saniye: son iki bitmiş parça (4 sn) + yazılmakta olan seg0002.
        assert_eq!(
            pick(&list, 3.0, 3, 0.0).files,
            ["seg0000.ts", "seg0001.ts", "seg0002.ts"]
        );
        // Arabellekten uzun süre istenirse elde olanın tamamı; üzerine yazılan
        // eski seg0002 bir kez (yazılmakta olan olarak) yer alır.
        assert_eq!(
            pick(&list, 60.0, 3, 0.0).files,
            ["seg0000.ts", "seg0001.ts", "seg0002.ts"]
        );
    }

    #[test]
    fn henuz_parca_bitmemisse_yalniz_ilk_parca() {
        assert_eq!(pick(&[], 30.0, 18, 0.0).files, ["seg0000.ts"]);
    }

    #[test]
    fn kaydettikten_sonra_arabellek_kayit_anindan_baslar() {
        let list = parse_list(LIST);
        let first = pick(&list, 60.0, 3, 0.0);
        // Yazılmakta olan parça son bitmiş parçanın sonunda (8,05) başladı.
        assert!((first.current_start - 8.05).abs() < 1e-9);
        // Birkaç parça sonra: kayıt anından önceki parçalar alınmaz.
        let later = parse_list("seg0002.ts,8.050000,10.050000\nseg0000.ts,10.050000,12.050000\n");
        assert_eq!(
            pick(&later, 60.0, 3, first.current_start).files,
            ["seg0002.ts", "seg0000.ts", "seg0001.ts"]
        );
        // Aynı parça bitmeden ikinci kez kaydedilirse yeni bir şey yok sayılmaz;
        // yazılmakta olan parça yine eklenir (çağıran çok kısa aralığı engeller).
        assert_eq!(pick(&list, 60.0, 3, 8.05).files, ["seg0002.ts"]);
    }

    #[test]
    fn halka_boyu_sureye_gore_hesaplanir() {
        assert_eq!(wrap_for(30), 18);
        assert_eq!(wrap_for(15), 11);
        assert_eq!(segment_index("seg0017.ts"), Some(17));
    }
}
