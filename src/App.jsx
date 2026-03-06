import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase.js";
import { doc, getDoc, setDoc } from "firebase/firestore";

const FIRESTORE_DOC = "shared/collection";  // 全員が同じドキュメントを共有
const LOCATIONS = ["本棚A", "本棚B", "押し入れ", "実家", "その他"];
const initialData = { manga: [], wishlist: [] };

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function countOwned(m) {
  return (m.ownedVolumes || []).length;
}
function getMissingVolumes(m) {
  if (!m.total) return [];
  const owned = new Set(m.ownedVolumes || []);
  return Array.from({ length: m.total }, (_, i) => i + 1).filter(v => !owned.has(v));
}

// ---------- API（Vercel経由でAnthropicを呼ぶ）----------
async function callClaude(messages, useWebSearch = false) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, useWebSearch }),
  });
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return text;
}

async function searchMangaByTitle(query) {
  const text = await callClaude([{
    role: "user",
    content: `漫画「${query}」の書誌情報をJSON形式のみで返してください。説明文・コードブロック記号は不要。
形式: {"series":[{"title":"タイトル","author":"著者名","publisher":"出版社","latest_volume":最新巻数字,"status":"連載中または完結","cover_isbn":"1巻ISBN13ハイフンなし"}]}
複数シリーズあれば複数、なければ{"series":[]}`
  }], true);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { return JSON.parse(m[0]).series || []; } catch { return []; }
}

async function checkLatestVolumes(mangaList) {
  const serializing = mangaList.filter(m => m.status === "連載中");
  if (!serializing.length) return {};
  const titles = serializing.map(m => `「${m.title}」`).join("、");
  const text = await callClaude([{
    role: "user",
    content: `以下の漫画の最新刊巻数をJSON形式のみで返してください。説明文不要。
対象: ${titles}
形式: {"results":[{"title":"タイトル","latest_volume":数字,"status":"連載中または完結"}]}
不明はlatest_volume:0`
  }], true);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    const map = {};
    (JSON.parse(m[0]).results || []).forEach(r => { if (r.title) map[r.title] = r; });
    return map;
  } catch { return {}; }
}

async function fetchCoverFromOpenBD(isbn) {
  if (!isbn) return null;
  try {
    const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`);
    const data = await res.json();
    if (data?.[0]?.summary?.cover) return data[0].summary.cover;
  } catch {}
  return null;
}

// ---------- Firebase Storage ----------
async function loadFromFirestore() {
  const ref = doc(db, "shared", "collection");
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  return initialData;
}

async function saveToFirestore(data) {
  const ref = doc(db, "shared", "collection");
  await setDoc(ref, data);
}

// ---------- UI Parts ----------
function Spinner({ size = 32 }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: size === 32 ? "40px" : "8px" }}>
      <div style={{ width: size, height: size, borderRadius: "50%", border: `${size > 20 ? 3 : 2}px solid #e8d5b7`, borderTopColor: "#c0392b", animation: "spin 0.8s linear infinite" }} />
    </div>
  );
}

function Toast({ message, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#2c1810", color: "#f5e6d3", padding: "10px 20px", borderRadius: 20, fontSize: 14, fontFamily: "'Noto Serif JP', serif", boxShadow: "0 4px 20px rgba(0,0,0,0.4)", zIndex: 9999, whiteSpace: "nowrap", animation: "fadeInUp 0.3s ease" }}>
      {message}
    </div>
  );
}

// ---------- 巻ごと管理モーダル ----------
function VolumeModal({ manga, onSave, onClose }) {
  const [owned, setOwned] = useState(new Set(manga.ownedVolumes || []));
  const total = manga.total || 0;
  const toggle = (v) => setOwned(prev => { const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next; });
  const missing = Array.from({ length: total }, (_, i) => i + 1).filter(v => !owned.has(v));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,24,16,0.75)", zIndex: 500, display: "flex", alignItems: "flex-end", animation: "fadeIn 0.2s ease" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fdf6ec", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 430, margin: "0 auto", maxHeight: "88vh", display: "flex", flexDirection: "column", animation: "slideUp 0.3s ease" }}>
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #e8d5b7" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 3 }}>{manga.title}</div>
              <div style={{ fontSize: 12, color: "#9a7a6a" }}>
                所持 <strong style={{ color: "#c0392b", fontSize: 15 }}>{owned.size}</strong>
                {total > 0 && <> / {total}巻</>}
                {missing.length > 0 && <span style={{ color: "#c0392b", marginLeft: 8 }}>抜け {missing.length}冊</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9a7a6a" }}>✕</button>
          </div>
          {missing.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "#fff0f0", borderRadius: 8, fontSize: 12, color: "#c0392b" }}>
              📌 抜け：{missing.join("巻・")}巻
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setOwned(new Set(Array.from({ length: total }, (_, i) => i + 1)))} style={{ flex: 1, padding: "7px", background: "#5c2e1a", color: "#f5e6d3", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>全部チェック</button>
            <button onClick={() => setOwned(new Set())} style={{ flex: 1, padding: "7px", background: "#f5e6d3", color: "#5c2e1a", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>全部外す</button>
          </div>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px" }}>
          {total === 0 ? (
            <div style={{ textAlign: "center", color: "#9a7a6a", padding: "30px 0" }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>全巻数が未設定です</div>
              <div style={{ fontSize: 11 }}>作品編集で「最新／全巻数」を設定してください</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              {Array.from({ length: total }, (_, i) => i + 1).map(v => {
                const has = owned.has(v);
                return (
                  <button key={v} onClick={() => toggle(v)} style={{ aspectRatio: "1", borderRadius: 8, border: "2px solid", borderColor: has ? "#5c2e1a" : "#e8b4b4", background: has ? "#5c2e1a" : "#fff0f0", color: has ? "#f5e6d3" : "#c0392b", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {v}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ padding: "12px 20px 24px", borderTop: "1px solid #e8d5b7" }}>
          <button onClick={() => onSave(Array.from(owned).sort((a, b) => a - b))} style={{ width: "100%", padding: 14, background: "#c0392b", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>保存する</button>
        </div>
      </div>
    </div>
  );
}

// ---------- 書籍検索モーダル ----------
function SearchModal({ onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [covers, setCovers] = useState({});
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true); setSearched(false); setResults([]); setCovers({});
    try {
      const series = await searchMangaByTitle(query.trim());
      setResults(series); setSearched(true);
      series.forEach(async (s, i) => {
        if (s.cover_isbn) {
          const url = await fetchCoverFromOpenBD(s.cover_isbn);
          if (url) setCovers(prev => ({ ...prev, [i]: url }));
        }
      });
    } catch { setResults([]); setSearched(true); }
    setSearching(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,24,16,0.7)", zIndex: 500, display: "flex", alignItems: "flex-end", animation: "fadeIn 0.2s ease" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fdf6ec", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 430, margin: "0 auto", maxHeight: "85vh", display: "flex", flexDirection: "column", animation: "slideUp 0.3s ease" }}>
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #e8d5b7", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#9a7a6a", marginBottom: 6, letterSpacing: 1 }}>SEARCH MANGA</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input ref={inputRef} style={{ flex: 1, padding: "10px 14px", border: "2px solid #e8d5b7", borderRadius: 10, fontSize: 15, fontFamily: "inherit", background: "#fff", color: "#2c1810", outline: "none" }}
                placeholder="例：鬼滅の刃" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} />
              <button onClick={handleSearch} disabled={searching} style={{ padding: "10px 18px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontFamily: "inherit", cursor: "pointer", opacity: searching ? 0.6 : 1 }}>
                {searching ? "…" : "検索"}
              </button>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9a7a6a", paddingTop: 20 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {searching && <div style={{ padding: 20 }}><Spinner /></div>}
          {!searching && searched && results.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#9a7a6a" }}>
              <div style={{ fontSize: 36 }}>🔍</div>
              <div style={{ marginTop: 8 }}>見つかりませんでした</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>手動で入力することもできます</div>
            </div>
          )}
          {results.map((s, i) => (
            <button key={i} onClick={() => onSelect(s, covers[i] || null)}
              style={{ width: "100%", background: "none", border: "none", padding: "14px 20px", cursor: "pointer", textAlign: "left", display: "flex", gap: 14, alignItems: "center", borderBottom: "1px solid #f0e4d0" }}
              onMouseEnter={e => e.currentTarget.style.background = "#fef3e8"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}>
              <div style={{ width: 52, height: 72, borderRadius: 6, background: "#e8d5b7", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "2px 2px 8px rgba(44,24,16,0.15)" }}>
                {covers[i] ? <img src={covers[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22 }}>📚</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#2c1810", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                <div style={{ fontSize: 12, color: "#7a5a4a", marginBottom: 5 }}>{[s.author, s.publisher].filter(Boolean).join(" · ")}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {s.latest_volume > 0 && <span style={{ fontSize: 11, background: "#f5e6d3", color: "#c0392b", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{s.latest_volume}巻{s.status === "連載中" ? "〜" : ""}</span>}
                  {s.status && <span style={{ fontSize: 11, background: s.status === "完結" ? "#e8f5e9" : "#fff3e0", color: s.status === "完結" ? "#2e7d32" : "#e07b39", padding: "2px 8px", borderRadius: 10 }}>{s.status}</span>}
                </div>
              </div>
              <span style={{ color: "#c0392b", fontSize: 20, flexShrink: 0 }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Main ----------
export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("list");
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("title");
  const [editingId, setEditingId] = useState(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [volumeModalManga, setVolumeModalManga] = useState(null);
  const [bulkChecking, setBulkChecking] = useState(false);
  const [updatedIds, setUpdatedIds] = useState(new Set());

  const emptyForm = { title: "", total: "", location: "本棚A", memo: "", author: "", publisher: "", status: "", coverUrl: "" };
  const [form, setForm] = useState(emptyForm);
  const [wishForm, setWishForm] = useState({ title: "", volumes: "", memo: "" });

  const showToast = (msg) => setToast(msg);

  useEffect(() => {
    loadFromFirestore().then(d => { setData(d); setLoading(false); }).catch(() => { setData(initialData); setLoading(false); });
  }, []);

  const save = useCallback(async (newData) => {
    setSaving(true);
    try { await saveToFirestore(newData); }
    catch { showToast("保存エラー"); }
    setSaving(false);
  }, []);

  const updateData = useCallback((newData) => { setData(newData); save(newData); }, [save]);

  const handleSaveVolumes = (mangaId, ownedVolumes) => {
    const newManga = data.manga.map(m => m.id === mangaId ? { ...m, ownedVolumes, updatedAt: new Date().toISOString() } : m);
    updateData({ ...data, manga: newManga });
    setVolumeModalManga(null);
    showToast("保存しました！");
  };

  const handleBulkCheck = async () => {
    const serializing = data.manga.filter(m => m.status === "連載中");
    if (!serializing.length) { showToast("連載中の作品がありません"); return; }
    setBulkChecking(true);
    try {
      const results = await checkLatestVolumes(data.manga);
      const newIds = new Set();
      const newManga = data.manga.map(m => {
        const r = results[m.title];
        if (!r || r.latest_volume === 0) return m;
        if (r.latest_volume !== m.total || (r.status && r.status !== m.status)) {
          newIds.add(m.id);
          return { ...m, total: r.latest_volume, status: r.status || m.status, updatedAt: new Date().toISOString() };
        }
        return m;
      });
      updateData({ ...data, manga: newManga });
      setUpdatedIds(newIds);
      showToast(newIds.size > 0 ? `${newIds.size}作品を更新しました！` : "すべて最新です ✓");
      if (newIds.size > 0) setTimeout(() => setUpdatedIds(new Set()), 6000);
    } catch { showToast("更新に失敗しました"); }
    setBulkChecking(false);
  };

  const handleSelectFromSearch = (series, coverUrl) => {
    setForm(f => ({ ...f, title: series.title || "", author: series.author || "", publisher: series.publisher || "", total: series.latest_volume || "", status: series.status || "", coverUrl: coverUrl || "" }));
    setShowSearchModal(false);
    showToast(`「${series.title}」を選択しました`);
  };

  const handleAddManga = () => {
    if (!form.title.trim()) { showToast("タイトルを入力してください"); return; }
    const manga = {
      id: editingId || generateId(),
      title: form.title.trim(),
      ownedVolumes: editingId ? (data.manga.find(m => m.id === editingId)?.ownedVolumes || []) : [],
      total: parseInt(form.total) || 0,
      location: form.location, memo: form.memo.trim(),
      author: form.author.trim(), publisher: form.publisher.trim(),
      status: form.status, coverUrl: form.coverUrl,
      updatedAt: new Date().toISOString(),
    };
    const newManga = editingId ? data.manga.map(m => m.id === editingId ? manga : m) : [...data.manga, manga];
    updateData({ ...data, manga: newManga });
    showToast(editingId ? "更新しました！" : "追加しました！");
    setForm(emptyForm); setEditingId(null); setTab("list");
  };

  const handleEdit = (m) => {
    setForm({ title: m.title, total: m.total, location: m.location, memo: m.memo || "", author: m.author || "", publisher: m.publisher || "", status: m.status || "", coverUrl: m.coverUrl || "" });
    setEditingId(m.id); setTab("add");
  };

  const handleDelete = (id) => { updateData({ ...data, manga: data.manga.filter(m => m.id !== id) }); showToast("削除しました"); };

  const filteredManga = data ? data.manga
    .filter(m => m.title.toLowerCase().includes(search.toLowerCase()) || (m.author || "").includes(search) || (m.location || "").includes(search))
    .sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title, "ja");
      if (sortBy === "volumes") return countOwned(b) - countOwned(a);
      if (sortBy === "location") return (a.location || "").localeCompare(b.location || "", "ja");
      return 0;
    }) : [];

  const S = {
    app: { fontFamily: "'Noto Serif JP', 'Hiragino Mincho ProN', serif", background: "#fdf6ec", minHeight: "100vh", maxWidth: 430, margin: "0 auto", color: "#2c1810", paddingBottom: 80 },
    header: { background: "linear-gradient(135deg, #2c1810 0%, #5c2e1a 100%)", color: "#f5e6d3", padding: "20px 20px 16px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(44,24,16,0.3)" },
    input: { width: "100%", padding: "12px 14px", border: "2px solid #e8d5b7", borderRadius: 10, fontSize: 15, fontFamily: "inherit", background: "#fffdf8", color: "#2c1810", boxSizing: "border-box", outline: "none" },
    label: { fontSize: 12, color: "#7a5a4a", marginBottom: 6, display: "block", letterSpacing: 0.5 },
    card: { background: "#fff", borderRadius: 12, margin: "10px 16px", padding: "14px 16px", boxShadow: "0 2px 8px rgba(44,24,16,0.08)", borderLeft: "4px solid #c0392b" },
    nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#2c1810", display: "flex", borderTop: "1px solid rgba(255,255,255,0.1)", zIndex: 200 },
    navBtn: (active) => ({ flex: 1, padding: "10px 4px", textAlign: "center", background: active ? "#5c2e1a" : "transparent", color: active ? "#f5e6d3" : "#9a7a6a", border: "none", cursor: "pointer", fontSize: 10, fontFamily: "inherit", borderTop: active ? "2px solid #e07b39" : "2px solid transparent" }),
  };

  if (loading) return <div style={S.app}><div style={S.header}><div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3 }}>📚 マンガ本棚</div></div><Spinner /></div>;

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity:0; transform: translateX(-50%) translateY(10px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        input:focus, select:focus { border-color: #c0392b !important; outline: none; }
        button:active { opacity: 0.8; transform: scale(0.97); }
        .manga-card { animation: fadeIn 0.3s ease; }
        .card-actions { opacity: 0; transition: opacity 0.2s; }
        .manga-card:hover .card-actions { opacity: 1; }
        @media (hover: none) { .card-actions { opacity: 1 !important; } }
      `}</style>

      <div style={S.header}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, display: "flex", alignItems: "center", gap: 8 }}>
          📚 マンガ本棚
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: saving ? "#f39c12" : "#27ae60", display: "inline-block", transition: "background 0.3s" }} />
        </div>
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, letterSpacing: 1 }}>
          {data.manga.length}作品 · {data.manga.reduce((s, m) => s + countOwned(m), 0)}冊所持{saving && " · 同期中..."}
        </div>
      </div>

      {tab === "list" && (
        <div>
          <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
            <input style={{ ...S.input, flex: 1, padding: "10px 14px" }} placeholder="🔍 タイトル・著者・場所で検索..." value={search} onChange={e => setSearch(e.target.value)} />
            <select style={{ ...S.input, width: 110, padding: "10px 8px" }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="title">あいうえお</option>
              <option value="volumes">冊数順</option>
              <option value="location">場所順</option>
            </select>
          </div>
          {data.manga.some(m => m.status === "連載中") && (
            <div style={{ padding: "0 16px 8px" }}>
              <button onClick={handleBulkCheck} disabled={bulkChecking} style={{ width: "100%", padding: "10px 16px", background: bulkChecking ? "#e8d5b7" : "#fff8f0", border: "2px solid #e8d5b7", borderRadius: 10, fontSize: 13, fontFamily: "inherit", cursor: bulkChecking ? "not-allowed" : "pointer", color: bulkChecking ? "#9a7a6a" : "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {bulkChecking ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #e8d5b7", borderTopColor: "#c0392b", animation: "spin 0.8s linear infinite" }} />チェック中...</> : <>🔄 連載中の最新巻をまとめて更新（{data.manga.filter(m => m.status === "連載中").length}作品）</>}
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, padding: "0 16px 12px", flexWrap: "wrap" }}>
            {LOCATIONS.map(loc => {
              const cnt = data.manga.filter(m => m.location === loc).length;
              if (!cnt) return null;
              return <div key={loc} onClick={() => setSearch(search === loc ? "" : loc)} style={{ background: search === loc ? "#c0392b" : "#fff", color: search === loc ? "#fff" : "#7a5a4a", borderRadius: 8, padding: "5px 10px", fontSize: 11, boxShadow: "0 1px 4px rgba(44,24,16,0.1)", cursor: "pointer" }}>{loc} <strong>{cnt}</strong></div>;
            })}
          </div>
          {filteredManga.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#9a7a6a" }}>
              <div style={{ fontSize: 48 }}>📖</div>
              <div style={{ marginTop: 12, fontSize: 15 }}>{search ? "見つかりませんでした" : "まだ作品がありません"}</div>
              {!search && <button style={{ marginTop: 16, padding: "12px 24px", background: "#c0392b", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }} onClick={() => setTab("add")}>＋ 最初の作品を追加</button>}
            </div>
          ) : filteredManga.map(m => {
            const owned = countOwned(m);
            const missing = getMissingVolumes(m);
            const pct = m.total > 0 ? Math.min(100, Math.round(owned / m.total * 100)) : 0;
            const isUpdated = updatedIds.has(m.id);
            return (
              <div key={m.id} style={{ ...S.card, borderLeftColor: isUpdated ? "#27ae60" : (missing.length > 0 ? "#e07b39" : "#c0392b"), background: isUpdated ? "#f0fff4" : "#fff", transition: "all 0.5s", cursor: "pointer" }}
                className="manga-card" onClick={() => setVolumeModalManga(m)}>
                {isUpdated && <div style={{ fontSize: 11, color: "#27ae60", fontWeight: 700, marginBottom: 6 }}>✨ 最新情報に更新されました</div>}
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 48, height: 66, borderRadius: 6, flexShrink: 0, background: "#e8d5b7", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "2px 2px 6px rgba(44,24,16,0.15)" }}>
                    {m.coverUrl ? <img src={m.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>📚</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{m.title}</div>
                      <div className="card-actions" style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 6 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleEdit(m)} style={{ background: "#f5e6d3", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>編集</button>
                        <button onClick={() => handleDelete(m.id)} style={{ background: "#fee", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: "#c0392b" }}>削除</button>
                      </div>
                    </div>
                    {m.author && <div style={{ fontSize: 11, color: "#9a7a6a", marginBottom: 3 }}>{m.author}</div>}
                    <div style={{ fontSize: 12, color: "#7a5a4a", display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>📦 {m.location}</span>
                      <span>
                        <strong style={{ color: "#c0392b" }}>{owned}</strong>
                        {m.total > 0 && <> / {m.total}巻</>}
                        {m.status === "連載中" && <span style={{ color: "#e07b39", marginLeft: 3, fontSize: 10 }}>連載中</span>}
                        {m.total > 0 && owned >= m.total && m.status !== "連載中" && <span style={{ color: "#27ae60", marginLeft: 3 }}>✓完集</span>}
                      </span>
                      {missing.length > 0 && <span style={{ color: "#c0392b" }}>抜け {missing.length}冊</span>}
                    </div>
                    {missing.length > 0 && missing.length <= 8 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                        {missing.map(v => <span key={v} style={{ fontSize: 10, background: "#fff0f0", color: "#c0392b", border: "1px solid #e8b4b4", borderRadius: 4, padding: "1px 5px" }}>{v}巻</span>)}
                      </div>
                    )}
                    {missing.length > 8 && <div style={{ fontSize: 10, color: "#c0392b", marginTop: 4 }}>📌 {missing.slice(0, 5).join("・")}巻 など{missing.length}冊抜け</div>}
                    {m.total > 0 && (
                      <div style={{ height: 5, borderRadius: 3, background: "#e8d5b7", marginTop: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: pct + "%", background: pct >= 100 ? "#27ae60" : pct > 50 ? "#e07b39" : "#c0392b", borderRadius: 3, transition: "width 0.5s" }} />
                      </div>
                    )}
                    {m.memo && <div style={{ fontSize: 11, color: "#9a7a6a", marginTop: 4 }}>📝 {m.memo}</div>}
                    <div style={{ fontSize: 10, color: "#b0907a", marginTop: 5 }}>タップして巻ごとに管理 ›</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "add" && (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "#9a7a6a", marginBottom: 16 }}>{editingId ? "✏️ 作品を編集" : "➕ 作品を追加"}</div>
          {!editingId && (
            <button onClick={() => setShowSearchModal(true)} style={{ width: "100%", padding: 14, marginBottom: 20, background: "linear-gradient(135deg, #2c1810, #5c2e1a)", color: "#f5e6d3", border: "none", borderRadius: 12, fontSize: 15, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(44,24,16,0.25)" }}>
              🔍 タイトルで自動検索（表紙・巻数を自動取得）
            </button>
          )}
          {form.coverUrl && (
            <div style={{ display: "flex", gap: 14, marginBottom: 20, padding: 14, background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(44,24,16,0.08)" }}>
              <img src={form.coverUrl} alt="" style={{ width: 56, height: 78, objectFit: "cover", borderRadius: 6 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{form.title}</div>
                {form.author && <div style={{ fontSize: 12, color: "#7a5a4a" }}>{form.author}</div>}
                {form.status && <span style={{ fontSize: 11, marginTop: 6, display: "inline-block", background: form.status === "完結" ? "#e8f5e9" : "#fff3e0", color: form.status === "完結" ? "#2e7d32" : "#e07b39", padding: "2px 8px", borderRadius: 10 }}>{form.status}</span>}
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label style={S.label}>タイトル *</label><input style={S.input} placeholder="例：ワンピース" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div>
              <label style={S.label}>最新／全巻数</label>
              <input style={S.input} type="number" placeholder="0" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} />
              <div style={{ fontSize: 11, color: "#9a7a6a", marginTop: 4 }}>※ 所持済みの巻は追加後にカードをタップして設定できます</div>
            </div>
            <div><label style={S.label}>保管場所</label><select style={S.input} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}>{LOCATIONS.map(l => <option key={l}>{l}</option>)}</select></div>
            <div><label style={S.label}>メモ（任意）</label><input style={S.input} placeholder="例：3巻が見当たらない" value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} /></div>
            <button style={{ width: "100%", padding: 14, background: "#c0392b", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }} onClick={handleAddManga}>{editingId ? "更新する" : "追加する"}</button>
            {editingId && <button style={{ padding: "12px 20px", background: "transparent", color: "#c0392b", border: "none", borderRadius: 10, fontSize: 15, fontFamily: "inherit", cursor: "pointer" }} onClick={() => { setEditingId(null); setForm(emptyForm); setTab("list"); }}>キャンセル</button>}
          </div>
        </div>
      )}

      {tab === "wish" && (
        <div>
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ fontSize: 13, letterSpacing: 2, color: "#9a7a6a", marginBottom: 14 }}>🛒 欲しいリスト</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <input style={S.input} placeholder="タイトル *" value={wishForm.title} onChange={e => setWishForm({ ...wishForm, title: e.target.value })} />
              <input style={S.input} placeholder="欲しい巻（例：3巻、5〜8巻）" value={wishForm.volumes} onChange={e => setWishForm({ ...wishForm, volumes: e.target.value })} />
              <input style={S.input} placeholder="メモ（任意）" value={wishForm.memo} onChange={e => setWishForm({ ...wishForm, memo: e.target.value })} />
              <button style={{ padding: 12, background: "#c0392b", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}
                onClick={() => { if (!wishForm.title.trim()) { showToast("タイトルを入力してください"); return; } updateData({ ...data, wishlist: [...data.wishlist, { id: generateId(), ...wishForm }] }); setWishForm({ title: "", volumes: "", memo: "" }); showToast("追加しました！"); }}>追加する</button>
            </div>
          </div>
          {data.wishlist.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#9a7a6a" }}><div style={{ fontSize: 40 }}>🛒</div><div style={{ marginTop: 8 }}>欲しい本を追加しましょう</div></div>
          ) : data.wishlist.map(w => (
            <div key={w.id} style={{ ...S.card, borderLeftColor: "#e07b39" }} className="manga-card">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{w.title}</div>
                  {w.volumes && <div style={{ fontSize: 12, color: "#7a5a4a" }}>📖 {w.volumes}</div>}
                  {w.memo && <div style={{ fontSize: 12, color: "#9a7a6a", marginTop: 2 }}>{w.memo}</div>}
                </div>
                <button onClick={() => { updateData({ ...data, wishlist: data.wishlist.filter(x => x.id !== w.id) }); showToast("削除しました"); }} style={{ background: "#fee", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: "#c0392b", alignSelf: "flex-start" }}>削除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <nav style={S.nav}>
        {[{ id: "list", icon: "📚", label: "本棚", badge: data.manga.length }, { id: "add", icon: "➕", label: "追加" }, { id: "wish", icon: "🛒", label: "ほしい物", badge: data.wishlist.length }].map(n => (
          <button key={n.id} style={S.navBtn(tab === n.id)} onClick={() => { if (n.id !== "add") { setEditingId(null); setForm(emptyForm); } setTab(n.id); }}>
            <span style={{ fontSize: 20, display: "block" }}>{n.icon}</span>
            {n.label}
            {n.badge > 0 && <span style={{ marginLeft: 3, background: "#c0392b", color: "#fff", borderRadius: 8, fontSize: 10, padding: "1px 5px" }}>{n.badge}</span>}
          </button>
        ))}
      </nav>

      {showSearchModal && <SearchModal onSelect={handleSelectFromSearch} onClose={() => setShowSearchModal(false)} />}
      {volumeModalManga && <VolumeModal manga={volumeModalManga} onSave={(vols) => handleSaveVolumes(volumeModalManga.id, vols)} onClose={() => setVolumeModalManga(null)} />}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
