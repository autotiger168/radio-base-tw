// =============================================================
//  短波排程轉換：EiBi 公開排程 CSV → 網站用 JSON（含台灣可收的靜態評分）
//  由 GitHub Actions 每週執行，也可在本機執行：
//    node scripts/build-sw.mjs                 # 自動下載本季、上季、下季
//    node scripts/build-sw.mjs path/to/sked-b26.csv   # 用本機檔案
//  資料來源：EiBi (http://www.eibispace.de/) — 免費提供，請保留出處
// =============================================================
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "data/sw";
const TW = { lat: 23.7, lon: 121.0 };

// 主要短波發射站所在地（以 ITU 國碼對應該國主要短波發射站）
const TX_SITES = {
  TWN: [23.70, 120.30, "台灣"], CHN: [32.0, 112.0, "中國"], J: [36.17, 139.83, "日本"],
  KOR: [35.80, 126.80, "南韓"], KRE: [40.00, 125.50, "北韓"], PHL: [15.36, 120.60, "菲律賓"],
  GUM: [13.40, 144.70, "關島"], PLW: [7.50, 134.60, "帛琉"], MRA: [15.20, 145.70, "塞班"],
  MNG: [47.90, 106.90, "蒙古"], VTN: [21.00, 105.80, "越南"], THA: [17.40, 102.80, "泰國"],
  SNG: [1.35, 103.80, "新加坡"], MLA: [3.00, 101.70, "馬來西亞"], INS: [-6.20, 106.80, "印尼"],
  CLN: [8.70, 81.10, "斯里蘭卡"], IND: [28.60, 77.20, "印度"], BGD: [23.80, 90.40, "孟加拉"],
  NPL: [27.70, 85.30, "尼泊爾"], BTN: [27.50, 89.60, "不丹"], MYA: [19.75, 96.10, "緬甸"],
  PAK: [33.70, 73.00, "巴基斯坦"], AFG: [34.50, 69.20, "阿富汗"], UZB: [41.20, 69.15, "烏茲別克"],
  TJK: [38.50, 68.80, "塔吉克"], KAZ: [43.20, 76.90, "哈薩克"], KGZ: [42.90, 74.60, "吉爾吉斯"],
  RUS: [55.70, 37.60, "俄羅斯"], ARS: [24.70, 46.70, "沙烏地"], UAE: [24.17, 54.25, "阿聯"],
  OMA: [21.93, 59.63, "阿曼"], KWT: [29.30, 47.90, "科威特"], IRN: [35.70, 51.40, "伊朗"],
  TUR: [39.50, 32.80, "土耳其"], G: [52.27, -2.80, "英國"], D: [52.60, 12.90, "德國"],
  F: [46.90, 1.90, "法國"], I: [41.90, 12.30, "義大利"], CVA: [42.03, 12.32, "梵蒂岡"],
  AUT: [48.00, 16.50, "奧地利"], ROU: [44.75, 26.10, "羅馬尼亞"], BUL: [42.80, 23.20, "保加利亞"],
  CZE: [49.80, 15.50, "捷克"], SVK: [48.70, 19.10, "斯洛伐克"], E: [39.90, -3.40, "西班牙"],
  HOL: [52.10, 5.30, "荷蘭"], POR: [38.70, -9.10, "葡萄牙"], ASC: [-7.90, -14.40, "亞森欣島"],
  MDG: [-18.75, 47.60, "馬達加斯加"], AFS: [-26.60, 28.00, "南非"], NIG: [9.10, 7.40, "奈及利亞"],
  EGY: [30.00, 31.20, "埃及"], ETH: [9.00, 38.70, "衣索比亞"], USA: [35.00, -80.00, "美國"],
  ALS: [59.75, -151.70, "阿拉斯加"], HWA: [21.30, -157.80, "夏威夷"], CAN: [45.40, -75.70, "加拿大"],
  CUB: [22.95, -82.55, "古巴"], B: [-15.80, -47.90, "巴西"], ARG: [-34.60, -58.40, "阿根廷"],
  AUS: [-36.33, 145.42, "澳洲"], NZL: [-38.84, 176.42, "紐西蘭"], VUT: [-17.70, 168.30, "萬那杜"],
  PNG: [-9.40, 147.20, "巴布亞紐幾內亞"], SLM: [-9.40, 160.00, "索羅門"], ALB: [41.30, 19.80, "阿爾巴尼亞"],
  FIN: [60.20, 24.90, "芬蘭"], S: [59.30, 18.10, "瑞典"], NOR: [59.90, 10.70, "挪威"],
  DNK: [55.70, 12.60, "丹麥"], IRL: [53.30, -6.30, "愛爾蘭"], GRC: [37.98, 23.70, "希臘"],
  ISR: [32.10, 34.80, "以色列"], SYR: [33.50, 36.30, "敘利亞"], ARM: [40.20, 44.50, "亞美尼亞"],
  MDA: [47.00, 28.80, "摩爾多瓦"], UKR: [50.40, 30.50, "烏克蘭"], BLR: [53.90, 27.60, "白俄羅斯"],
  LTU: [54.70, 25.30, "立陶宛"], GEO: [41.70, 44.80, "喬治亞"], MLI: [12.60, -8.00, "馬利"],
  SEN: [14.70, -17.40, "塞內加爾"], GAB: [-0.40, 9.40, "加彭"], ZMB: [-15.40, 28.30, "尚比亞"],
  KEN: [-1.30, 36.80, "肯亞"], SDN: [15.60, 32.50, "蘇丹"], SSD: [4.90, 31.60, "南蘇丹"],
  MEX: [19.40, -99.10, "墨西哥"], CLM: [4.60, -74.10, "哥倫比亞"], PRU: [-12.00, -77.00, "秘魯"],
  BOL: [-16.50, -68.10, "玻利維亞"], EQA: [-0.20, -78.50, "厄瓜多"], CHL: [-33.40, -70.70, "智利"],
  GUF: [5.20, -52.80, "法屬圭亞那"], ATN: [12.10, -68.90, "荷屬安地列斯"], HKG: [22.30, 114.20, "香港"],
};

// 目標區對台灣的相關程度（EiBi 目標區代碼）
const TARGET_RELEVANCE = {
  TWN: 1, CHN: 1, HKG: 1, MAC: 1, Chi: 1, FE: 0.9, EAs: 0.9, "E As": 0.9, J: 0.8, KOR: 0.75, KRE: 0.75,
  PHL: 0.7, SEA: 0.7, As: 0.7, Pac: 0.55, Oc: 0.45, VTN: 0.6, MNG: 0.6, SAs: 0.4, CAs: 0.35,
  RUS: 0.3, Sib: 0.4, INS: 0.5, MLA: 0.5, THA: 0.5, MYA: 0.45, AUS: 0.35, NZL: 0.3,
};

function haversine(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const DAY_ABBR = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 };
// 星期轉成 7 位元遮罩（bit0 = 週一）；空白 = 每天
function parseDays(s) {
  s = (s || "").trim();
  if (!s) return 127;
  if (/^[1-7]+$/.test(s)) return [...s].reduce((m, d) => m | (1 << (d - 1)), 0);
  const low = s.toLowerCase();
  const range = low.match(/^(mo|tu|we|th|fr|sa|su)-(mo|tu|we|th|fr|sa|su)$/);
  if (range) {
    let m = 0, a = DAY_ABBR[range[1]], b = DAY_ABBR[range[2]];
    for (let i = 0; i < 7; i++) { const d = ((a - 1 + i) % 7) + 1; m |= 1 << (d - 1); if (d === b) break; }
    return m;
  }
  const parts = low.match(/mo|tu|we|th|fr|sa|su/g);
  if (parts) return parts.reduce((m, p) => m | (1 << (DAY_ABBR[p] - 1)), 0);
  return 127; // 不規則（如特定日期）→ 視為每天，並在備註保留原文
}

function relevance(target) {
  if (!target) return 0.5;
  let best = 0.15;
  for (const t of target.split(/[,\s/]+/)) {
    if (TARGET_RELEVANCE[t] !== undefined) best = Math.max(best, TARGET_RELEVANCE[t]);
  }
  return best;
}

export function parseEiBi(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim() || /^khz/i.test(line)) continue;
    const c = line.split(";");
    if (c.length < 7) { skipped++; continue; }
    const khz = parseFloat(c[0]);
    const tm = (c[1] || "").match(/^(\d{4})-(\d{4})$/);
    if (!khz || !tm || khz < 2300 || khz > 26100) { skipped++; continue; }
    const remarks = (c[7] || "").trim();
    const itu = (c[3] || "").trim();
    // 備註欄「/XXX」= 在 XXX 國的發射站；沒有就是電台本國
    const via = remarks.match(/\/([A-Z]{1,3})(?:-[A-Za-z]+)?/);
    const tx = via ? via[1] : itu;
    rows.push({
      khz, start: +tm[1], end: +tm[2], days: parseDays(c[2]), daysRaw: (c[2] || "").trim(),
      itu, station: (c[4] || "").trim(), lang: (c[5] || "").trim(), target: (c[6] || "").trim(),
      remarks, tx,
    });
  }
  return { rows, skipped };
}

export function toSeasonJSON(season, parsed, sourceUrl) {
  const stations = [], sIndex = new Map();
  const unknownTx = new Set();
  const out = [];
  for (const r of parsed.rows) {
    if (!sIndex.has(r.station)) { sIndex.set(r.station, stations.length); stations.push(r.station); }
    const site = TX_SITES[r.tx];
    if (!site) unknownTx.add(r.tx);
    const dist = site ? haversine({ lat: site[0], lon: site[1] }, TW) : -1;
    // [kHz, 開始UTC, 結束UTC, 星期遮罩, 電台索引, 語言, 目標區, 發射國碼, 距離km, 相關度x100, 備註]
    out.push([r.khz, r.start, r.end, r.days, sIndex.get(r.station), r.lang, r.target, r.tx, dist,
      Math.round(relevance(r.target) * 100), r.remarks + (r.days === 127 && r.daysRaw && !/^[1-7]+$/.test(r.daysRaw) ? ` [${r.daysRaw}]` : "")]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const sites = {};
  for (const [k, v] of Object.entries(TX_SITES)) sites[k] = v;
  return {
    season: season.toUpperCase(), generated: new Date().toISOString(), source: sourceUrl,
    attribution: "Schedule data: EiBi (www.eibispace.de)",
    count: out.length, stations, sites, rows: out,
    _stats: { skipped: parsed.skipped, unknownTx: [...unknownTx].sort() },
  };
}

// ---------- 季節計算 ----------
function lastSunday(year, month) { // month: 0-based
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
export function seasonOf(date) {
  const y = date.getUTCFullYear();
  const aStart = lastSunday(y, 2), bStart = lastSunday(y, 9);
  if (date >= aStart && date < bStart) return { code: `a${String(y).slice(2)}`, start: aStart, end: bStart };
  if (date >= bStart) return { code: `b${String(y).slice(2)}`, start: bStart, end: lastSunday(y + 1, 2) };
  return { code: `b${String(y - 1).slice(2)}`, start: lastSunday(y - 1, 9), end: aStart };
}
function neighbors(code) {
  const t = code[0], y = +code.slice(1);
  const prev = t === "a" ? `b${String(y - 1).padStart(2, "0")}` : `a${String(y).padStart(2, "0")}`;
  const next = t === "a" ? `b${String(y).padStart(2, "0")}` : `a${String(y + 1).padStart(2, "0")}`;
  return [prev, code, next];
}

async function download(code) {
  const urls = [`https://www.eibispace.de/dx/sked-${code}.csv`, `http://www.eibispace.de/dx/sked-${code}.csv`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "RadioBaseTW-schedule-updater (weekly)" } });
      if (!res.ok) { console.log(`  ${url} → HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      return { text: buf.toString("latin1"), url };
    } catch (e) { console.log(`  ${url} → ${e.message}`); }
  }
  return null;
}

function writeSeason(code, json) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stats = json._stats; delete json._stats;
  fs.writeFileSync(path.join(OUT_DIR, `${code}.json`), JSON.stringify(json));
  console.log(`✔ ${code.toUpperCase()}: ${json.count} 筆, ${json.stations.length} 個電台, 略過 ${stats.skipped} 行`);
  if (stats.unknownTx.length) console.log(`  未知發射國碼（地圖不顯示、距離不計分）: ${stats.unknownTx.join(" ")}`);
}

function updateIndex() {
  const files = fs.readdirSync(OUT_DIR).filter(f => /^[ab]\d\d\.json$/.test(f));
  const seasons = files.map(f => {
    const j = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
    return { code: f.slice(0, 3), season: j.season, count: j.count, generated: j.generated };
  }).sort((a, b) => (+a.code.slice(1) - +b.code.slice(1)) || a.code.localeCompare(b.code));
  const cur = seasonOf(new Date());
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify({
    current: cur.code, currentStart: cur.start.toISOString().slice(0, 10), currentEnd: cur.end.toISOString().slice(0, 10),
    updated: new Date().toISOString(), seasons,
  }, null, 2));
  console.log(`✔ index.json：本季 ${cur.code.toUpperCase()}，共 ${seasons.length} 季資料`);
}

// ---------- 主程式 ----------
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-sw.mjs");
if (isMain) {
  const local = process.argv[2];
  if (local) {
    const code = (path.basename(local).match(/([ab]\d\d)/i) || [, "x00"])[1].toLowerCase();
    const parsed = parseEiBi(fs.readFileSync(local).toString("latin1"));
    writeSeason(code, toSeasonJSON(code, parsed, path.basename(local)));
    updateIndex();
  } else {
    const cur = seasonOf(new Date());
    let ok = 0;
    for (const code of neighbors(cur.code)) {
      console.log(`下載 ${code.toUpperCase()} …`);
      const got = await download(code);
      if (!got) { console.log(`  （${code.toUpperCase()} 尚未發布或無法下載，保留舊資料）`); continue; }
      const parsed = parseEiBi(got.text);
      if (parsed.rows.length < 100) { console.log(`  ⚠ 只解析出 ${parsed.rows.length} 筆，格式可能改變，略過`); continue; }
      writeSeason(code, toSeasonJSON(code, parsed, got.url));
      ok++;
    }
    if (fs.existsSync(OUT_DIR)) updateIndex();
    if (!ok) { console.error("沒有成功更新任何一季"); process.exitCode = 1; }
  }
}
