// api/search.js
// Google Books APIで漫画を検索（無料・APIキー不要）

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, type } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    if (type === "bulk_check") {
      const titles = query;
      const results = await Promise.all(
        titles.map(async (title) => {
          try {
            const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&langRestrict=ja&maxResults=40&orderBy=newest`;
            const r = await fetch(url);
            const data = await r.json();
            const items = data.items || [];
            let maxVol = 0;
            items.forEach(item => {
              const t = item.volumeInfo?.title || "";
              const m = t.match(/[（(]?(\d+)[）)]?巻/) || t.match(/Vol\.?\s*(\d+)/i);
              if (m) maxVol = Math.max(maxVol, parseInt(m[1]));
            });
            return { title, latest_volume: maxVol };
          } catch {
            return { title, latest_volume: 0 };
          }
        })
      );
      return res.status(200).json({ results });
    }

    // 複数クエリパターンで検索
    const queries = [
      `intitle:${query}`,
      `${query} コミック`,
      `${query}`,
    ];

    const seriesMap = {};

    for (const q of queries) {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=ja&maxResults=20`;
      const r = await fetch(url);
      const data = await r.json();
      const items = data.items || [];

      items.forEach(item => {
        const info = item.volumeInfo || {};
        const rawTitle = info.title || "";
        const baseTitle = rawTitle
          .replace(/[（(]\d+[）)]/g, "")
          .replace(/\s*[\d]+巻.*/g, "")
          .replace(/\s*Vol\.?\s*\d+.*/gi, "")
          .replace(/\s*#\d+.*/gi, "")
          .trim();
        if (!baseTitle) return;
        // クエリと関連するタイトルのみ採用
        const q_lower = query.toLowerCase();
        const t_lower = baseTitle.toLowerCase();
        if (!t_lower.includes(q_lower) && !q_lower.includes(t_lower)) return;
        if (!seriesMap[baseTitle]) {
          const author = (info.authors || []).join(", ");
          const publisher = info.publisher || "";
          const thumbnail = (info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || "")
            .replace("http://", "https://");
          seriesMap[baseTitle] = { title: baseTitle, author, publisher, cover_url: thumbnail };
        }
      });

      if (Object.keys(seriesMap).length > 0) break;
    }

    const series = Object.values(seriesMap).slice(0, 5);
    return res.status(200).json({ series });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
