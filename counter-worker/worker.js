// DownKit anonim kullanım sayacı (Cloudflare Worker + D1).
//
// POST /beat  { "id": "<uuid>", "version": "0.3.0", "day": "2026-09-28" }
//   → kurulum kimliği başına son görülme gününü yazar (varsa günceller).
// GET  /stats → { "active30": <son 30 günde görülen farklı kimlik sayısı> }
//
// Kişisel veri tutulmaz: id rastgele üretilmiş bir UUID'dir, isim/IP/adres
// saklanmaz. Kurulum adımları README.md'de.

const JSON_HEADERS = { "Content-Type": "application/json" };

/** UUID benzeri kimlik mi? (kötü niyetli şişirmeyi kabaca eler) */
function validId(id) {
  return typeof id === "string" && /^[0-9a-fA-F-]{32,40}$/.test(id);
}

function validDay(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/beat" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("geçersiz gövde", { status: 400 });
      }
      if (!validId(body.id) || !validDay(body.day)) {
        return new Response("geçersiz alan", { status: 400 });
      }
      const version = typeof body.version === "string" ? body.version.slice(0, 20) : null;
      await env.DB.prepare(
        `INSERT INTO beats (id, day, version) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET day = excluded.day, version = excluded.version`,
      )
        .bind(body.id, body.day, version)
        .run();
      return new Response("ok");
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM beats WHERE day >= date('now', '-30 days')",
      ).first();
      return new Response(JSON.stringify({ active30: row?.n ?? 0 }), { headers: JSON_HEADERS });
    }

    return new Response("DownKit sayacı çalışıyor.");
  },
};
