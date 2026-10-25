// =============================================================
//  短波世界：台灣可收的全球短波頻率表
// =============================================================
import { CONFIG } from "./config.js";
import { parseCSV } from "./data.js";
import { SW_BANDS, bandOf, onAir, airsInHour, score, stars, langName, targetName, TW } from "./sw-score.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WEEK = ["", "一", "二", "三", "四", "五", "六", "日"];
const pad = n => String(n).padStart(2, "0");
const hhmm = t => `${pad(Math.floor(t / 100))}:${pad(t % 100)}`;
// UTC HHMM → 台灣時間 HH:MM
const twTime = t => hhmm(((Math.floor(t / 100) + 8) % 24) * 100 + (t % 100));

export class ShortwavePage {
  constructor(root, { onListen, logIndex }) {
    this.root = root;
    this.onListen = onListen;
    this.logIndex = logIndex || (() => new Map());
    this.data = null;
    this.dir = [];
    this.mode = "now";           // "now" | "pick"
    this.pickHour = new Date().getHours();
    this.pickDay = ((new Date().getDay() + 6) % 7) + 1;
    this.filters = { band: "", lang: "", q: "", min: 2 };
    this.page = 0;
    this.render();
    this.load();
    setInterval(() => { if (this.mode === "now" && this.data && !this.root.hidden) this.refresh(); }, 60000);
  }

  // ---------- 資料 ----------
  async load() {
    try {
      const idx = await (await fetch("data/sw/index.json", { cache: "no-store" })).json();
      this.index = idx;
      const codes = idx.seasons.map(s => s.code);
      const pick = codes.includes(idx.current) ? idx.current : codes[codes.length - 1];
      this.$(".sw-season").innerHTML = idx.seasons.map(s =>
        `<option value="${s.code}" ${s.code === pick ? "selected" : ""}>${s.season}${s.code === idx.current ? "（本季）" : ""}・${s.count} 筆</option>`).join("");
      await this.loadSeason(pick);
    } catch (e) {
      console.warn(e);
      this.$(".sw-body").hidden = true;
      this.$(".sw-setup").hidden = false;
    }
    this.loadDirectory();
    this.loadSolar();
  }

  async loadSeason(code) {
    this.$(".sw-status").textContent = "讀取排程中…";
    const j = await (await fetch(`data/sw/${code}.json`, { cache: "no-store" })).json();
    this.data = j;
    const langs = [...new Set(j.rows.map(r => r[5]))].filter(Boolean)
      .sort((a, b) => (langName(a) === a) - (langName(b) === b) || a.localeCompare(b));
    this.$(".sw-lang").innerHTML = `<option value="">全部語言</option>` +
      langs.map(l => `<option value="${esc(l)}">${esc(langName(l))}${langName(l) !== l ? ` (${esc(l)})` : ""}</option>`).join("");
    const info = this.index?.seasons.find(s => s.code === code);
    this.$(".sw-status").textContent =
      `${j.season} 季・${j.count} 筆排程・${j.stations.length} 個電台・更新於 ${new Date(info?.generated || j.generated).toLocaleDateString("zh-TW")}`;
    this.refresh();
  }

  async loadDirectory() {
    const urls = [CONFIG.SW_SHEET_CSV_URL, "data/sw-stations.csv"].filter(Boolean);
    for (const u of urls) {
      try {
        const rows = parseCSV(await (await fetch(u, { cache: "no-store" })).text());
        this.dir = rows.slice(1).map(r => ({
          key: (r[0] || "").trim().toLowerCase(), zh: r[1], website: r[2], stream: r[3], rb: r[4], note: r[5],
        })).filter(d => d.key);
        if (this.data) this.refresh();
        return;
      } catch {}
    }
  }

  lookup(stationName) {
    const n = stationName.toLowerCase();
    return this.dir.find(d => n.includes(d.key)) || null;
  }

  async loadSolar() {
    const box = this.$(".sw-solar");
    try {
      const [flux, kp] = await Promise.all([
        fetch("https://services.swpc.noaa.gov/json/f107_cm_flux.json").then(r => r.json()),
        fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json").then(r => r.json()),
      ]);
      const sfi = Math.round(+(flux[0]?.flux ?? flux[flux.length - 1]?.flux));
      const lastKp = kp[kp.length - 1];
      const k = +(Array.isArray(lastKp) ? lastKp[1] : lastKp.Kp ?? lastKp.kp_index);
      const cond = k >= 5 ? ["差", "地磁風暴，高頻段可能中斷"] : k >= 4 ? ["普通", "地磁略擾動"] :
        sfi >= 150 ? ["很好", "太陽活動高，高頻段（19m 以上）容易開通"] : sfi >= 100 ? ["好", "中高頻段條件不錯"] : ["普通", "太陽活動偏低，建議聽 31m 以下"];
      box.innerHTML = `<b>今日傳播條件：${cond[0]}</b><span>太陽通量 SFI ${sfi}・Kp 指數 ${k.toFixed(1)}・${cond[1]}</span>`;
    } catch {
      box.innerHTML = `<b>傳播條件</b><span>暫時無法取得 NOAA 太陽活動資料</span>`;
    }
  }

  // ---------- 時間 ----------
  // 回傳 { date: 用於評分的 Date, utcMin, weekday(UTC) , twHour }
  moment() {
    if (this.mode === "now") {
      const d = new Date();
      return { date: d, utcMin: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: ((d.getUTCDay() + 6) % 7) + 1,
        twHour: (d.getUTCHours() + 8) % 24, label: "現在" };
    }
    // 台灣時間 pickHour:30、星期 pickDay → UTC
    let utcH = this.pickHour - 8, wd = this.pickDay;
    if (utcH < 0) { utcH += 24; wd = wd === 1 ? 7 : wd - 1; }
    const d = new Date(); d.setUTCHours(utcH, 30, 0, 0);
    return { date: d, utcMin: utcH * 60 + 30, weekday: wd, twHour: this.pickHour,
      label: `週${WEEK[this.pickDay]} ${pad(this.pickHour)}:00–${pad(this.pickHour)}:59` };
  }

  passesFilters(row, { ignoreBand = false } = {}) {
    const f = this.filters;
    if (!ignoreBand && f.band && bandOf(row[0]) !== f.band) return false;
    if (f.lang && row[5] !== f.lang) return false;
    if (f.q) {
      const name = this.data.stations[row[4]].toLowerCase();
      const zh = (this.lookup(name)?.zh || "").toLowerCase();
      if (!name.includes(f.q) && !zh.includes(f.q) && !String(row[0]).startsWith(f.q)) return false;
    }
    return true;
  }

  // ---------- 畫面 ----------
  $(s) { return this.root.querySelector(s); }

  render() {
    this.root.innerHTML = `
      <div class="card sw-head">
        <div class="sw-title">
          <h2 class="sec-title">短波世界・台灣可收頻率表</h2>
          <p class="sw-status hint">讀取中…</p>
        </div>
        <div class="sw-solar"><b>傳播條件</b><span>讀取中…</span></div>
      </div>

      <div class="card sw-setup" hidden>
        <h3>還沒有短波排程資料</h3>
        <p>排程由 GitHub Actions 每週自動下載。第一次請手動執行一次：</p>
        <ol>
          <li>到你的 GitHub repo，點上方 <b>Actions</b></li>
          <li>左側選 <b>更新短波排程</b>，右邊按 <b>Run workflow</b></li>
          <li>約 1 分鐘後重新整理這一頁</li>
        </ol>
      </div>

      <div class="sw-body">
        <div class="card sw-controls">
          <label>季節 <select class="sw-season"></select></label>
          <div class="seg" role="radiogroup" aria-label="時間">
            <button data-mode="now" aria-pressed="true">現在</button>
            <button data-mode="pick" aria-pressed="false">指定時間</button>
          </div>
          <label class="sw-pick" hidden>星期
            <select class="sw-day">${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}">週${WEEK[d]}</option>`).join("")}</select>
          </label>
          <label class="sw-pick sw-hour-wrap" hidden>台灣時間
            <input class="sw-hour" type="range" min="0" max="23" step="1">
            <output class="sw-hour-out"></output>
          </label>
          <label>波段 <select class="sw-band"><option value="">全部</option>${SW_BANDS.map(b => `<option>${b.name}</option>`).join("")}</select></label>
          <label><select class="sw-lang"></select></label>
          <label>最低 <select class="sw-min">
            ${[0, 1, 2, 3, 4].map(n => `<option value="${n}" ${n === 2 ? "selected" : ""}>${n ? "★".repeat(n) + " 以上" : "全部"}</option>`).join("")}
          </select></label>
          <input class="sw-q" type="search" placeholder="搜尋電台或頻率…" aria-label="搜尋短波電台">
        </div>

        <div class="sw-grid">
          <section class="card sw-now">
            <div class="sw-sec-head"><h3>可收清單 <small class="sw-when"></small></h3><span class="sw-now-count hint"></span></div>
            <ul class="sw-list"></ul>
          </section>
          <section class="card sw-mapcard">
            <div class="sw-sec-head"><h3>發射站 → 台灣</h3><span class="hint">線越亮越好收</span></div>
            <div class="sw-map"></div>
          </section>
        </div>

        <section class="card sw-heat-card">
          <div class="sw-sec-head"><h3>時間 × 波段熱力圖 <small class="hint">每格 = 該小時可收（★★★以上）的節目數，點格子可查看</small></h3></div>
          <div class="sw-heat-wrap"><table class="sw-heat"></table></div>
        </section>

        <section class="card sw-table-card">
          <div class="sw-sec-head"><h3>完整頻率表 <small class="hint">時間為台灣時間（UTC+8）</small></h3><span class="sw-table-count hint"></span></div>
          <div class="sw-table-wrap">
            <table class="sw-table">
              <thead><tr><th>頻率 kHz</th><th>波段</th><th>電台</th><th>台灣時間</th><th>星期</th><th>語言</th><th>目標區</th><th>發射地</th><th>可收</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="sw-pager"></div>
        </section>

        <section class="card sw-kiwi">
          <h3>用網路接收機聽真正的短波</h3>
          <p class="hint">KiwiSDR／WebSDR 是全球玩家架設、可從瀏覽器操作的短波接收機，聽到的是真實電波（含雜訊、衰落）。
          先到下面的名錄挑一台離台灣近的（台灣、日本、菲律賓、香港一帶），把網址加進「你的接收機」，清單上的「📡」就會直接開到該頻率。</p>
          <div class="links">
            <a class="lnk" href="https://rx.kiwisdr.com/" target="_blank" rel="noopener">KiwiSDR 公開接收機地圖</a>
            <a class="lnk" href="http://websdr.org/" target="_blank" rel="noopener">WebSDR 名錄</a>
          </div>
          <div class="sw-kiwi-list"></div>
        </section>
        <p class="hint sw-attrib">排程資料：EiBi（www.eibispace.de）・可收指數為依時段、頻段、距離與目標區估算的參考值。</p>
      </div>`;

    const r = this.root;
    this.$(".sw-season").addEventListener("change", e => this.loadSeason(e.target.value));
    r.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
      this.mode = b.dataset.mode;
      r.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
      r.querySelectorAll(".sw-pick").forEach(x => x.hidden = this.mode !== "pick");
      this.refresh();
    }));
    const hour = this.$(".sw-hour"), out = this.$(".sw-hour-out"), day = this.$(".sw-day");
    hour.value = this.pickHour; day.value = this.pickDay;
    const showHour = () => out.textContent = `${pad(this.pickHour)}:00`;
    showHour();
    hour.addEventListener("input", () => { this.pickHour = +hour.value; showHour(); this.refresh(); });
    day.addEventListener("change", () => { this.pickDay = +day.value; this.refresh(); });
    this.$(".sw-band").addEventListener("change", e => { this.filters.band = e.target.value; this.page = 0; this.refresh(); });
    this.$(".sw-lang").addEventListener("change", e => { this.filters.lang = e.target.value; this.page = 0; this.refresh(); });
    this.$(".sw-min").addEventListener("change", e => { this.filters.min = +e.target.value; this.page = 0; this.refresh(); });
    this.$(".sw-q").addEventListener("input", e => { this.filters.q = e.target.value.trim().toLowerCase(); this.page = 0; this.refresh(); });
    this.renderKiwiList();
  }

  setPick(hour, band) {
    this.mode = "pick"; this.pickHour = hour; this.filters.band = band; this.page = 0;
    this.$(".sw-hour").value = hour; this.$(".sw-hour-out").textContent = `${pad(hour)}:00`;
    this.$(".sw-band").value = band;
    this.root.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", x.dataset.mode === "pick"));
    this.root.querySelectorAll(".sw-pick").forEach(x => x.hidden = false);
    this.refresh();
    this.$(".sw-now").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  refresh() {
    if (!this.data) return;
    const m = this.moment();
    this.$(".sw-when").textContent = `・${m.label}（台灣時間）`;
    // 目前時刻播出中、通過篩選、達最低星數
    const live = [];
    for (const row of this.data.rows) {
      if (!this.passesFilters(row)) continue;
      const inTime = this.mode === "now" ? onAir(row, m.utcMin, m.weekday) : airsInHour(row, Math.floor(m.utcMin / 60), m.weekday);
      if (!inTime) continue;
      const sc = score(row, this.data.sites, m.date);
      if (sc + 0.5 < this.filters.min) continue;
      live.push({ row, sc });
    }
    live.sort((a, b) => b.sc - a.sc || a.row[0] - b.row[0]);
    this.live = live;
    this.renderLive(live);
    this.renderMap(live);
    this.renderHeat(m);
    this.renderTable(m);
  }

  entry(row) {
    const name = this.data.stations[row[4]];
    const d = this.lookup(name);
    const site = this.data.sites[row[7]];
    return {
      id: `sw:${row[0]}:${row[4]}:${row[1]}`, band: "SW", freq: row[0], name: d?.zh || name,
      network: name, genre: langName(row[5]), county: site ? site[2] : row[7], region: "全部",
      stream: d?.stream || "", website: d?.website || "", rbName: d?.rb || "", note: d?.note || "",
      verified: true, sw: { row, target: targetName(row[6]), lang: langName(row[5]), tx: site ? site[2] : row[7] },
    };
  }

  canStream(row) {
    const d = this.lookup(this.data.stations[row[4]]);
    return !!(d && (d.stream || d.rb));
  }

  rowActions(row) {
    const e = this.entry(row);
    const kiwi = receivers()[0];
    return `
      <button class="mini sw-listen" data-k="${esc(e.id)}" title="${this.canStream(row) ? "收聽電台的網路串流" : "嘗試搜尋網路串流"}">▶${this.canStream(row) ? " 線上" : ""}</button>
      ${kiwi ? `<a class="mini" href="${esc(kiwiUrl(kiwi.url, row[0]))}" target="_blank" rel="noopener" title="用 ${esc(kiwi.name)} 收聽 ${row[0]} kHz">📡</a>` : ""}
      ${e.website ? `<a class="mini" href="${esc(e.website)}" target="_blank" rel="noopener" title="官網">🌐</a>` : ""}`;
  }

  bindListen(scope) {
    scope.querySelectorAll(".sw-listen").forEach(b => b.addEventListener("click", ev => {
      ev.stopPropagation();
      const row = this.data.rows.find(r => `sw:${r[0]}:${r[4]}:${r[1]}` === b.dataset.k);
      if (row) this.onListen(this.entry(row));
    }));
  }

  renderLive(live) {
    const list = this.$(".sw-list");
    this.$(".sw-now-count").textContent = `${live.length} 個節目`;
    if (!live.length) {
      list.innerHTML = `<li class="empty">這個時段沒有符合條件的節目。試試把「最低星數」調低，或換個時間。</li>`;
      return;
    }
    list.innerHTML = live.slice(0, 60).map(({ row, sc }) => {
      const e = this.entry(row);
      return `<li class="sw-item">
        <span class="sw-freq">${row[0]}<small>kHz・${bandOf(row[0])}</small></span>
        <div class="sw-main">
          <b>${esc(e.name)}</b>
          <small>${esc(e.sw.lang)}・對${esc(e.sw.target)}・發射地 ${esc(e.sw.tx)}・台灣時間 ${twTime(row[1])}–${twTime(row[2])}</small>
        </div>
        <span class="sw-stars" title="台灣可收指數 ${sc.toFixed(1)}">${stars(sc)}${this.logBadge(row)}</span>
        <span class="sw-act">${this.rowActions(row)}</span>
      </li>`;
    }).join("");
    this.bindListen(list);
    // 收音機轉台用：目前可收清單
    this.dialList = live.slice(0, 80).map(({ row }) => this.entry(row));
  }

  renderMap(live) {
    if (typeof L === "undefined") return;
    if (!this.map) {
      this.map = L.map(this.$(".sw-map"), { worldCopyJump: true, zoomControl: true }).setView([20, 110], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 8, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
      this.mapLayer = L.layerGroup().addTo(this.map);
      L.circleMarker([TW.lat, TW.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#e05a2b", fillOpacity: 1 })
        .bindTooltip("台灣（你在這裡）").addTo(this.map);
    }
    this.mapLayer.clearLayers();
    const bySite = new Map();
    for (const { row, sc } of live) {
      const site = this.data.sites[row[7]];
      if (!site || row[7] === "TWN") continue;
      const cur = bySite.get(row[7]);
      if (!cur || cur.sc < sc) bySite.set(row[7], { site, sc, n: (cur?.n || 0) + 1, best: row });
      else cur.n++;
    }
    for (const [, v] of bySite) {
      const pts = greatCircle([TW.lat, TW.lon], [v.site[0], v.site[1]], 32);
      const op = 0.25 + v.sc / 5 * 0.75;
      L.polyline(pts, { color: "#ff7a1a", weight: 1 + v.sc / 1.5, opacity: op }).addTo(this.mapLayer);
      L.circleMarker([v.site[0], v.site[1]], { radius: 4 + Math.min(6, v.n), color: "#fff", weight: 1, fillColor: "#ff7a1a", fillOpacity: op })
        .bindTooltip(`${v.site[2]}：${v.n} 個節目<br>最佳 ${v.best[0]} kHz ${esc(this.data.stations[v.best[4]])} ${stars(v.sc)}`)
        .addTo(this.mapLayer);
    }
    setTimeout(() => this.map.invalidateSize(), 50);
  }

  renderHeat(m) {
    const bands = SW_BANDS.filter(b => b.lo >= 2300 && b.hi <= 26200);
    const weekday = this.mode === "now" ? m.weekday : (() => { let w = this.pickDay; return w; })();
    const grid = bands.map(() => new Array(24).fill(0));
    const date = new Date();
    for (const row of this.data.rows) {
      if (!this.passesFilters(row, { ignoreBand: true })) continue;
      const bi = bands.findIndex(b => row[0] >= b.lo && row[0] <= b.hi);
      if (bi < 0) continue;
      for (let tw = 0; tw < 24; tw++) {
        let utc = tw - 8, wd = weekday;
        if (utc < 0) { utc += 24; wd = wd === 1 ? 7 : wd - 1; }
        if (!airsInHour(row, utc, wd)) continue;
        date.setUTCHours(utc, 30, 0, 0);
        if (score(row, this.data.sites, date) >= 2.5) grid[bi][tw]++;
      }
    }
    const max = Math.max(1, ...grid.flat());
    const curH = m.twHour;
    this.$(".sw-heat").innerHTML =
      `<thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th class="${h === curH ? "cur" : ""}">${h}</th>`).join("")}</tr></thead>
       <tbody>${bands.map((b, bi) => `<tr><th>${b.name}<small>${(b.lo / 1000).toFixed(1)}</small></th>${grid[bi].map((v, h) =>
        `<td class="${h === curH ? "cur" : ""} ${this.filters.band === b.name ? "selband" : ""}" style="--v:${v / max}" data-h="${h}" data-b="${b.name}" title="${b.name} 台灣時間 ${h}:00 — ${v} 個節目">${v || ""}</td>`).join("")}</tr>`).join("")}</tbody>`;
    this.$(".sw-heat").querySelectorAll("td").forEach(td => td.addEventListener("click", () => this.setPick(+td.dataset.h, td.dataset.b)));
  }

  renderTable(m) {
    const rows = this.data.rows.filter(r => this.passesFilters(r));
    // 完整表：依可收指數（以各節目開播時的條件估算）篩選
    const scored = rows.map(r => {
      const d = new Date(); d.setUTCHours(Math.floor(r[1] / 100), (r[1] % 100) + 20, 0, 0);
      return { r, sc: score(r, this.data.sites, d) };
    }).filter(x => x.sc + 0.5 >= this.filters.min);
    const per = 100, pages = Math.max(1, Math.ceil(scored.length / per));
    this.page = Math.min(this.page, pages - 1);
    const slice = scored.slice(this.page * per, this.page * per + per);
    this.$(".sw-table-count").textContent = `${scored.length} 筆`;
    this.$(".sw-table tbody").innerHTML = slice.map(({ r, sc }) => {
      const e = this.entry(r);
      const days = r[3] === 127 ? "每天" : [1, 2, 3, 4, 5, 6, 7].filter(d => r[3] & (1 << (d - 1))).map(d => WEEK[d]).join("");
      return `<tr>
        <td class="mono">${r[0]}</td><td>${bandOf(r[0])}</td>
        <td><b>${esc(e.name)}</b>${e.name !== e.network ? `<br><small>${esc(e.network)}</small>` : ""}</td>
        <td class="mono">${twTime(r[1])}–${twTime(r[2])}</td><td>${days}</td>
        <td>${esc(e.sw.lang)}</td><td>${esc(e.sw.target)}</td><td>${esc(e.sw.tx)}</td>
        <td class="sw-stars" title="${sc.toFixed(1)}">${stars(sc)}${this.logBadge(r)}</td>
        <td class="sw-act">${this.rowActions(r)}</td></tr>`;
    }).join("") || `<tr><td colspan="10" class="empty">沒有符合條件的排程</td></tr>`;
    this.bindListen(this.$(".sw-table tbody"));
    const pager = this.$(".sw-pager");
    pager.innerHTML = pages > 1 ? `<button class="mini" data-p="-1" ${this.page === 0 ? "disabled" : ""}>上一頁</button>
      <span>${this.page + 1} / ${pages}</span>
      <button class="mini" data-p="1" ${this.page >= pages - 1 ? "disabled" : ""}>下一頁</button>` : "";
    pager.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      this.page += +b.dataset.p; this.renderTable(this.moment());
      this.$(".sw-table-card").scrollIntoView({ behavior: "smooth" });
    }));
  }

  // 你收過這一台嗎？（來自 DX 收聽日誌）
  logBadge(row) {
    const v = this.logIndex().get(`${Math.round(row[0])}|${this.data.stations[row[4]].toLowerCase()}`);
    return v ? `<span class="log-badge" title="你的收聽日誌：${v.n} 筆，平均整體評分 O=${v.avgO.toFixed(1)}">📒${v.n}・O${v.avgO.toFixed(1)}</span>` : "";
  }

  search(q) {
    this.filters.q = q.toLowerCase(); this.filters.lang = ""; this.filters.min = 0; this.page = 0;
    const i = this.$(".sw-q"); if (i) i.value = q;
    const sel = this.$(".sw-lang"); if (sel) sel.value = "";
    const m = this.$(".sw-min"); if (m) m.value = "0";
    this.refresh();
  }

  setLang(code) {
    this.filters.lang = code; this.filters.min = 0; this.page = 0;
    const sel = this.$(".sw-lang"); if (sel) sel.value = code;
    const m = this.$(".sw-min"); if (m) m.value = "0";
    this.refresh();
  }

  renderKiwiList() {
    const list = receivers();
    const own = loadOwn();
    this.$(".sw-kiwi-list").innerHTML = `
      <p class="hint">${list.length ? "你的接收機（第一台用於 📡 按鈕）：" : "尚未加入接收機。"}</p>
      <ul class="kiwi-ul">${list.map((k, i) => `<li><a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.name)}</a>
        <small>${esc(k.url)}</small>${k.own ? `<button class="mini" data-up="${i}" ${i === 0 ? "disabled" : ""}>設為預設</button><button class="mini danger" data-rm="${esc(k.url)}">移除</button>` : `<small>（config.js）</small>`}</li>`).join("")}</ul>
      <form class="kiwi-form">
        <input name="name" placeholder="名稱，例如：台北 KiwiSDR" required>
        <input name="url" type="url" placeholder="接收機網址，例如 http://xxxx:8073" required>
        <button class="mini" type="submit">加入</button>
      </form>`;
    this.$(".kiwi-form").addEventListener("submit", e => {
      e.preventDefault();
      const f = e.target;
      saveOwn([...own.filter(k => k.url !== f.url.value), { name: f.name.value.trim(), url: f.url.value.trim() }]);
      this.renderKiwiList(); this.refresh();
    });
    this.root.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => {
      saveOwn(own.filter(k => k.url !== b.dataset.rm)); this.renderKiwiList(); this.refresh();
    }));
    this.root.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => {
      const k = list[+b.dataset.up];
      saveOwn([{ name: k.name, url: k.url }, ...own.filter(x => x.url !== k.url)]);
      this.renderKiwiList(); this.refresh();
    }));
  }

  get dialStations() { return this.dialList || []; }
}

// KiwiSDR 接收機：網頁上自己加的（存在這台裝置）＋ config.js 裡的
const OWN = "rbtw:kiwi";
const loadOwn = () => { try { return JSON.parse(localStorage.getItem(OWN)) || []; } catch { return []; } };
const saveOwn = l => { try { localStorage.setItem(OWN, JSON.stringify(l)); } catch {} };
export function receivers() {
  return [...loadOwn().map(k => ({ ...k, own: true })), ...(CONFIG.KIWISDR_RECEIVERS || [])];
}

export function kiwiUrl(base, khz) {
  return `${base.replace(/\/$/, "")}/?f=${khz}am`;
}

// 大圓航線的中間點（讓地圖上的線是真正的電波路徑）
function greatCircle([lat1, lon1], [lat2, lon2], n) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const φ1 = lat1 * rad, λ1 = lon1 * rad, φ2 = lat2 * rad, λ2 = lon2 * rad;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [[lat1, lon1]];
  const pts = [];
  let prevLon = null;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    let lon = Math.atan2(y, x) * deg;
    if (prevLon !== null) { while (lon - prevLon > 180) lon -= 360; while (lon - prevLon < -180) lon += 360; }
    prevLon = lon;
    pts.push([Math.atan2(z, Math.sqrt(x * x + y * y)) * deg, lon]);
  }
  return pts;
}
