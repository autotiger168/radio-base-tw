// =============================================================
//  DX 收聽日誌（SINPO）＋ QSL 卡收藏牆
// =============================================================
import { db, uid, downloadBlob, blobToDataURL, dataURLToBlob } from "./db.js";
import { parseCSV } from "./data.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const SINPO = {
  S: ["訊號強度", "1 幾乎聽不到", "2 微弱", "3 普通", "4 良好", "5 極強"],
  I: ["干擾（鄰台）", "1 極嚴重", "2 嚴重", "3 中等", "4 輕微", "5 無"],
  N: ["雜訊", "1 極嚴重", "2 嚴重", "3 中等", "4 輕微", "5 無"],
  P: ["傳播衰落", "1 極嚴重", "2 嚴重", "3 中等", "4 輕微", "5 無"],
  O: ["整體評分", "1 無法收聽", "2 很差", "3 尚可", "4 良好", "5 極佳"],
};
const SOURCES = ["實機收音機", "KiwiSDR／WebSDR", "網路串流"];
const QSL_STATES = ["", "已寄出報告", "已收到 QSL"];
const PREF = "rbtw:dxdefaults";

const twDate = iso => new Date(iso).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const utcHM = iso => new Date(iso).toISOString().slice(11, 16);
const freqText = l => l.band === "FM" ? `${(+l.freq).toFixed(1)} MHz` : `${Math.round(l.freq)} kHz`;

export class DXLog {
  constructor(root, { getCurrent, onChange, toast }) {
    this.root = root;
    this.getCurrent = getCurrent;   // 目前收音機上的電台
    this.onChange = onChange || (() => {});
    this.toast = toast;
    this.logs = []; this.qsls = [];
    this.view = "log";
    this.filter = { q: "", band: "" };
    this.render();
    this.reload();
  }

  async reload() {
    this.logs = (await db.all("logs")).sort((a, b) => b.utc.localeCompare(a.utc));
    this.qsls = (await db.all("qsl")).sort((a, b) => (b.received || "").localeCompare(a.received || ""));
    this.renderStats(); this.renderList(); this.renderQSL(); this.fillLogSelect();
    this.onChange();
  }

  // 給短波頁用：同頻率同電台的紀錄摘要
  index() {
    const m = new Map();
    for (const l of this.logs) {
      const k = `${Math.round(l.freq)}|${(l.network || l.station || "").toLowerCase()}`;
      const v = m.get(k) || { n: 0, sumO: 0 };
      v.n++; v.sumO += +l.O || 0; m.set(k, v);
    }
    for (const v of m.values()) v.avgO = v.sumO / v.n;
    return m;
  }

  $(s) { return this.root.querySelector(s); }

  render() {
    const d = JSON.parse(localStorage.getItem(PREF) || "{}");
    this.root.innerHTML = `
      <div class="card dx-head">
        <div>
          <h2 class="sec-title">📒 DX 收聽日誌</h2>
          <p class="hint">像老派 DXer 的收聽筆記本：記下收到的電台、頻率、時間與 SINPO 評分。紀錄存在這台裝置的瀏覽器裡，記得定期「匯出備份」。</p>
        </div>
        <div class="seg dx-view" role="tablist">
          <button data-v="log" aria-pressed="true">收聽紀錄</button>
          <button data-v="qsl" aria-pressed="false">QSL 卡收藏牆</button>
        </div>
      </div>
      <div class="dx-stats"></div>

      <div class="dx-pane" data-pane="log">
        <details class="card dx-form-card" open>
          <summary><b>＋ 新增收聽紀錄</b> <button type="button" class="mini dx-fill">帶入收音機目前電台</button></summary>
          <form class="dx-form">
            <input type="hidden" name="id">
            <input type="hidden" name="network">
            <label>收聽時間（台灣） <input type="datetime-local" name="when" required></label>
            <label>波段 <select name="band"><option>SW</option><option>AM</option><option>FM</option></select></label>
            <label>頻率 <input name="freq" type="number" step="0.1" required placeholder="kHz（FM 填 MHz）"></label>
            <label class="wide">電台 <input name="station" required placeholder="例如：NHK World Radio Japan"></label>
            <label>語言 <input name="lang" placeholder="日語"></label>
            <label>發射地 <input name="tx" placeholder="日本"></label>
            <label>收聽方式 <select name="source">${SOURCES.map(s => `<option>${s}</option>`).join("")}</select></label>
            <label>收聽地點 <input name="location" value="${esc(d.location || "")}" placeholder="例如：苗栗竹南"></label>
            <label>收音機 <input name="rig" value="${esc(d.rig || "")}" placeholder="機型"></label>
            <label>天線 <input name="antenna" value="${esc(d.antenna || "")}" placeholder="例如：拉桿天線、10m 長線"></label>
            <fieldset class="sinpo"><legend>SINPO <a href="#sinpo-help" class="hint">說明</a></legend>
              ${Object.entries(SINPO).map(([k, v]) => `<label title="${v[0]}"><b>${k}</b><select name="${k}">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${n === 3 ? "selected" : ""}>${v[n]}</option>`).join("")}</select><small>${v[0]}</small></label>`).join("")}
            </fieldset>
            <label>QSL <select name="qsl">${QSL_STATES.map(s => `<option value="${s}">${s || "（未寄）"}</option>`).join("")}</select></label>
            <label class="wide">筆記 <input name="notes" placeholder="節目內容、聽到的台呼、天氣…"></label>
            <div class="dx-form-actions">
              <button class="btn-primary" type="submit">儲存紀錄</button>
              <button class="mini" type="reset">清空</button>
            </div>
          </form>
          <p id="sinpo-help" class="hint">SINPO 是國際通用的收聽報告格式，五個字母各評 1–5 分（5 最好）：S 訊號強度、I 干擾、N 雜訊、P 傳播衰落、O 整體。寄收聽報告給電台時附上 SINPO，常會收到 QSL 確認卡。</p>
        </details>

        <div class="card dx-list-card">
          <div class="dx-tools">
            <input class="dx-q" type="search" placeholder="搜尋電台、頻率、筆記…" aria-label="搜尋紀錄">
            <select class="dx-band"><option value="">全部波段</option><option>SW</option><option>AM</option><option>FM</option></select>
            <span class="dx-spacer"></span>
            <button class="mini dx-export-csv">匯出 CSV</button>
            <label class="mini file-btn">匯入 CSV<input type="file" accept=".csv,text/csv" class="dx-import-csv" hidden></label>
          </div>
          <div class="dx-table-wrap"><table class="dx-table">
            <thead><tr><th>台灣時間</th><th>UTC</th><th>頻率</th><th>電台</th><th>SINPO</th><th>方式</th><th>QSL</th><th></th></tr></thead>
            <tbody></tbody>
          </table></div>
        </div>
      </div>

      <div class="dx-pane" data-pane="qsl" hidden>
        <details class="card dx-form-card">
          <summary><b>＋ 新增 QSL 卡</b></summary>
          <form class="qsl-form">
            <label class="wide">電台 <input name="station" required placeholder="寄卡的電台"></label>
            <label>收到日期 <input type="date" name="received" required></label>
            <label>對應的收聽紀錄 <select name="logId"><option value="">（不連結）</option></select></label>
            <label>正面照片 <input type="file" name="front" accept="image/*" required></label>
            <label>背面照片（選填） <input type="file" name="back" accept="image/*"></label>
            <label class="wide">備註 <input name="notes" placeholder="寄報告日期、回卡等了多久…"></label>
            <div class="dx-form-actions"><button class="btn-primary" type="submit">加入收藏牆</button></div>
          </form>
        </details>
        <div class="qsl-wall"></div>
      </div>

      <div class="card dx-backup">
        <b>備份與還原</b>
        <span class="hint">把日誌、QSL 卡、鬧鐘、預設台、KiwiSDR 接收機打包成一個檔案（錄音檔不含在內，請在錄音室個別下載）。換手機時在新裝置按「還原」。</span>
        <div class="dx-backup-btns">
          <button class="mini dx-backup-btn">⬇ 匯出完整備份</button>
          <label class="mini file-btn">⬆ 從備份還原<input type="file" accept=".json,application/json" class="dx-restore" hidden></label>
        </div>
      </div>
      <div class="lightbox" hidden><div class="lb-inner"><img alt=""><div class="lb-bar"><span class="lb-cap"></span><button class="mini lb-flip">翻面</button><button class="mini danger lb-del">刪除</button><button class="mini lb-close">關閉</button></div></div></div>`;

    this.root.querySelectorAll(".dx-view button").forEach(b => b.addEventListener("click", () => {
      this.view = b.dataset.v;
      this.root.querySelectorAll(".dx-view button").forEach(x => x.setAttribute("aria-pressed", x === b));
      this.root.querySelectorAll(".dx-pane").forEach(p => p.hidden = p.dataset.pane !== this.view);
    }));
    const f = this.$(".dx-form");
    this.resetForm();
    f.addEventListener("reset", () => setTimeout(() => this.resetForm(), 0));
    this.$(".dx-fill").addEventListener("click", e => { e.preventDefault(); this.prefill(this.getCurrent()); });
    f.addEventListener("submit", e => { e.preventDefault(); this.saveLog(); });
    this.$(".dx-q").addEventListener("input", e => { this.filter.q = e.target.value.trim().toLowerCase(); this.renderList(); });
    this.$(".dx-band").addEventListener("change", e => { this.filter.band = e.target.value; this.renderList(); });
    this.$(".dx-export-csv").addEventListener("click", () => this.exportCSV());
    this.$(".dx-import-csv").addEventListener("change", e => this.importCSV(e.target.files[0]));
    this.$(".qsl-form").addEventListener("submit", e => { e.preventDefault(); this.saveQSL(); });
    this.$(".qsl-form [name=received]").value = new Date().toISOString().slice(0, 10);
    this.$(".dx-backup-btn").addEventListener("click", () => this.backup());
    this.$(".dx-restore").addEventListener("change", e => this.restore(e.target.files[0]));
    this.$(".lb-close").addEventListener("click", () => this.$(".lightbox").hidden = true);
    this.$(".lightbox").addEventListener("click", e => { if (e.target.classList.contains("lightbox")) this.$(".lightbox").hidden = true; });
  }

  resetForm() {
    const f = this.$(".dx-form");
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    f.when.value = now.toISOString().slice(0, 16);
    f.id.value = ""; f.network.value = "";
    this.$(".dx-form .btn-primary").textContent = "儲存紀錄";
  }

  // 從收音機目前的電台帶入
  prefill(st) {
    if (!st) { this.toast("收音機目前沒有選台"); return; }
    const f = this.$(".dx-form");
    this.resetForm();
    f.band.value = st.band;
    f.freq.value = st.band === "FM" ? (+st.freq).toFixed(1) : Math.round(st.freq);
    f.station.value = st.name;
    f.network.value = st.network || st.name;
    f.lang.value = st.sw?.lang || st.genre || "";
    f.tx.value = st.sw?.tx || st.county || "";
    f.source.value = "網路串流";
    f.dist = st.sw?.row?.[8];
    this.$(".dx-form-card").open = true;
    this.root.querySelector(`.dx-view button[data-v=log]`).click();
    f.station.focus();
  }

  async saveLog() {
    const f = this.$(".dx-form");
    const get = n => f[n].value.trim();
    const rec = {
      id: get("id") || uid(),
      utc: new Date(get("when")).toISOString(),
      band: get("band"), freq: +get("freq"), station: get("station"), network: get("network") || get("station"),
      lang: get("lang"), tx: get("tx"), source: get("source"), location: get("location"), rig: get("rig"), antenna: get("antenna"),
      S: +f.S.value, I: +f.I.value, N: +f.N.value, P: +f.P.value, O: +f.O.value,
      qsl: f.qsl.value, notes: get("notes"), dist: f.dist ?? null,
    };
    localStorage.setItem(PREF, JSON.stringify({ location: rec.location, rig: rec.rig, antenna: rec.antenna }));
    await db.put("logs", rec);
    this.toast(get("id") ? "已更新紀錄" : "已加入收聽日誌");
    f.station.value = ""; f.notes.value = ""; f.lang.value = ""; f.tx.value = ""; f.freq.value = ""; f.dist = null;
    this.resetForm();
    this.reload();
  }

  edit(id) {
    const l = this.logs.find(x => x.id === id);
    if (!l) return;
    const f = this.$(".dx-form");
    const local = new Date(new Date(l.utc).getTime() - new Date().getTimezoneOffset() * 60000);
    f.id.value = l.id; f.when.value = local.toISOString().slice(0, 16);
    ["band", "freq", "station", "network", "lang", "tx", "source", "location", "rig", "antenna", "qsl", "notes", "S", "I", "N", "P", "O"]
      .forEach(k => { if (f[k]) f[k].value = l[k] ?? ""; });
    f.dist = l.dist;
    this.$(".dx-form .btn-primary").textContent = "更新紀錄";
    this.$(".dx-form-card").open = true;
    this.$(".dx-form-card").scrollIntoView({ behavior: "smooth" });
  }

  renderStats() {
    const st = new Set(this.logs.map(l => l.network || l.station)).size;
    const tx = new Set(this.logs.map(l => l.tx).filter(Boolean)).size;
    const far = Math.max(0, ...this.logs.map(l => +l.dist || 0));
    const month = new Date().toISOString().slice(0, 7);
    const mo = this.logs.filter(l => l.utc.startsWith(month)).length;
    const got = this.qsls.length;
    this.$(".dx-stats").innerHTML = [
      ["收聽紀錄", this.logs.length], ["電台", st], ["發射地", tx], ["本月", mo],
      ["最遠", far ? `${far.toLocaleString()} km` : "—"], ["QSL 卡", got],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
  }

  renderList() {
    const q = this.filter.q, b = this.filter.band;
    const rows = this.logs.filter(l => (!b || l.band === b) &&
      (!q || [l.station, l.network, l.freq, l.notes, l.lang, l.tx].join(" ").toLowerCase().includes(q)));
    const tb = this.$(".dx-table tbody");
    tb.innerHTML = rows.map(l => `<tr data-id="${esc(l.id)}">
      <td class="mono">${esc(twDate(l.utc))}</td><td class="mono">${utcHM(l.utc)}</td>
      <td class="mono">${l.band} ${esc(freqText(l))}</td>
      <td><b>${esc(l.station)}</b>${l.notes ? `<br><small>${esc(l.notes)}</small>` : ""}</td>
      <td class="mono sinpo-cell" title="S${l.S} I${l.I} N${l.N} P${l.P} O${l.O}">${l.S}${l.I}${l.N}${l.P}<b class="o${l.O}">${l.O}</b></td>
      <td>${esc(l.source)}</td><td>${esc(l.qsl || "")}</td>
      <td class="nowrap"><button class="mini" data-edit>編輯</button> <button class="mini danger" data-del>刪除</button></td>
    </tr>`).join("") || `<tr><td colspan="8" class="empty">${this.logs.length ? "沒有符合的紀錄" : "還沒有紀錄。收聽時按電台資訊卡上的「📒 記錄到日誌」最快。"}</td></tr>`;
    tb.querySelectorAll("tr[data-id]").forEach(tr => {
      tr.querySelector("[data-edit]").addEventListener("click", () => this.edit(tr.dataset.id));
      tr.querySelector("[data-del]").addEventListener("click", async () => {
        if (!confirm("確定刪除這筆紀錄？")) return;
        await db.remove("logs", tr.dataset.id); this.reload();
      });
    });
  }

  // ---------- CSV ----------
  exportCSV() {
    const cols = [["utc", "UTC時間"], ["band", "波段"], ["freq", "頻率"], ["station", "電台"], ["lang", "語言"], ["tx", "發射地"],
      ["S", "S"], ["I", "I"], ["N", "N"], ["P", "P"], ["O", "O"], ["source", "收聽方式"], ["location", "收聽地點"],
      ["rig", "收音機"], ["antenna", "天線"], ["qsl", "QSL"], ["notes", "筆記"]];
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + cols.map(c => c[1]).join(",") + "\n" +
      this.logs.map(l => cols.map(c => q(l[c[0]])).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), `DX收聽日誌_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async importCSV(file) {
    if (!file) return;
    const rows = parseCSV(await file.text());
    const head = rows[0].map(h => h.trim());
    const map = { "UTC時間": "utc", "波段": "band", "頻率": "freq", "電台": "station", "語言": "lang", "發射地": "tx",
      S: "S", I: "I", N: "N", P: "P", O: "O", "收聽方式": "source", "收聽地點": "location", "收音機": "rig", "天線": "antenna", QSL: "qsl", "筆記": "notes" };
    let n = 0;
    for (const r of rows.slice(1)) {
      const l = { id: uid() };
      head.forEach((h, i) => { if (map[h]) l[map[h]] = r[i]; });
      if (!l.station || !l.utc || isNaN(new Date(l.utc))) continue;
      l.utc = new Date(l.utc).toISOString(); l.freq = +l.freq;
      ["S", "I", "N", "P", "O"].forEach(k => l[k] = +l[k] || 3);
      await db.put("logs", l); n++;
    }
    this.toast(`已匯入 ${n} 筆紀錄`);
    this.reload();
  }

  // ---------- QSL ----------
  fillLogSelect() {
    const sel = this.$(".qsl-form [name=logId]");
    if (!sel) return;
    sel.innerHTML = `<option value="">（不連結）</option>` + this.logs.slice(0, 300).map(l =>
      `<option value="${esc(l.id)}">${esc(twDate(l.utc).slice(0, 10))} ${l.band} ${esc(freqText(l))} ${esc(l.station)}</option>`).join("");
  }

  async shrink(file) {
    if (!file) return null;
    const img = await createImageBitmap(file).catch(() => null);
    if (!img) return file;
    const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b || file), "image/jpeg", 0.85));
  }

  async saveQSL() {
    const f = this.$(".qsl-form");
    const rec = {
      id: uid(), station: f.station.value.trim(), received: f.received.value, logId: f.logId.value,
      notes: f.notes.value.trim(), front: await this.shrink(f.front.files[0]), back: await this.shrink(f.back.files[0]),
    };
    await db.put("qsl", rec);
    if (rec.logId) {
      const l = this.logs.find(x => x.id === rec.logId);
      if (l) { l.qsl = "已收到 QSL"; await db.put("logs", l); }
    }
    f.reset(); f.received.value = new Date().toISOString().slice(0, 10);
    this.toast("QSL 卡已加入收藏牆");
    this.reload();
  }

  renderQSL() {
    const wall = this.$(".qsl-wall");
    (this._urls || []).forEach(u => URL.revokeObjectURL(u));
    this._urls = [];
    if (!this.qsls.length) {
      wall.innerHTML = `<p class="empty card">還沒有 QSL 卡。寄出收聽報告、收到電台回卡後，拍照放上來收藏。</p>`;
      return;
    }
    wall.innerHTML = this.qsls.map(q => {
      const u = q.front ? URL.createObjectURL(q.front) : ""; if (u) this._urls.push(u);
      return `<figure class="qsl-card" data-id="${esc(q.id)}" tabindex="0">
        ${u ? `<img src="${u}" alt="${esc(q.station)} QSL 卡" loading="lazy">` : ""}
        <figcaption><b>${esc(q.station)}</b><small>${esc(q.received)}${q.back ? "・有背面" : ""}</small></figcaption>
      </figure>`;
    }).join("");
    wall.querySelectorAll(".qsl-card").forEach(card => {
      const open = () => this.openQSL(card.dataset.id);
      card.addEventListener("click", open);
      card.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
    });
  }

  openQSL(id) {
    const q = this.qsls.find(x => x.id === id);
    if (!q) return;
    const lb = this.$(".lightbox"), img = lb.querySelector("img");
    let side = "front";
    const show = () => {
      const b = q[side] || q.front;
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = b ? URL.createObjectURL(b) : "";
      lb.querySelector(".lb-cap").textContent = `${q.station}・${q.received}${q.notes ? "・" + q.notes : ""}${q.back ? `（${side === "front" ? "正面" : "背面"}）` : ""}`;
    };
    lb.querySelector(".lb-flip").hidden = !q.back;
    lb.querySelector(".lb-flip").onclick = () => { side = side === "front" ? "back" : "front"; show(); };
    lb.querySelector(".lb-del").onclick = async () => {
      if (!confirm("確定刪除這張 QSL 卡？")) return;
      await db.remove("qsl", q.id); lb.hidden = true; this.reload();
    };
    show(); lb.hidden = false;
  }

  // ---------- 完整備份 ----------
  async backup() {
    const qsl = [];
    for (const q of this.qsls) {
      qsl.push({ ...q, front: q.front ? await blobToDataURL(q.front) : null, back: q.back ? await blobToDataURL(q.back) : null });
    }
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("rbtw:") && !k.startsWith("rbtw:match:")) ls[k] = localStorage.getItem(k);
    }
    const data = { app: "radio-base-tw", version: 1, exported: new Date().toISOString(), logs: this.logs, qsl, localStorage: ls };
    downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `RadioBaseTW_備份_${new Date().toISOString().slice(0, 10)}.json`);
  }

  async restore(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "radio-base-tw") throw new Error("不是本網站的備份檔");
      if (!confirm(`還原 ${data.logs.length} 筆紀錄、${data.qsl.length} 張 QSL 卡？（同一筆資料會覆蓋）`)) return;
      for (const l of data.logs) await db.put("logs", l);
      for (const q of data.qsl) {
        await db.put("qsl", { ...q, front: q.front ? await dataURLToBlob(q.front) : null, back: q.back ? await dataURLToBlob(q.back) : null });
      }
      for (const [k, v] of Object.entries(data.localStorage || {})) localStorage.setItem(k, v);
      this.toast("還原完成，重新整理後鬧鐘與設定生效");
      this.reload();
    } catch (e) { this.toast("還原失敗：" + e.message); }
  }
}
