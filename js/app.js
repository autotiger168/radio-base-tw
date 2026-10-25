// =============================================================
//  台灣電波地圖 Radio Base TW — 主程式
// =============================================================
import { CONFIG } from "./config.js";
import { loadStations, formatFreq } from "./data.js";
import { AudioEngine, findStreams } from "./audio-engine.js";
import { RadioUI } from "./radio-ui.js";
import { StationMap } from "./map.js";
import { ShortwavePage, kiwiUrl, receivers } from "./shortwave.js";
import { Scheduler } from "./scheduler.js";
import { DXLog } from "./dxlog.js";
import { MorePage } from "./more.js";
import { saveRecording, listRecordings, deleteRecording, renameRecording, fileName } from "./recordings.js";

const $ = s => document.querySelector(s);
const swTime = t => `${String((Math.floor(t / 100) + 8) % 24).padStart(2, "0")}:${String(t % 100).padStart(2, "0")}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { stations: [], filtered: [], current: null, tuneToken: 0, streamInfo: {} };
const engine = new AudioEngine();

// 自動配對結果記在這台裝置，下次不用再查
const matchCache = {
  get(id) { try { return JSON.parse(localStorage.getItem("rbtw:match:" + id)); } catch { return null; } },
  set(id, v) { try { localStorage.setItem("rbtw:match:" + id, JSON.stringify(v)); } catch {} },
  clear(id) { try { localStorage.removeItem("rbtw:match:" + id); } catch {} },
};

// ---------- 啟動 ----------
async function init() {
  const { stations, source } = await loadStations();
  state.stations = stations;
  $("#data-source").textContent = `資料來源：${source}・${stations.length} 筆`;
  if (!CONFIG.PROXY_URL) $("#proxy-note").hidden = false;

  radio = new RadioUI($("#radio"), engine, {
    getStations: () => sw ? state.stations.concat(sw.dialStations) : state.stations,
    onTune: tuneTo,
    onPower: on => {
      if (!on) {
        finishRecording(); engine.stop();
        if (scheduler?.sleepUntil) { scheduler.setSleep(0); radio.setSleepText(""); }
      }
    },
    onRecord: toggleRecord,
    onSleep: min => { scheduler.setSleep(min); if (!min) { radio.setSleepText(""); engine.setVolume(engine.volume); } },
  });
  map = new StationMap($("#map"), { onSelect: s => radio.tune(s) });
  sw = new ShortwavePage($("#page-shortwave"), {
    onListen: entry => {
      // 第一次從短波世界收聽時，換上 80s 短波機身
      if (!state.swSkinDone && radio.skin !== "shortwave") radio.setSkin("shortwave");
      state.swSkinDone = true;
      radio.tune(entry);
    },
    logIndex: () => dx ? dx.index() : new Map(),
  });
  dx = new DXLog($("#page-dxlog"), {
    getCurrent: () => state.current,
    onChange: () => sw?.data && sw.refresh(),
    toast,
  });
  scheduler = new Scheduler($("#timers"), {
    getStations: () => state.stations,
    onAlarm: fireAlarm,
    onRecord: fireRecord,
    onSleepTick: left => {
      radio.setSleepText(`睡眠 ${Math.ceil(left / 60)} 分`);
      if (left <= 60 && !state.sleepFading && engine.playing) { state.sleepFading = true; engine.fade(engine.volume, 0.0001, left); }
    },
    onSleepEnd: () => {
      state.sleepFading = false;
      radio.setSleepText("");
      if (radio.power) radio.togglePower();
      setTimeout(() => engine.setVolume(engine.volume), 500);
      toast("睡眠定時到了，收音機已關機。晚安 🌙");
    },
  });
  new MorePage($("#page-more"), {
    onAction: a => {
      showTab("shortwave");
      if (a === "sw-lang-J") sw.setLang("J");
      if (a === "sw-search-shiokaze") sw.search("shiokaze");
    },
  });
  unlockAutoplay();

  buildFilters();
  applyFilters();
  bindTabs();
  renderInfo(null);
  refreshRecordings();
}

let radio, map, sw, dx, scheduler;

// ---------- 篩選 ----------
function buildFilters() {
  const uniq = k => [...new Set(state.stations.map(s => s[k]).filter(Boolean))];
  const fill = (sel, vals) => { sel.innerHTML = `<option value="">全部</option>` + vals.map(v => `<option>${esc(v)}</option>`).join(""); };
  fill($("#f-region"), ["北部", "中部", "南部", "東部", "離島"].filter(r => uniq("region").includes(r)));
  fill($("#f-county"), uniq("county"));
  fill($("#f-genre"), uniq("genre"));
  ["#f-q", "#f-band", "#f-region", "#f-county", "#f-genre", "#f-verified"].forEach(id =>
    $(id).addEventListener("input", applyFilters));
}

function applyFilters() {
  const q = $("#f-q").value.trim().toLowerCase();
  const band = $("#f-band").value, region = $("#f-region").value;
  const county = $("#f-county").value, genre = $("#f-genre").value;
  const verified = $("#f-verified").checked;
  state.filtered = state.stations.filter(s =>
    (!q || [s.name, s.network, s.county, s.genre, String(s.freq), s.note].join(" ").toLowerCase().includes(q)) &&
    (!band || s.band === band) && (!region || s.region === region) &&
    (!county || s.county === county) && (!genre || s.genre === genre) &&
    (!verified || s.verified));
  $("#count").textContent = `${state.filtered.length} 個電台`;
  map.show(state.filtered, state.current?.id);
  renderList();
}

function renderList() {
  const rows = state.filtered.slice().sort((a, b) => a.band.localeCompare(b.band) || a.freq - b.freq);
  $("#station-list").innerHTML = rows.map(s => `
    <li class="st ${state.current?.id === s.id ? "on" : ""}" data-id="${esc(s.id)}">
      <button class="st-play" aria-label="收聽 ${esc(s.name)}">▶</button>
      <div class="st-main">
        <b>${esc(s.name)}</b>
        <small>${esc(s.county)}・${esc(s.genre || "")}${s.verified ? "" : ` <span class="tag-warn">待核對</span>`}</small>
      </div>
      <span class="st-freq ${s.band === "AM" ? "am" : "fm"}">${s.band} ${esc(formatFreq(s))}</span>
    </li>`).join("") || `<li class="empty">沒有符合條件的電台</li>`;
  $("#station-list").querySelectorAll(".st").forEach(li => {
    const s = state.stations.find(x => x.id === li.dataset.id);
    li.addEventListener("click", () => { radio.tune(s); map.focus(s); });
  });
}

// ---------- 調台與播放 ----------
async function tuneTo(station) {
  const token = ++state.tuneToken;
  finishRecording();          // 換台前先把上一台的錄音存好
  state.current = station;
  map.highlight(station.id);
  document.querySelectorAll(".st").forEach(li => li.classList.toggle("on", li.dataset.id === station.id));
  renderInfo(station);
  radio.setStatus("尋找串流…", "");

  let stream = station.stream, origin = "試算表";
  if (!stream && CONFIG.AUTO_MATCH_STREAM) {
    const cached = matchCache.get(station.id);
    if (cached) { stream = cached.url; origin = `自動配對：${cached.name}`; }
    else {
      const found = await findStreams(station);
      if (token !== state.tuneToken) return;
      state.streamInfo[station.id] = { candidates: found };
      if (found.length && found[0].score > 0) {
        stream = found[0].url; origin = `自動配對：${found[0].name}`;
        matchCache.set(station.id, found[0]);
      } else if (found.length) {
        // 有結果但不確定是否同一台 → 列出讓使用者選
        renderInfo(station);
      }
    }
  }
  if (token !== state.tuneToken) return;
  state.streamInfo[station.id] = { ...(state.streamInfo[station.id] || {}), url: stream, origin };

  if (!stream) {
    engine.stop();
    radio.setStatus("無線上串流", station.band === "SW" ? "可用 KiwiSDR 收聽真實電波" : "請改用收音機或官網收聽");
    renderInfo(station);
    return;
  }
  try {
    const mode = await engine.play(stream, { title: station.name, artist: `${station.band} ${formatFreq(station)}` });
    if (token !== state.tuneToken) return;
    if (radio.skin === "vintage") engine.warmUp(1.8);
    radio.setStatus("播放中", mode === "webaudio" ? "可錄音" : "此台無法錄音");
    state.streamInfo[station.id].mode = mode;
  } catch (e) {
    if (token !== state.tuneToken) return;
    const msg = e.message === "HTTP_BLOCKED" ? "http 串流需設定中繼"
      : e.message === "HLS_CORS" ? "此串流需設定中繼才能播放"
      : e.name === "NotAllowedError" ? "請再按一次播放" : "串流無法連線";
    radio.setStatus("無法播放", msg);
    state.streamInfo[station.id].error = msg;
    if (origin.startsWith("自動配對")) matchCache.clear(station.id);
  }
  renderInfo(station);
}

// ---------- 電台資訊卡 ----------
function linkBtn(href, label, cls = "") {
  return `<a class="lnk ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
}

function renderInfo(s) {
  const box = $("#info");
  if (!s) {
    box.innerHTML = `<div class="info-empty"><b>點地圖上的電台，或轉動收音機的調台旋鈕</b><span>藍色是 FM、橘色是 AM；有綠點的代表試算表裡已填好串流網址。</span></div>`;
    return;
  }
  const q = encodeURIComponent(s.name.replace(/\s+(台北|台中|高雄|中部|南部|宜蘭|竹苗)$/, ""));
  const kiwi = s.band === "SW" ? receivers().slice(0, 3).map(k =>
    linkBtn(kiwiUrl(k.url, s.freq), `📡 ${esc(k.name)}`)).join("") || linkBtn("https://rx.kiwisdr.com/", "📡 找 KiwiSDR 接收機", "search") : "";
  const social = s.band === "SW" ? [
    s.website ? linkBtn(s.website, "🌐 官網") : linkBtn(`https://www.google.com/search?q=${encodeURIComponent(s.network)}+shortwave`, "🔍 搜尋官網", "search"),
    kiwi,
  ].join("") : [
    s.website ? linkBtn(s.website, "🌐 官網") : linkBtn(`https://www.google.com/search?q=${q}+官網`, "🔍 搜尋官網", "search"),
    s.facebook ? linkBtn(s.facebook, "Facebook", "fb") : linkBtn(`https://www.facebook.com/search/pages/?q=${q}`, "🔍 Facebook", "search fb"),
    s.instagram ? linkBtn(s.instagram, "Instagram", "ig") : linkBtn(`https://www.google.com/search?q=site%3Ainstagram.com+${q}`, "🔍 Instagram", "search ig"),
    s.threads ? linkBtn(s.threads, "Threads", "th") : linkBtn(`https://www.threads.com/search?q=${q}`, "🔍 Threads", "search th"),
    s.youtube ? linkBtn(s.youtube, "YouTube", "yt") : "",
  ].join("");
  const info = state.streamInfo[s.id] || {};
  const cands = (info.candidates || []).filter(c => c.url !== info.url).slice(0, 4);
  box.innerHTML = `
    <div class="info-head">
      <div>
        <h2>${esc(s.name)}</h2>
        <p>${esc(s.network || "")}${s.network ? "・" : ""}${esc(s.county)}・${esc(s.genre || "")}</p>
      </div>
      <span class="info-freq ${s.band === "AM" ? "am" : s.band === "SW" ? "sw" : "fm"}">${s.band}<b>${esc(formatFreq(s).split(" ")[0])}</b><small>${esc(formatFreq(s).split(" ")[1])}</small></span>
    </div>
    ${s.sw ? `<p class="info-note">${esc(s.sw.lang)}・對${esc(s.sw.target)}廣播・發射地 ${esc(s.sw.tx)}・台灣時間 ${swTime(s.sw.row[1])}–${swTime(s.sw.row[2])}</p>` : ""}
    ${s.note ? `<p class="info-note">${esc(s.note)}</p>` : ""}
    ${s.verified ? "" : `<p class="info-warn">⚠ 這筆資料的頻率或所在地尚待核對，確認後請在試算表「已核對」欄填 Y。</p>`}
    <div class="links">${social}<button class="lnk log-btn" id="log-this">📒 記錄到日誌</button></div>
    <div class="stream-box">
      <div class="stream-row">
        <span>線上串流</span>
        <code>${info.url ? esc(info.origin) : (s.stream ? "試算表" : "尚未取得")}</code>
        ${info.url ? `<button class="mini" id="copy-url" title="複製網址貼到試算表的「串流網址」欄">複製網址</button>` : ""}
      </div>
      ${info.error ? `<p class="info-warn">${esc(info.error)}</p>` : ""}
      ${cands.length ? `<details><summary>其他可能的串流（${cands.length}）</summary>
        <ul class="cands">${cands.map((c, i) => `<li><button class="mini" data-cand="${i}">試聽</button> ${esc(c.name)} <small>${esc(c.codec || "")} ${c.bitrate || ""}k</small></li>`).join("")}</ul>
      </details>` : ""}
    </div>`;
  $("#log-this")?.addEventListener("click", () => { dx.prefill(s); showTab("dxlog"); });
  const copy = $("#copy-url");
  if (copy) copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(info.url); toast("已複製，貼到試算表「串流網址」欄就會固定使用"); }
    catch { prompt("複製這個網址：", info.url); }
  });
  box.querySelectorAll("[data-cand]").forEach(b => b.addEventListener("click", () => {
    const c = cands[+b.dataset.cand];
    matchCache.set(s.id, c);
    delete state.streamInfo[s.id];
    radio.tune(s);
  }));
}

// ---------- 錄音 ----------
function toggleRecord() {
  if (engine.recording) { finishRecording(); return; }
  if (!radio.power || !engine.playing) { toast("請先開機並收聽一個電台"); return; }
  try {
    engine.startRecording();
    toast("開始錄音（MP3）");
  } catch (e) {
    toast(e.message === "NO_ENCODER" ? "MP3 編碼器載入失敗，請重新整理"
      : CONFIG.PROXY_URL ? "這個串流不允許錄音" : "這個電台需要先設定串流中繼才能錄音（見 README）");
  }
}

async function finishRecording() {
  const res = engine.stopRecording();
  if (!res || !state.current) return;
  if (res.duration < 1) return;
  const rec = {
    id: String(res.started), started: res.started, duration: res.duration,
    station: state.current.name, freq: `${state.current.band} ${formatFreq(state.current)}`,
    name: fileName(state.current.name, res.started), blob: res.blob,
  };
  await saveRecording(rec);
  toast(`錄音完成：${rec.name}`, "前往錄音室", () => showTab("recordings"));
  refreshRecordings();
}

async function refreshRecordings() {
  const list = await listRecordings();
  $("#rec-count").textContent = list.length ? `(${list.length})` : "";
  const box = $("#rec-list");
  if (!list.length) {
    box.innerHTML = `<li class="empty">還沒有錄音。收聽時按收音機上的紅色 REC 鍵開始，再按一次停止。</li>`;
    return;
  }
  box.innerHTML = list.map(r => {
    const url = URL.createObjectURL(r.blob);
    const mm = Math.floor(r.duration / 60), ss = String(r.duration % 60).padStart(2, "0");
    const size = (r.blob.size / 1048576).toFixed(1);
    return `<li class="rec" data-id="${esc(r.id)}">
      <div class="rec-head">
        <input class="rec-name" value="${esc(r.name)}" aria-label="檔名">
        <span>${esc(r.freq)}・${new Date(r.started).toLocaleString("zh-TW", { hour12: false })}・${mm}:${ss}・${size} MB</span>
      </div>
      <audio controls preload="none" src="${url}"></audio>
      <div class="rec-actions">
        <a class="mini" href="${url}" download="${esc(r.name)}">⬇ 下載 MP3</a>
        <button class="mini danger" data-del>刪除</button>
      </div>
    </li>`;
  }).join("");
  box.querySelectorAll(".rec").forEach(li => {
    const id = li.dataset.id;
    li.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm("確定刪除這個錄音？")) return;
      await deleteRecording(id); refreshRecordings();
    });
    const input = li.querySelector(".rec-name");
    input.addEventListener("change", async () => {
      let v = input.value.trim(); if (!v.endsWith(".mp3")) v += ".mp3";
      await renameRecording(id, v);
      li.querySelector("a[download]").setAttribute("download", v);
    });
  });
}

// ---------- 分頁 ----------
function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
}
function showTab(id) {
  document.body.dataset.tab = id;
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === id));
  document.querySelectorAll(".tab-page").forEach(p => p.hidden = p.id !== "page-" + id);
  if (id === "map") map.invalidate();
  if (id === "shortwave" && sw?.map) setTimeout(() => sw.map.invalidateSize(), 60);
}

// ---------- 鬧鐘與預約錄音 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPlaying(sec = 20) {
  for (let i = 0; i < sec * 2; i++) { if (engine.playing) return true; await sleep(500); }
  return false;
}

async function fireAlarm(item, station) {
  showAlarm(item, station);
  if (!station) { engine.beep(60); return; }
  const target = engine.volume;
  radio.tune(station);
  if (await waitPlaying()) {
    if (item.fade) engine.fade(0.0001, target, item.fade);
  } else {
    engine.beep(60);       // 串流連不上就用鈴聲
  }
}

function showAlarm(item, station) {
  const ov = $("#alarm-overlay");
  ov.querySelector(".al-time").textContent = new Date().toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" });
  ov.querySelector(".al-label").textContent = item.label || "收音機鬧鐘";
  ov.querySelector(".al-station").textContent = station ? `${station.band} ${formatFreq(station)}　${station.name}` : "（電台已不存在，改用鈴聲）";
  ov.hidden = false;
  ov.querySelector(".al-keep").onclick = () => { ov.hidden = true; engine.stopBeep(); };
  ov.querySelector(".al-off").onclick = () => { ov.hidden = true; engine.stopBeep(); if (radio.power) radio.togglePower(); };
  ov.querySelector(".al-snooze").onclick = () => {
    ov.hidden = true; engine.stopBeep(); if (radio.power) radio.togglePower();
    toast("10 分鐘後再叫你");
    setTimeout(() => fireAlarm({ ...item, label: (item.label || "鬧鐘") + "（貪睡）" }, station), 10 * 60000);
  };
}

async function fireRecord(item, station) {
  if (!station) return { ok: false, msg: "失敗：電台已不存在" };
  radio.tune(station);
  if (!(await waitPlaying())) return { ok: false, msg: "失敗：串流連不上" };
  if (!engine.canRecord) return { ok: false, msg: "失敗：此台需設定串流中繼才能錄音" };
  try { engine.startRecording(); } catch { return { ok: false, msg: "失敗：無法開始錄音" }; }
  const startedFor = station.id;
  toast(`預約錄音開始：${station.name}（${item.duration < 1 ? "測試 15 秒" : item.duration + " 分鐘"}）`);
  setTimeout(() => { if (engine.recording && state.current?.id === startedFor) finishRecording(); }, item.duration * 60000);
  return { ok: true, msg: `開始錄音 ${item.duration < 1 ? "（測試）" : item.duration + " 分鐘"}` };
}

// 瀏覽器規定「有聲音的自動播放」要先有一次點擊；第一次點頁面時順便解鎖
function unlockAutoplay() {
  const once = () => {
    engine.ensureContext();
    const silent = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    [engine.corsEl, engine.plainEl].forEach(el => {
      if (el.src) return;
      el.src = silent;
      const clear = () => { if (el.src === silent) { el.pause(); el.removeAttribute("src"); el.load(); } };
      el.play().then(clear).catch(clear);
    });
    document.removeEventListener("pointerdown", once, true);
  };
  document.addEventListener("pointerdown", once, true);
}

// ---------- 提示 ----------
function toast(msg, action, fn) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ""}`;
  if (action) t.querySelector("button").onclick = () => { fn(); t.classList.remove("show"); };
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 4000);
}

engine.onStateChange = () => {};
init();
