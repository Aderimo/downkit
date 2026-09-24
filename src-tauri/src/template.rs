/// Kullanıcı dostu `{title}` şablon belirteçlerini yt-dlp'nin kendi
/// `%(...)s` çıktı şablon sözdizimine çevirir — dosya adı temizleme
/// (yasak karakterler, MAX_PATH vb.) yt-dlp'nin kendi kanıtlanmış
/// sanitizer'ına bırakılır, tekerleği yeniden icat etmiyoruz.
pub fn translate_filename_template(template: &str) -> String {
    template
        .replace("{title}", "%(title)s")
        .replace("{uploader}", "%(uploader)s")
        .replace("{platform}", "%(extractor_key)s")
        .replace("{date}", "%(upload_date)s")
        .replace("{id}", "%(id)s")
        .replace("{ext}", "%(ext)s")
}
