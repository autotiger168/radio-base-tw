// =============================================================
//  短波「台灣可收指數」：依時段、頻段、距離、目標區估算 0–5 星
//  這是經驗法則的估計，不是精確的電離層預報。實際收聽還受太陽活動、
//  天線、所在地雜訊影響——歡迎用收聽日誌回頭校正。
// =============================================================
export const TW = { lat: 23.7, lon: 121.0 };

export const SW_BANDS = [
  { name: "120m", lo: 2300, hi: 2500 }, { name: "90m", lo: 3200, hi: 3400 },
  { name: "75m", lo: 3900, hi: 4050 }, { name: "60m", lo: 4700, hi: 5100 },
  { name: "49m", lo: 5800, hi: 6300 }, { name: "41m", lo: 7200, hi: 7600 },
  { name: "31m", lo: 9300, hi: 9995 }, { name: "25m", lo: 11500, hi: 12200 },
  { name: "22m", lo: 13500, hi: 13900 }, { name: "19m", lo: 15000, hi: 15900 },
  { name: "16m", lo: 17400, hi: 17995 }, { name: "15m", lo: 18800, hi: 19100 },
  { name: "13m", lo: 21450, hi: 21995 }, { name: "11m", lo: 25500, hi: 26200 },
];
export function bandOf(khz) {
  const b = SW_BANDS.find(b => khz >= b.lo && khz <= b.hi);
  return b ? b.name : "其他";
}

// 時間 HHMM → 分鐘
const mins = t => Math.floor(t / 100) * 60 + (t % 100);

// 某一筆在指定 UTC 時刻是否播出中（weekday: 1=週一…7=週日，UTC）
export function onAir(row, utcMinutes, weekday) {
  const [, start, end, days] = row;
  let s = mins(start), e = mins(end === 0 ? 2400 : end);
  if (e === s) e = s + 1440;
  let inTime, dayToCheck = weekday;
  if (e > s) inTime = utcMinutes >= s && utcMinutes < e;
  else { // 跨午夜
    inTime = utcMinutes >= s || utcMinutes < e;
    if (utcMinutes < e) dayToCheck = weekday === 1 ? 7 : weekday - 1; // 屬於前一天開始的節目
  }
  return inTime && !!(days & (1 << (dayToCheck - 1)));
}

// 某一筆在指定小時（UTC）是否有播出（以整點到下一整點任一分鐘有播即算）
export function airsInHour(row, utcHour, weekday) {
  for (let m = 0; m < 60; m += 15) if (onAir(row, utcHour * 60 + m, weekday)) return true;
  return false;
}

function solarElevation(lat, lon, date) {
  const rad = Math.PI / 180;
  const doy = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const decl = -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365) * rad;
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60;
  const ha = ((utcH + lon / 15 - 12) * 15) * rad;
  const el = Math.asin(Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha));
  return el / rad;
}

function midpoint(a, b) {
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360; if (dLon < -180) dLon += 360;
  return { lat: (a.lat + b.lat) / 2, lon: a.lon + dLon / 2 };
}

// 傳播分數 0–1：白天適合較高頻、夜間適合較低頻；距離越遠需要越高的頻率
function propagation(khz, distKm, dayness) {
  const f = khz / 1000;
  const near = distKm >= 0 && distKm < 1500, far = distKm > 6000;
  const day = near ? [4.5, 12] : far ? [13, 22] : [9, 18];
  const night = near ? [3.2, 7.6] : far ? [5.8, 12.2] : [5.8, 10.1];
  const lo = night[0] + (day[0] - night[0]) * dayness;
  const hi = night[1] + (day[1] - night[1]) * dayness;
  if (f >= lo && f <= hi) return 1;
  const octaves = f < lo ? Math.log2(lo / f) : Math.log2(f / hi);
  return Math.max(0, 1 - octaves * 1.4);
}

function distanceFactor(d) {
  if (d < 0) return 0.6;
  if (d < 3000) return 1;
  if (d < 8000) return 0.8;
  if (d < 12000) return 0.55;
  return 0.4;
}

// 回傳 0–5（可有小數）
export function score(row, sites, date) {
  const [khz, , , , , , , tx, dist, rel] = row;
  const site = sites[tx];
  const a = site ? { lat: site[0], lon: site[1] } : TW;
  const mid = midpoint(a, TW);
  const el = solarElevation(mid.lat, mid.lon, date);
  const dayness = Math.max(0, Math.min(1, (el + 6) / 18)); // 曙暮光漸變
  const p = propagation(khz, dist, dayness);
  const r = rel / 100;
  return 5 * Math.pow(p, 0.8) * Math.pow(r, 0.6) * distanceFactor(dist);
}

export function stars(v) {
  const n = Math.round(v);
  return "★".repeat(n) + "☆".repeat(5 - n);
}

// EiBi 語言代碼 → 中文（常用者）
// 只列較確定的代碼，其他直接顯示原代碼
export const LANG = {
  E: "英語", M: "華語", C: "中文", J: "日語", K: "韓語", Can: "粵語", Hak: "客語", Amoy: "閩南語",
  R: "俄語", F: "法語", D: "德語", S: "西語", A: "阿拉伯語", P: "葡語", I: "義大利語",
  T: "泰語", VN: "越南語", Tib: "藏語", Uig: "維吾爾語",
  "-TS": "報時訊號", "-CW": "摩斯電碼", "-MX": "音樂",
};
export const langName = c => LANG[c] || c || "—";

export const TARGET = {
  TWN: "台灣", CHN: "中國", HKG: "香港", FE: "遠東", EAs: "東亞", J: "日本", KOR: "南韓", KRE: "北韓",
  SEA: "東南亞", As: "亞洲", SAs: "南亞", CAs: "中亞", Pac: "太平洋", Oc: "大洋洲", Af: "非洲",
  Eu: "歐洲", ME: "中東", NAm: "北美", LAm: "拉丁美洲", SAm: "南美", Am: "美洲", PHL: "菲律賓",
  VTN: "越南", MNG: "蒙古", RUS: "俄羅斯", Sib: "西伯利亞", AUS: "澳洲", INS: "印尼",
};
export const targetName = t => (t || "").split(/[,\s/]+/).filter(Boolean).map(x => TARGET[x] || x).join("、") || "—";
