// api/claude.js
// Vercel Serverless Function
// フロントエンドからのリクエストを受けてAnthropicAPIを叩く（APIキーをサーバー側で管理）

export default async function handler(req, res) {
  // CORS設定
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, useWebSearch } = req.body;
  if (!messages) {
    return res.status(400).json({ error: "messages required" });
  }

  try {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages,
    };
    if (useWebSearch) {
      body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
