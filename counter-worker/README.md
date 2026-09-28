# DownKit Sayaç Sunucusu (Cloudflare Worker + D1)

Programın Ayarlar → Sayaç bölümündeki **"Aktif kullanıcı (son 30 gün)"** sayısı
bu küçük sunucudan gelir. Ücretsiz Cloudflare hesabıyla yaklaşık 10 dakikada
kurulur; hiçbir ücret gerekmez (Workers + D1 ücretsiz katmanı bu yükü fazlasıyla
karşılar).

## Ne yapar?

- Program (ayar açıksa) günde bir kez `POST /beat` ile rastgele bir kimlik,
  sürüm ve gün bilgisi gönderir. Kişisel veri **yoktur**.
- `GET /stats` son 30 günde görülen farklı kimlik sayısını döner.

## Kurulum (bir kez)

1. [dash.cloudflare.com](https://dash.cloudflare.com) üzerinden ücretsiz hesap aç.
2. Bilgisayarında Node.js varken terminalde:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
   (Tarayıcı açılır, Cloudflare hesabınla izin verirsin.)
3. Bu klasörde (`counter-worker/`):
   ```bash
   wrangler d1 create downkit-sayac
   ```
   Çıktıdaki `database_id = "..."` satırını `wrangler.toml` içindeki
   `BURAYA-D1-KIMLIGI-GELECEK` yerine yaz.
4. Tabloyu oluştur:
   ```bash
   wrangler d1 execute downkit-sayac --remote --file=schema.sql
   ```
5. Sunucuyu yayınla:
   ```bash
   wrangler deploy
   ```
   Çıktıda bir adres verir; örnek: `https://downkit-sayac.<hesap>.workers.dev`
6. Bu adresi `src/lib/counter.ts` içindeki `COUNTER_URL` sabitine tırnak içinde
   yaz (örn. `export const COUNTER_URL = "https://downkit-sayac.<hesap>.workers.dev";`),
   programı yeniden derle.

Hepsi bu. Bundan sonra programlar günde bir kez ping atar ve Sayaç bölümündeki
"Aktif kullanıcı" sayısı canlanır.

## Denemek için

```bash
curl -X POST https://<adresin>/beat -H "Content-Type: application/json" \
  -d "{\"id\":\"$(python -c 'import uuid;print(uuid.uuid4())')\",\"version\":\"0.3.0\",\"day\":\"$(date +%F)\"}"
curl https://<adresin>/stats
```

## Veriyi sıfırlamak istersen

```bash
wrangler d1 execute downkit-sayac --remote --command "DELETE FROM beats"
```
