// =============================================================
//  收音機鬧鐘、預約錄音、睡眠定時
//  ⚠ 網頁必須「開著」才會動作（瀏覽器的限制）：
//    電腦：分頁不要關、電腦不要睡眠
//    iPhone：Safari 要停在這個網頁、螢幕不要鎖（可開「保持螢幕常亮」）
// =============================================================
import { uid } from "./db.js";
import { formatFreq } from "./data.js";

const KEY = "rbtw:schedules";
const WEEK = ["", "一", "二", "三", "四", "五", "六", "日"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };

export class Scheduler {
  constructor(root, { getStations, onAlarm, onRecord, onSleepTick, onSleepEnd }) {
    this.root = root;
    this.getStations = getStations;
    this.onAlarm = onAlarm;         // (item, station) => void
    this.onRecord = onRecord;       // (item, station) => Promise<{ok, msg}>
    this.onSleepTick = onSleepTick; // (secondsLeft) => void
    this.onSleepEnd = onSleepEnd;
    this.items = load();
    this.sleepUntil = 0;
    this.wakeLock = null;
    this.keepAwake = localStorage.getItem("rbtw:keepAwake") === "1";
    this.render();
    setInterval(() => this.tick(), 5000);
    setInterval(() => this.sleepTick(), 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.updateWakeLock(); });
    this.updateWakeLock();
  }

  // ---------- 睡眠定時 ----------
  setSleep(minutes) {
    this.sleepUntil = minutes ? Date.now() + minutes * 60000 : 0;
    this.sleepFading = false;
    this.sleepTick();
  }
  get sleepLeft() { return this.sleepUntil ? Math.max(0, Math.round((this.sleepUntil - Date.now()) / 1000)) : 0; }
  sleepTick() {
    if (!this.sleepUntil) return;
    const left = this.sleepLeft;
    this.onSleepTick(left);
    if (left <= 0) { this.sleepUntil = 0; this.onSleepEnd(); }
  }

  // ---------- 排程觸發 ----------
  tick() {
    const now = new Date();
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const wd = ((now.getDay() + 6) % 7) + 1;
    let changed = false;
    for (const it of this.items) {
      if (!it.enabled || it.time !== hm) continue;
      if (it.days.length && !it.days.includes(wd)) continue;
      const key = `${today}T${hm}`;
      if (it.lastFired === key) continue;
      it.lastFired = key; changed = true;
      if (!it.days.length) it.enabled = false; // 只響一次
      this.fire(it);
    }
    if (changed) { save(this.items); this.renderList(); }
  }

  async fire(it) {
    const st = this.getStations().find(s => s.id === it.stationId);
    if (it.type === "alarm") {
      this.onAlarm(it, st);
      it.lastResult = `${new Date().toLocaleString("zh-TW", { hour12: false })} 已響鈴`;
    } else {
      const res = await this.onRecord(it, st);
      it.lastResult = `${new Date().toLocaleString("zh-TW", { hour12: false })} ${res.msg}`;
    }
    save(this.items); this.renderList();
  }

  // ---------- 螢幕常亮 ----------
  async updateWakeLock() {
    const need = this.keepAwake && this.items.some(i => i.enabled);
    try {
      if (need && !this.wakeLock && "wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => { this.wakeLock = null; });
      } else if (!need && this.wakeLock) { await this.wakeLock.release(); this.wakeLock = null; }
    } catch (e) { console.warn("螢幕常亮無法啟用", e); }
    const st = this.root.querySelector(".tm-wake-state");
    if (st) st.textContent = !("wakeLock" in navigator) ? "（此瀏覽器不支援）" : this.wakeLock ? "（已啟用）" : "";
  }

  // ---------- 介面 ----------
  stationOptions(selected) {
    const groups = {};
    for (const s of this.getStations().filter(s => s.band !== "SW")) (groups[s.region || "其他"] ||= []).push(s);
    return Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list
      .sort((a, b) => a.band.localeCompare(b.band) || a.freq - b.freq)
      .map(s => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${s.band} ${esc(formatFreq(s))}　${esc(s.name)}</option>`).join("")}</optgroup>`).join("");
  }

  render() {
    this.root.innerHTML = `
      <h2 class="sec-title">⏰ 收音機鬧鐘・預約錄音</h2>
      <p class="hint">到了設定的時間，收音機會自動開機播放指定電台（鬧鐘會由小聲慢慢變大聲），或自動錄成 MP3。
      <b>這個網頁必須開著才會動作</b>：電腦請不要關分頁、不要進入睡眠；iPhone 請停在這個網頁並開啟下方「保持螢幕常亮」。</p>
      <form class="tm-form">
        <div class="seg tm-type" role="radiogroup">
          <button type="button" data-type="alarm" aria-pressed="true">⏰ 鬧鐘</button>
          <button type="button" data-type="record" aria-pressed="false">● 預約錄音</button>
        </div>
        <label>時間 <input type="time" name="time" required value="07:00"></label>
        <label class="tm-station">電台 <select name="station"></select></label>
        <fieldset class="tm-days"><legend>重複</legend>
          ${[1, 2, 3, 4, 5, 6, 7].map(d => `<label><input type="checkbox" name="d" value="${d}" ${d <= 5 ? "checked" : ""}>${WEEK[d]}</label>`).join("")}
          <span class="hint">都不勾＝只一次</span>
        </fieldset>
        <label class="tm-alarm-only">淡入 <select name="fade"><option value="0">不淡入</option><option value="30">30 秒</option><option value="60" selected>1 分鐘</option><option value="180">3 分鐘</option></select></label>
        <label class="tm-record-only" hidden>錄音長度 <select name="dur">${[5, 10, 15, 30, 60, 90, 120].map(m => `<option value="${m}" ${m === 30 ? "selected" : ""}>${m} 分鐘</option>`).join("")}</select></label>
        <label class="tm-label">名稱 <input name="label" placeholder="例如：起床聽 ICRT" maxlength="30"></label>
        <button class="btn-primary" type="submit">新增</button>
      </form>
      <label class="tm-wake"><input type="checkbox" ${this.keepAwake ? "checked" : ""}> 有開啟的排程時，保持螢幕常亮 <span class="tm-wake-state"></span></label>
      <ul class="tm-list"></ul>`;
    const f = this.root.querySelector(".tm-form");
    f.station.innerHTML = this.stationOptions();
    let type = "alarm";
    this.root.querySelectorAll(".tm-type button").forEach(b => b.addEventListener("click", () => {
      type = b.dataset.type;
      this.root.querySelectorAll(".tm-type button").forEach(x => x.setAttribute("aria-pressed", x === b));
      this.root.querySelectorAll(".tm-alarm-only").forEach(x => x.hidden = type !== "alarm");
      this.root.querySelectorAll(".tm-record-only").forEach(x => x.hidden = type !== "record");
    }));
    f.addEventListener("submit", e => {
      e.preventDefault();
      const days = [...f.querySelectorAll("input[name=d]:checked")].map(i => +i.value);
      this.items.push({
        id: uid(), type, time: f.time.value, days, stationId: f.station.value,
        fade: +f.fade.value, duration: +f.dur.value, label: f.label.value.trim(), enabled: true,
      });
      save(this.items); this.renderList(); this.updateWakeLock();
      f.label.value = "";
    });
    this.root.querySelector(".tm-wake input").addEventListener("change", e => {
      this.keepAwake = e.target.checked;
      localStorage.setItem("rbtw:keepAwake", this.keepAwake ? "1" : "0");
      this.updateWakeLock();
    });
    this.renderList();
  }

  refreshStations() {
    const sel = this.root.querySelector(".tm-form select[name=station]");
    if (sel) sel.innerHTML = this.stationOptions(sel.value);
    this.renderList();
  }

  renderList() {
    const ul = this.root.querySelector(".tm-list");
    if (!ul) return;
    if (!this.items.length) { ul.innerHTML = `<li class="empty">還沒有鬧鐘或預約錄音</li>`; return; }
    const stations = this.getStations();
    ul.innerHTML = this.items.slice().sort((a, b) => a.time.localeCompare(b.time)).map(it => {
      const st = stations.find(s => s.id === it.stationId);
      const days = it.days.length === 7 ? "每天" : it.days.length ? "週" + it.days.map(d => WEEK[d]).join("、") : "一次";
      return `<li class="tm-item ${it.enabled ? "" : "off"}" data-id="${esc(it.id)}">
        <label class="switch" title="開／關"><input type="checkbox" ${it.enabled ? "checked" : ""}><span></span></label>
        <div class="tm-time">${esc(it.time)}</div>
        <div class="tm-main">
          <b>${it.type === "alarm" ? "⏰" : "●"} ${esc(it.label || (it.type === "alarm" ? "鬧鐘" : "預約錄音"))}</b>
          <small>${days}・${st ? `${st.band} ${esc(formatFreq(st))} ${esc(st.name)}` : "（電台已不存在）"}${it.type === "record" ? `・錄 ${it.duration} 分鐘` : it.fade ? `・淡入 ${it.fade} 秒` : ""}</small>
          ${it.lastResult ? `<small class="tm-last">上次：${esc(it.lastResult)}</small>` : ""}
        </div>
        <button class="mini" data-test title="立刻試一次">試聽</button>
        <button class="mini danger" data-del>刪除</button>
      </li>`;
    }).join("");
    ul.querySelectorAll(".tm-item").forEach(li => {
      const it = this.items.find(i => i.id === li.dataset.id);
      li.querySelector("input").addEventListener("change", e => {
        it.enabled = e.target.checked; save(this.items); this.renderList(); this.updateWakeLock();
      });
      li.querySelector("[data-del]").addEventListener("click", () => {
        this.items = this.items.filter(i => i !== it); save(this.items); this.renderList(); this.updateWakeLock();
      });
      li.querySelector("[data-test]").addEventListener("click", () => {
        const st = this.getStations().find(s => s.id === it.stationId);
        if (it.type === "alarm") this.onAlarm({ ...it, test: true }, st);
        else this.onRecord({ ...it, duration: 0.25, test: true }, st);
      });
    });
  }
}
