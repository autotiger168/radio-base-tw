// =============================================================
//  每週檢查電台的官網、社群與串流網址是否還能用
//  結果寫到 link-report.md（也會顯示在 GitHub Actions 的執行摘要）
// =============================================================
import fs from "node:fs";
import { parseCSV } from "../js/data.js";

const cfg = fs.readFileSync("js/config.js", "utf8");
const pick = key => (cfg.match(new RegExp(`${key}:\\s*"([^"]*)"`)) || [])[1] || "";

async function readCSV(url, file) {
  if (url) {
    try { const r = await fetch(url); if (r.ok) return { rows: parseCSV(await r.text()), from: "Google 試算表" }; } catch {}
  }
  return { rows: parseCSV(fs.readFileSync(file, "utf8")), from: file };
}

const UA = "Mozilla/5.0 (compatible; RadioBaseTW-linkcheck/1.0)";

async function checkPage(url) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctl.signal, headers: { "User-Agent": UA } });
    if (r.status === 405 || r.status === 403) r = await fetch(url, { method: "GET", redirect: "follow", signal: ctl.signal, headers: { "User-Agent": UA } });
    clearTimeout(t);
    if (r.ok) return { ok: true, note: String(r.status) };
    // 社群網站常擋機器人，不算失效
    if ([401, 403, 429, 999].includes(r.status)) return { ok: null, note: `${r.status}（網站擋自動檢查，請手動確認）` };
    return { ok: false, note: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, note: e.name === "AbortError" ? "逾時" : e.message }; }
}

async function checkStream(url) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, "Icy-MetaData": "0" } });
    if (!r.ok) { clearTimeout(t); return { ok: false, note: `HTTP ${r.status}` }; }
    const type = r.headers.get("content-type") || "";
    const reader = r.body.getReader();
    let got = 0;
    while (got < 8192) { const { value, done } = await reader.read(); if (done) break; got += value.length; }
    ctl.abort(); clearTimeout(t);
    if (got === 0) return { ok: false, note: "沒有資料" };
    if (!/audio|mpegurl|octet|ogg|aac|mpeg/i.test(type)) return { ok: null, note: `類型 ${type || "未知"}，請手動確認` };
    return { ok: true, note: type };
  } catch (e) { return { ok: false, note: e.name === "AbortError" ? "逾時" : e.message }; }
}

const LINK_COLS = ["官網", "Facebook", "Instagram", "Threads", "YouTube"];
const results = [];

async function run(rows, label, nameCol, streamCol, linkCols) {
  const head = rows[0].map(h => h.trim());
  const idx = c => head.indexOf(c);
  for (const r of rows.slice(1)) {
    const name = r[idx(nameCol)];
    if (!name) continue;
    const jobs = [];
    for (const col of linkCols) {
      const url = (r[idx(col)] || "").trim();
      if (url) jobs.push(checkPage(url).then(res => results.push({ label, name, col, url, ...res })));
    }
    const s = (r[idx(streamCol)] || "").trim();
    if (s) jobs.push(checkStream(s).then(res => results.push({ label, name, col: "串流", url: s, ...res })));
    await Promise.all(jobs);
  }
}

const tw = await readCSV(pick("SHEET_CSV_URL"), "data/stations.csv");
const swd = await readCSV(pick("SW_SHEET_CSV_URL"), "data/sw-stations.csv");
await run(tw.rows, "台灣電台", "台名", "串流網址", LINK_COLS);
await run(swd.rows, "短波電台", "中文名", "串流網址", ["官網"]);

const bad = results.filter(r => r.ok === false), unsure = results.filter(r => r.ok === null);
const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
const table = list => list.length
  ? "| 類別 | 電台 | 欄位 | 結果 | 網址 |\n|---|---|---|---|---|\n" +
    list.map(r => `| ${r.label} | ${r.name} | ${r.col} | ${r.note} | ${r.url} |`).join("\n")
  : "（無）";
const md = `# 電台連結檢查報告

檢查時間：${now}（台灣時間）
資料來源：${tw.from}、${swd.from}
共檢查 ${results.length} 個網址：✅ 正常 ${results.filter(r => r.ok).length}・❌ 失效 ${bad.length}・⚠️ 需手動確認 ${unsure.length}

## ❌ 失效（請到試算表更新或清空）
${table(bad)}

## ⚠️ 需手動確認
${table(unsure)}
`;
fs.writeFileSync("link-report.md", md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(`檢查 ${results.length} 個網址，失效 ${bad.length}，需確認 ${unsure.length}`);
