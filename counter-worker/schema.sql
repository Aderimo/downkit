-- DownKit sayaç tablosu. Kurulum: README.md'deki 4. adım.
CREATE TABLE IF NOT EXISTS beats (
  id      TEXT PRIMARY KEY,  -- rastgele kurulum kimliği (UUID; kişisel veri değil)
  day     TEXT NOT NULL,     -- son görüldüğü gün: "2026-09-28"
  version TEXT               -- son kullandığı program sürümü
);
