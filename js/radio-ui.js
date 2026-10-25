// =============================================================
//  復古收音機介面：三種機身皮膚共用同一套結構
//  vintage   — 1950s 木殼真空管機
//  shortwave — 1970–80s 銀色多波段短波機
//  modern    — 現代科技感（OLED、頻譜、機械段落聲）
// =============================================================
import { formatFreq } from "./data.js";

const BANDS = {
  FM: { min: 87.5, max: 108, major: 2, minor: 0.5, unit: "MHz", scale: "FM MHz", label: v => v.toFixed(0) },
  AM: { min: 520, max: 1620, major: 100, minor: 20, unit: "kHz", scale: "AM kHz", label: v => String(v) },
  SW: { min: 2000, max: 26000, major: 2000, minor: 500, unit: "kHz", scale: "SW MHz", label: v => String(v / 1000) },
};
const SKINS = [
  { id: "vintage", name: "1950s 真空管" },
  { id: "shortwave", name: "80s 短波機" },
  { id: "modern", name: "現代科技" },
];
const REGIONS = ["全部", "北部", "中部", "南部", "東部"];

const store = {
  get(k, d) { try { const v = localStorage.getItem("rbtw:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rbtw:" + k, JSON.stringify(v)); } catch {} },
};

export class RadioUI {
  constructor(root, engine, { getStations, onTune, onPower, onRecord, onSleep }) {
    this.onSleep = onSleep || (() => {});
    this.sleepMin = 0;
    this.sleepText = "";
    this.root = root;
    this.engine = engine;
    this.getStations = getStations;
    this.onTune = onTune;
    this.onPower = onPower;
    this.onRecord = onRecord;
    this.skin = store.get("skin", "vintage");
    this.band = store.get("band", "FM");
    this.region = store.get("region", "北部");
    this.current = null;
    this.power = false;
    this.status = "待機";
    this.sfx = store.get("sfx", true);
    this.render();
    this.bind();
    this.setBand(this.band, true);
    this.tick();
    setInterval(() => this.tick(), 1000);
    requestAnimationFrame(() => this.animate());
  }

  // ---------- 結構 ----------
  render() {
    this.root.innerHTML = `
      <div class="radio" data-skin="${this.skin}" data-power="off">
        <div class="cabinet">
          <div class="speaker" aria-hidden="true">
            <div class="grille"></div>
            <canvas class="spectrum" width="400" height="220"></canvas>
            <div class="badge">RADIO BASE</div>
          </div>
          <div class="panel">
            <div class="display" aria-live="polite">
              <div class="d-row d-top">
                <span class="d-clock">--:--:--</span>
                <span class="d-utc">UTC --:--</span>
              </div>
              <div class="d-freq"><span class="d-band">FM</span><b class="d-num">----</b><small class="d-unit">MHz</small></div>
              <div class="d-name">請按電源開機</div>
              <div class="d-row d-bottom">
                <span class="d-status">待機</span>
                <span class="d-meta"></span>
              </div>
            </div>
            <div class="dial" role="slider" aria-label="調台刻度盤" tabindex="0">
              <div class="dial-glass">
                <div class="scale"></div>
                <div class="marks"></div>
                <div class="needle"></div>
              </div>
            </div>
            <div class="meters">
              <canvas class="vu vu-l" width="200" height="90" aria-label="左聲道音量"></canvas>
              <canvas class="vu vu-r" width="200" height="90" aria-label="右聲道音量"></canvas>
            </div>
            <div class="controls">
              <div class="knob-wrap">
                <div class="knob knob-vol" tabindex="0" role="slider" aria-label="音量" aria-valuemin="0" aria-valuemax="100"><i></i></div>
                <span class="knob-label">VOLUME</span>
              </div>
              <div class="keys">
                <div class="key-row">
                  <button class="key key-power" title="電源">⏻<span>POWER</span></button>
                  <button class="key key-band" data-band="FM">FM</button>
                  <button class="key key-band" data-band="AM">AM</button>
                  <button class="key key-band" data-band="SW" title="短波：轉台會經過「短波世界」目前可收的節目">SW</button>
                  <button class="key key-rec" title="錄音 MP3">●<span>REC</span></button>
                </div>
                <div class="key-row presets">
                  ${[1, 2, 3, 4, 5, 6].map(n => `<button class="key key-preset" data-preset="${n}" title="點一下：選台／長按：存入目前電台">${n}</button>`).join("")}
                  <button class="key key-sleep" title="睡眠定時：每按一次 15→30→60→90 分鐘→關閉">⏾<span>SLEEP</span></button>
                </div>
              </div>
              <div class="knob-wrap">
                <div class="knob knob-tune" tabindex="0" role="slider" aria-label="調台"><i></i></div>
                <span class="knob-label">TUNING</span>
              </div>
            </div>
          </div>
        </div>
        <div class="radio-bar">
          <div class="skin-switch" role="tablist" aria-label="機身皮膚">
            ${SKINS.map(s => `<button role="tab" data-skin="${s.id}" aria-selected="${s.id === this.skin}">${s.name}</button>`).join("")}
          </div>
          <label class="region-pick">收聽地區
            <select>${REGIONS.map(r => `<option ${r === this.region ? "selected" : ""}>${r}</option>`).join("")}</select>
          </label>
          <label class="sfx-pick"><input type="checkbox" ${this.sfx ? "checked" : ""}> 機械音效</label>
        </div>
      </div>`;
    const $ = s => this.root.querySelector(s);
    this.el = {
      radio: $(".radio"), clock: $(".d-clock"), utc: $(".d-utc"), bandLbl: $(".d-band"),
      num: $(".d-num"), unit: $(".d-unit"), name: $(".d-name"), status: $(".d-status"),
      meta: $(".d-meta"), scale: $(".scale"), marks: $(".marks"), needle: $(".needle"),
      dial: $(".dial"), vuL: $(".vu-l"), vuR: $(".vu-r"), spectrum: $(".spectrum"),
      vol: $(".knob-vol"), tune: $(".knob-tune"), power: $(".key-power"), rec: $(".key-rec"),
    };
  }

  bind() {
    const r = this.root;
    r.querySelectorAll(".skin-switch button").forEach(b => b.addEventListener("click", () => this.setSkin(b.dataset.skin)));
    r.querySelectorAll(".key-band").forEach(b => b.addEventListener("click", () => { this.fx("button"); this.setBand(b.dataset.band); }));
    r.querySelector(".region-pick select").addEventListener("change", e => {
      this.region = e.target.value; store.set("region", this.region); this.drawMarks();
    });
    r.querySelector(".sfx-pick input").addEventListener("change", e => { this.sfx = e.target.checked; store.set("sfx", this.sfx); });
    this.el.power.addEventListener("click", () => { this.fx("button"); this.togglePower(); });
    this.el.rec.addEventListener("click", () => { this.fx("button"); this.onRecord(); });
    const steps = [0, 15, 30, 60, 90];
    this.root.querySelector(".key-sleep").addEventListener("click", () => {
      this.fx("button");
      if (!this.power) { this.flash("請先開機"); return; }
      this.sleepMin = steps[(steps.indexOf(this.sleepMin) + 1) % steps.length];
      this.root.querySelector(".key-sleep").classList.toggle("on", this.sleepMin > 0);
      this.flash(this.sleepMin ? `${this.sleepMin} 分鐘後關機` : "睡眠定時已取消");
      this.onSleep(this.sleepMin);
    });

    // 預設台：點選選台、長按儲存
    r.querySelectorAll(".key-preset").forEach(b => {
      let timer = null, long = false;
      const n = +b.dataset.preset;
      b.addEventListener("pointerdown", () => {
        long = false;
        timer = setTimeout(() => { long = true; this.savePreset(n); }, 650);
      });
      const cancel = () => clearTimeout(timer);
      b.addEventListener("pointerup", cancel);
      b.addEventListener("pointerleave", cancel);
      b.addEventListener("click", () => { if (!long) { this.fx("button"); this.recallPreset(n); } });
    });

    // 音量旋鈕
    this.volAngle = this.engine.volume * 270 - 135;
    this.setKnob(this.el.vol, this.volAngle);
    this.knobDrag(this.el.vol, delta => {
      this.volAngle = Math.max(-135, Math.min(135, this.volAngle + delta));
      this.setKnob(this.el.vol, this.volAngle);
      const v = (this.volAngle + 135) / 270;
      this.engine.setVolume(v);
      this.el.vol.setAttribute("aria-valuenow", Math.round(v * 100));
    });

    // 調台旋鈕：每轉 28° 跳一台
    this.tuneAngle = 0; let acc = 0;
    this.knobDrag(this.el.tune, delta => {
      this.tuneAngle += delta; acc += delta;
      this.setKnob(this.el.tune, this.tuneAngle);
      if (Math.abs(acc) >= 10) { this.fx("detent"); }
      while (Math.abs(acc) >= 28) {
        this.step(acc > 0 ? 1 : -1);
        acc -= Math.sign(acc) * 28;
      }
    });
    this.el.tune.addEventListener("keydown", e => {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { this.step(1); e.preventDefault(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { this.step(-1); e.preventDefault(); }
    });
    this.el.dial.addEventListener("keydown", e => {
      if (e.key === "ArrowRight") this.step(1);
      if (e.key === "ArrowLeft") this.step(-1);
    });
    // 點刻度盤：跳到最接近的電台
    this.el.dial.addEventListener("click", e => {
      const rect = this.el.marks.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const b = BANDS[this.band];
      const f = b.min + ratio * (b.max - b.min);
      const list = this.dialStations();
      if (!list.length) return;
      const near = list.reduce((a, s) => Math.abs(s.freq - f) < Math.abs(a.freq - f) ? s : a);
      this.tune(near);
    });
  }

  knobDrag(knob, onDelta) {
    let last = null;
    const center = () => { const r = knob.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const ang = e => { const [cx, cy] = center(); return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI; };
    knob.addEventListener("pointerdown", e => { last = ang(e); knob.setPointerCapture(e.pointerId); knob.classList.add("turning"); });
    knob.addEventListener("pointermove", e => {
      if (last === null) return;
      const a = ang(e); let d = a - last;
      if (d > 180) d -= 360; if (d < -180) d += 360;
      last = a; onDelta(d);
    });
    const end = () => { last = null; knob.classList.remove("turning"); };
    knob.addEventListener("pointerup", end);
    knob.addEventListener("pointercancel", end);
    knob.addEventListener("wheel", e => { e.preventDefault(); onDelta(e.deltaY > 0 ? -14 : 14); }, { passive: false });
    knob.addEventListener("keydown", e => {
      if (knob === this.el.vol) {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") { onDelta(13.5); e.preventDefault(); }
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") { onDelta(-13.5); e.preventDefault(); }
      }
    });
  }

  setKnob(knob, angle) { knob.style.setProperty("--a", angle + "deg"); }

  fx(kind) { if (this.sfx && this.engine.ctx) this.engine.click(kind); }

  // ---------- 狀態 ----------
  setSkin(id) {
    this.skin = id; store.set("skin", id);
    this.el.radio.dataset.skin = id;
    this.root.querySelectorAll(".skin-switch button").forEach(b => b.setAttribute("aria-selected", b.dataset.skin === id));
    this.fx("button");
  }

  setBand(band, silent = false) {
    this.band = band; store.set("band", band);
    this.root.querySelectorAll(".key-band").forEach(b => b.classList.toggle("on", b.dataset.band === band));
    this.drawScale(); this.drawMarks();
    if (!silent && this.power) {
      const list = this.dialStations();
      if (list.length && (!this.current || this.current.band !== band)) this.tune(list[0]);
    }
    if (!this.current) this.showIdle();
  }

  dialStations() {
    // 同一聯播網、同一頻率在同地區的多個轉播站只保留一個（優先保留有串流的），轉旋鈕才不會一直停在同一台
    const seen = new Map();
    for (const s of this.getStations()) {
      if (s.band !== this.band) continue;
      if (this.band !== "SW" && this.region !== "全部" && s.region !== this.region) continue;
      const key = `${s.freq}|${s.network || s.name}`;
      const prev = seen.get(key);
      if (!prev || (!prev.stream && s.stream) || (this.current && s.id === this.current.id)) seen.set(key, s);
    }
    return [...seen.values()].sort((a, b) => a.freq - b.freq);
  }

  step(dir) {
    const list = this.dialStations();
    if (!list.length) return;
    let i = this.current ? list.findIndex(s => s.id === this.current.id) : -1;
    if (i === -1) {
      const f = this.current ? this.current.freq : BANDS[this.band].min;
      i = dir > 0 ? list.findIndex(s => s.freq > f) - 1 : list.findIndex(s => s.freq >= f);
      if (i < -1) i = list.length - 1;
    }
    const next = list[(i + dir + list.length) % list.length];
    this.tune(next);
  }

  tune(station) {
    if (!station) return;
    if (station.band !== this.band) this.setBand(station.band, true);
    this.current = station;
    this.updateDisplay();
    if (!this.power) this.togglePower(true);
    if (this.sfx && this.engine.ctx) this.engine.tuneNoise(this.skin === "modern" ? 300 : 650, this.skin);
    this.onTune(station);
  }

  togglePower(forceOn = false) {
    this.power = forceOn ? true : !this.power;
    this.el.radio.dataset.power = this.power ? "on" : "off";
    this.engine.ensureContext();
    if (this.power) {
      if (this.skin === "vintage") this.el.radio.classList.add("warming");
      setTimeout(() => this.el.radio.classList.remove("warming"), 2200);
      if (!forceOn) {
        const st = this.current || this.presetStation(1) || this.dialStations()[0];
        if (st) this.tune(st);
      }
    } else {
      this.setStatus("待機");
    }
    this.onPower(this.power);
  }

  presetStation(n) {
    const saved = store.get("presets", {});
    const all = this.getStations();
    if (saved[n]) return all.find(s => s.id === saved[n]);
    return all.find(s => s.preset === n);
  }
  recallPreset(n) {
    const s = this.presetStation(n);
    if (s) this.tune(s); else this.flash(`預設台 ${n} 尚未設定（長按可存入）`);
  }
  savePreset(n) {
    if (!this.current) { this.flash("請先選一個電台"); return; }
    const saved = store.get("presets", {});
    saved[n] = this.current.id; store.set("presets", saved);
    this.fx("button");
    this.flash(`已存入預設台 ${n}`);
  }

  flash(msg) {
    const prev = this.el.meta.textContent;
    this.el.meta.textContent = msg;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { this.el.meta.textContent = prev === msg ? "" : prev; }, 2200);
  }

  setSleepText(text) {
    this.sleepText = text;
    if (!text) { this.sleepMin = 0; this.root.querySelector(".key-sleep")?.classList.remove("on"); }
    this.el.status.textContent = this.status + (text ? `  ${text}` : "");
  }

  setStatus(text, meta) {
    this.status = text;
    this.el.status.textContent = text;
    if (meta !== undefined) this.el.meta.textContent = meta;
  }

  showIdle() {
    this.el.bandLbl.textContent = this.band;
    this.el.num.textContent = "----";
    this.el.unit.textContent = BANDS[this.band].unit;
  }

  updateDisplay() {
    const s = this.current;
    if (!s) return this.showIdle();
    const [num, unit] = formatFreq(s).split(" ");
    this.el.bandLbl.textContent = s.band;
    this.el.num.textContent = num;
    this.el.unit.textContent = unit;
    this.el.name.textContent = s.name;
    const b = BANDS[s.band];
    const pct = (s.freq - b.min) / (b.max - b.min) * 100;
    this.el.needle.style.left = Math.max(0, Math.min(100, pct)) + "%";
    this.el.dial.setAttribute("aria-valuetext", `${s.name} ${formatFreq(s)}`);
    this.root.querySelectorAll(".marks i").forEach(m => m.classList.toggle("on", m.dataset.id === s.id));
  }

  // ---------- 刻度盤 ----------
  drawScale() {
    const b = BANDS[this.band];
    let html = "";
    for (let v = Math.ceil(b.min / b.minor) * b.minor; v <= b.max + 1e-6; v += b.minor) {
      const pct = (v - b.min) / (b.max - b.min) * 100;
      const major = Math.abs(v / b.major - Math.round(v / b.major)) < 1e-6;
      html += `<span class="tick ${major ? "major" : ""}" style="left:${pct}%">${major ? `<em>${b.label(v)}</em>` : ""}</span>`;
    }
    html += `<span class="scale-unit">${b.scale}</span>`;
    this.el.scale.innerHTML = html;
  }

  drawMarks() {
    const b = BANDS[this.band];
    this.el.marks.innerHTML = this.dialStations().map(s => {
      const pct = (s.freq - b.min) / (b.max - b.min) * 100;
      return `<i data-id="${s.id}" style="left:${pct}%" title="${s.name} ${formatFreq(s)}"></i>`;
    }).join("");
    this.updateDisplay();
  }

  // ---------- 時鐘 ----------
  tick() {
    const now = new Date();
    const tw = now.toLocaleTimeString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" });
    const utc = now.toISOString().slice(11, 16);
    this.el.clock.textContent = tw;
    this.el.utc.textContent = `UTC ${utc}`;
    if (this.engine.recording) {
      const t = this.engine.recordSeconds;
      const mm = String(Math.floor(t / 60)).padStart(2, "0"), ss = String(t % 60).padStart(2, "0");
      this.el.status.textContent = `● REC ${mm}:${ss}`;
      this.el.radio.classList.add("recording");
    } else {
      this.el.status.textContent = this.status + (this.sleepText ? `  ${this.sleepText}` : "");
      this.el.radio.classList.remove("recording");
    }
  }

  // ---------- VU 表與頻譜 ----------
  animate() {
    const [l, r] = this.power ? this.engine.levels() : [0, 0];
    this._lv = this._lv || [0, 0];
    // 指針慣性
    this._lv[0] += (l - this._lv[0]) * 0.25;
    this._lv[1] += (r - this._lv[1]) * 0.25;
    this.drawVU(this.el.vuL, this._lv[0], "L");
    this.drawVU(this.el.vuR, this._lv[1], "R");
    if (this.skin === "modern") this.drawSpectrum();
    requestAnimationFrame(() => this.animate());
  }

  drawVU(cv, v, ch) {
    const c = cv.getContext("2d"), W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    const cs = getComputedStyle(this.el.radio);
    const ink = cs.getPropertyValue("--vu-ink").trim() || "#222";
    const face = cs.getPropertyValue("--vu-face").trim() || "#f3e6c4";
    const red = cs.getPropertyValue("--vu-red").trim() || "#c0392b";
    if (this.skin === "modern") {
      // LED 長條
      const n = 24, gap = 2, bw = (W - 20 - gap * (n - 1)) / n;
      const lit = Math.round(v * n);
      c.fillStyle = ink; c.font = "bold 12px Orbitron, sans-serif"; c.fillText(ch, 2, H / 2 + 5);
      for (let i = 0; i < n; i++) {
        c.fillStyle = i < lit ? (i > n * 0.8 ? red : face) : "rgba(255,255,255,0.07)";
        c.fillRect(16 + i * (bw + gap), H / 2 - 12, bw, 24);
      }
      return;
    }
    // 類比指針表
    c.fillStyle = face; c.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H + 30, R = H + 8;
    const a0 = -Math.PI / 2 - 0.75, a1 = -Math.PI / 2 + 0.75;
    c.lineWidth = 2; c.strokeStyle = ink;
    c.beginPath(); c.arc(cx, cy, R - 22, a0, a0 + (a1 - a0) * 0.72); c.stroke();
    c.strokeStyle = red; c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, R - 22, a0 + (a1 - a0) * 0.72, a1); c.stroke();
    c.lineWidth = 1.2; c.strokeStyle = ink;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * i / 10;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
      c.lineTo(cx + Math.cos(a) * (R - (i % 5 ? 28 : 32)), cy + Math.sin(a) * (R - (i % 5 ? 28 : 32)));
      c.stroke();
    }
    c.fillStyle = ink; c.font = "bold 13px serif"; c.fillText("VU", 8, H - 8);
    c.font = "11px serif"; c.fillText(ch, W - 16, H - 8);
    const a = a0 + (a1 - a0) * Math.min(1, v);
    c.strokeStyle = ink; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); c.stroke();
  }

  drawSpectrum() {
    const cv = this.el.spectrum, c = cv.getContext("2d"), W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    let data = this.engine.spectrum();
    if (!data && this.power && this.engine.playing) {
      // 一般播放模式：擬真頻譜
      data = new Uint8Array(256);
      const t = performance.now() / 300;
      for (let i = 0; i < 256; i++) data[i] = 140 * Math.exp(-i / 70) * (0.7 + 0.3 * Math.sin(t + i * 0.3)) + Math.random() * 30;
    }
    const n = 48;
    const cs = getComputedStyle(this.el.radio);
    const a = cs.getPropertyValue("--accent").trim() || "#5ad1ff";
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (data) {
        const idx = Math.floor(Math.pow(i / n, 1.8) * (data.length * 0.6));
        v = data[idx] / 255;
      }
      const h = Math.max(2, v * (H - 10));
      const x = i * (W / n);
      c.fillStyle = a;
      c.globalAlpha = 0.35 + v * 0.65;
      c.fillRect(x + 1, H - h, W / n - 3, h);
    }
    c.globalAlpha = 1;
  }
}
