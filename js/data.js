// 讀取電台資料：先讀 Google 試算表，失敗時改用內建 CSV
import { CONFIG } from "./config.js";

// 試算表欄位（中文標題）→ 程式內部欄位名稱
const HEADER_MAP = {
  "編號": "id", "台名": "name", "聯播網": "network", "波段": "band",
  "頻率": "freq", "地區": "region", "縣市": "county", "緯度": "lat",
  "經度": "lng", "類型": "genre", "串流網址": "stream", "官網": "website",
  "Facebook": "facebook", "Instagram": "instagram", "Threads": "threads",
  "YouTube": "youtube", "預設台": "preset", "已核對": "verified", "備註": "note",
};

export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ""));
}

function toStations(rows) {
  const headers = rows[0].map(h => HEADER_MAP[h.trim()] || h.trim());
  return rows.slice(1).map((r, idx) => {
    const s = {};
    headers.forEach((h, i) => { s[h] = (r[i] || "").trim(); });
    s.id = s.id || String(idx + 1);
    s.band = (s.band || "FM").toUpperCase();
    s.freq = parseFloat(s.freq);
    if (s.band === "NET" && isNaN(s.freq)) s.freq = 0;   // 網路台（沒有無線頻率）
    if (s.region === "日本" && isNaN(s.freq)) s.freq = 0; // 日本社區台：頻率待補
    s.geoLocked = s.region === "日本" && !s.stream;       // 只限日本境內收聽
    s.lat = parseFloat(s.lat);
    s.lng = parseFloat(s.lng);
    s.preset = s.preset ? parseInt(s.preset, 10) : null;
    s.verified = /^(y|yes|是|v|✓)$/i.test(s.verified);
    return s;
  }).filter(s => s.name && !isNaN(s.freq));
}

export async function loadStations() {
  const sources = [];
  if (CONFIG.SHEET_CSV_URL) sources.push({ url: CONFIG.SHEET_CSV_URL, label: "Google 試算表" });
  sources.push({ url: CONFIG.FALLBACK_CSV, label: "內建資料" });
  for (const src of sources) {
    try {
      const res = await fetch(src.url, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const stations = toStations(parseCSV(await res.text()));
      if (stations.length) return { stations, source: src.label };
    } catch (e) {
      console.warn("讀取失敗：", src.label, e);
    }
  }
  return { stations: [], source: "無" };
}

// 清單、標籤用的簡短頻率文字
export function freqLabel(s) {
  return s.band === "NET" ? "網路收聽" : `${s.band} ${formatFreq(s)}`;
}

export function formatFreq(s) {
  if (s.band === "NET") return "網路 收聽";
  if (!s.freq) return s.band === "AM" ? "— kHz" : "— MHz";
  if (s.band === "SW") return `${Math.round(s.freq)} kHz`;
  return s.band === "AM" ? `${Math.round(s.freq)} kHz` : `${s.freq.toFixed(1)} MHz`;
}
