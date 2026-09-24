/// Hedef en-boy oranına göre kırpma (crop) ya da siyah bantla doldurma (pad)
/// filtresi kurar. "crop" kareyi tamamen doldurur (kenarlardan kırpabilir),
/// "pad" görüntünün tamamını korur (üstte/altta veya yanlarda siyah bant ekler).
pub fn build_args(target_width: u32, target_height: u32, fit_mode: &str) -> Vec<String> {
    let filter = if fit_mode == "pad" {
        format!(
            "scale={target_width}:{target_height}:force_original_aspect_ratio=decrease,pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        )
    } else {
        format!(
            "scale={target_width}:{target_height}:force_original_aspect_ratio=increase,crop={target_width}:{target_height},setsar=1"
        )
    };

    vec![
        "-vf".into(),
        filter,
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "23".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "128k".into(),
    ]
}
