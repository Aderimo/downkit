// Uygulamanın yapımcısı, topluluk ve proje bağlantıları (Kenar çubuğu, Hakkında, README).
// DownKit'in sunucusu yok: kaynak, sürümler ve hata bildirimleri GitHub'da.
export const AUTHOR_NAME = "aderimo";
export const AUTHOR_URL = "https://gitgit.me/aderimo";
export const DISCORD_URL = "https://discord.gg/z72EaBazJG";
/** Gönüllü destek; zorunlu değil, uygulama tamamen ücretsiz. */
export const DONATE_URL = "https://donate.bynogame.com/aderimo";

/** Açık kaynak depo: kod, sürümler (kurulum dosyaları) ve hata bildirimleri. */
export const REPO = "Aderimo/downkit";
export const REPO_URL = `https://github.com/${REPO}`;
/** Son sürüm (GitHub API): yeni sürüm denetimi. */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
/** Sürümün GitHub sayfası: v0.4.0 */
export const releasePageUrl = (version: string) => `${REPO_URL}/releases/tag/v${version}`;
/** Sosyal medya profilleri; programla gelen listeyi günceller. */
export const PROFILES_URL = `https://raw.githubusercontent.com/${REPO}/main/platforms.json`;

/** GitHub adres uzunluğu sınırına takılmasın (tarayıcılar ~8000 karakteri sorunsuz açar). */
const MAX_ISSUE_BODY = 6000;

/** Önceden doldurulmuş "yeni sorun" sayfası. Gönderme kullanıcının elinde: sayfada
 * görüp düzenleyebilir ya da vazgeçebilir. */
export function newIssueUrl(title: string, body: string): string {
  const params = new URLSearchParams({ title, body: body.slice(0, MAX_ISSUE_BODY) });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
