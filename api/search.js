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
      // 複数作品の最新巻を一括チェック
      const titles = query; // string[]
      const results = await Promise.all(
        titles.map(async (title) => {
          try {
            const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title + " 漫画")}&langRestrict=ja&maxResults=40&orderBy=newest`;
            const r = await fetch(url);
            const data = await r.json();
            const items = data.items || [];
            // 巻数を抽出して最大値を取る
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

    // 通常の単一タイトル検索
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query + " 漫画 1巻")}&langRestrict=ja&maxResults=10`;
    const r = await fetch(url);
    const data = await r.json();
    const items = data.items || [];

    // シリーズ候補をまとめる
    const seriesMap = {};
    items.forEach(item => {
      const info = item.volumeInfo || {};
      const title = info.title || "";
      // 「タイトル(N)」「タイトル N巻」などから基本タイトルを抽出
      const baseTitle = title
        .replace(/[（(]\d+[）)]/g, "")
        .replace(/\s*\d+巻.*/, "")
        .replace(/\s*Vol\.\s*\d+.*/i, "")
        .trim();
      if (!baseTitle || baseTitle.length < 2) return;
      if (!seriesMap[baseTitle]) {
        const author = (info.authors || []).join(", ");
        const publisher = info.publisher || "";
        const isbn = (info.industryIdentifiers || []).find(x => x.type === "ISBN_13")?.identifier || "";
        const thumbnail = info.imageLinks?.thumbnail?.replace("http://", "https://") || "";
        seriesMap[baseTitle] = { title: baseTitle, author, publisher, cover_url: thumbnail, isbn };
      }
    });

    const series = Object.values(seriesMap).slice(0, 5);
    return res.status(200).json({ series });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
