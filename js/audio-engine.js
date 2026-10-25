// =============================================================
//  音訊引擎：播放、音量、VU/頻譜分析、音效、MP3 錄音
// =============================================================
import { CONFIG } from "./config.js";

export class AudioEngine {
  constructor() {
    this.ctx = null;
    // 兩個 audio 元素：
    //  corsEl  → 接上 Web Audio（可錄音、VU 表），需要串流允許跨網域或走中繼
    //  plainEl → 一般播放（不允許跨網域的串流用這個，無法錄音）
    this.corsEl = new Audio();
    this.corsEl.crossOrigin = "anonymous";
    this.plainEl = new Audio();
    [this.corsEl, this.plainEl].forEach(el => { el.preload = "none"; el.playsInline = true; });
    this.active = null;          // 目前使用中的元素
    this.mode = "off";           // "webaudio" | "plain" | "off"
    this.volume = 0.7;
    this.recording = null;
    this.onStateChange = () => {};
  }

  // ---------- Web Audio 圖 ----------
  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.src = ctx.createMediaElementSource(this.corsEl);
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.splitter = ctx.createChannelSplitter(2);
    this.anL = ctx.createAnalyser(); this.anL.fftSize = 1024;
    this.anR = ctx.createAnalyser(); this.anR.fftSize = 1024;
    this.anSpec = ctx.createAnalyser(); this.anSpec.fftSize = 2048; this.anSpec.smoothingTimeConstant = 0.75;
    this.src.connect(this.gain);
    this.gain.connect(ctx.destination);
    this.src.connect(this.splitter);
    this.splitter.connect(this.anL, 0);
    this.splitter.connect(this.anR, 1);
    this.src.connect(this.anSpec);
    // 音效匯流排
    this.fxGain = ctx.createGain();
    this.fxGain.gain.value = 0.5;
    this.fxGain.connect(ctx.destination);
    this.noiseBuffer = this._makeNoise();
    this._bufL = new Float32Array(this.anL.fftSize);
    this._bufR = new Float32Array(this.anR.fftSize);
    this._spec = new Uint8Array(this.anSpec.frequencyBinCount);
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- 串流網址 ----------
  proxied(url) {
    return CONFIG.PROXY_URL
      ? `${CONFIG.PROXY_URL.replace(/\/$/, "")}/?url=${encodeURIComponent(url)}`
      : url;
  }

  async play(url, meta = {}) {
    this.ensureContext();
    this.stopRecording();
    this.stop(false);
    const pageIsHttps = location.protocol === "https:";
    const isHttp = url.startsWith("http://");
    if (!CONFIG.PROXY_URL && pageIsHttps && isHttp) {
      throw new Error("HTTP_BLOCKED");
    }
    const isHls = /\.m3u8(\?|$)/i.test(url);
    const nativeHls = !!this.corsEl.canPlayType("application/vnd.apple.mpegurl");
    // 先試 Web Audio 模式（可錄音）
    try {
      if (isHls && !nativeHls && window.Hls && Hls.isSupported()) {
        await this._playHls(this.corsEl, this.proxied(url));
      } else {
        this.corsEl.src = this.proxied(url);
        await this.corsEl.play();
      }
      this.active = this.corsEl; this.mode = "webaudio";
    } catch (e) {
      if (e.name === "NotAllowedError") throw e;
      // 串流不允許跨網域 → 退回一般播放（無法錄音）
      this._destroyHls();
      this.corsEl.removeAttribute("src"); this.corsEl.load();
      if (isHls && !nativeHls) throw new Error("HLS_CORS");
      this.plainEl.src = url;
      this.plainEl.volume = this.volume;
      await this.plainEl.play();
      this.active = this.plainEl; this.mode = "plain";
    }
    this._mediaSession(meta);
    this.onStateChange();
    return this.mode;
  }

  _playHls(el, src) {
    return new Promise((resolve, reject) => {
      const hls = new Hls({ lowLatencyMode: false });
      this.hls = hls;
      let done = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        el.play().then(() => { done = true; resolve(); }).catch(reject);
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal && !done) { done = true; reject(new Error("HLS_ERROR")); }
      });
      hls.loadSource(src);
      hls.attachMedia(el);
    });
  }

  _destroyHls() {
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
  }

  stop(notify = true) {
    this._destroyHls();
    [this.corsEl, this.plainEl].forEach(el => {
      el.pause(); el.removeAttribute("src"); el.load();
    });
    this.active = null; this.mode = "off";
    if (notify) this.onStateChange();
  }

  get playing() { return !!this.active && !this.active.paused; }
  get canRecord() { return this.mode === "webaudio"; }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    this.plainEl.volume = this.volume;
  }

  // 淡入／淡出到指定音量（鬧鐘、睡眠定時用）；不改變旋鈕設定的音量
  fade(from, to, seconds) {
    clearInterval(this._fadeT);
    const t0 = performance.now();
    const apply = v => {
      if (this.gain) this.gain.gain.setValueAtTime(Math.max(0.0001, v), this.ctx.currentTime);
      this.plainEl.volume = Math.max(0, Math.min(1, v));
    };
    apply(from);
    return new Promise(resolve => {
      this._fadeT = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
        apply(from + (to - from) * k);
        if (k >= 1) { clearInterval(this._fadeT); resolve(); }
      }, 100);
    });
  }

  // 沒有串流時的備用鬧鈴聲
  beep(seconds = 30) {
    this.ensureContext();
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < seconds * 2; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i % 4 < 2 ? 880 : 660;
      g.gain.setValueAtTime(0, t + i * 0.5);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.5 + 0.02);
      g.gain.linearRampToValueAtTime(0, t + i * 0.5 + 0.25);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + i * 0.5); o.stop(t + i * 0.5 + 0.3);
      (this._beeps ||= []).push(o);
    }
  }
  stopBeep() { (this._beeps || []).forEach(o => { try { o.stop(); } catch {} }); this._beeps = []; }

  // 真空管預熱：音量由 0 慢慢升起
  warmUp(seconds = 2.2) {
    if (!this.gain) return;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.exponentialRampToValueAtTime(Math.max(this.volume, 0.001), t + seconds);
  }

  // ---------- 音效 ----------
  // 調台雜音：skin = vintage | shortwave | modern
  tuneNoise(ms = 650, skin = "vintage") {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = skin === "modern" ? 3000 : 1800;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    const lvl = (skin === "modern" ? 0.08 : 0.22) * this.volume;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.04);
    g.gain.linearRampToValueAtTime(0, t + ms / 1000);
    n.connect(f); f.connect(g); g.connect(this.fxGain);
    n.start(t); n.stop(t + ms / 1000 + 0.05);
    // 短波機：加上外差「咻～嗶」音
    if (skin === "shortwave") {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(2400, t);
      o.frequency.exponentialRampToValueAtTime(180, t + ms / 1000);
      og.gain.setValueAtTime(0.05 * this.volume, t);
      og.gain.linearRampToValueAtTime(0, t + ms / 1000);
      o.connect(og); og.connect(this.fxGain);
      o.start(t); o.stop(t + ms / 1000 + 0.05);
    }
  }

  // 機械段落聲 / 按鍵聲
  click(kind = "detent") {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = kind === "button" ? 1500 : 3500;
    const g = ctx.createGain();
    const len = kind === "button" ? 0.035 : 0.012;
    g.gain.setValueAtTime(kind === "button" ? 0.5 : 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f); f.connect(g); g.connect(this.fxGain);
    n.start(t, Math.random()); n.stop(t + len + 0.01);
  }

  // ---------- 分析 ----------
  levels() {
    if (this.mode !== "webaudio" || !this.anL) {
      // 一般播放模式無法取得真實音量，做擬真擺動
      if (!this.playing) return [0, 0];
      const now = performance.now() / 1000;
      const b = 0.45 + 0.2 * Math.sin(now * 2.1) + 0.15 * Math.random();
      return [b * this.volume, (b + 0.05 * Math.random()) * this.volume];
    }
    this.anL.getFloatTimeDomainData(this._bufL);
    this.anR.getFloatTimeDomainData(this._bufR);
    const rms = buf => Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
    return [Math.min(1, rms(this._bufL) * 3), Math.min(1, rms(this._bufR) * 3)];
  }

  spectrum() {
    if (this.mode !== "webaudio" || !this.anSpec) return null;
    this.anSpec.getByteFrequencyData(this._spec);
    return this._spec;
  }

  // ---------- MP3 錄音 ----------
  startRecording() {
    if (!this.canRecord) throw new Error("CANNOT_RECORD");
    if (!window.lamejs) throw new Error("NO_ENCODER");
    const ctx = this.ctx;
    const encoder = new lamejs.Mp3Encoder(2, ctx.sampleRate, CONFIG.MP3_BITRATE);
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    const chunks = [];
    const toInt16 = f32 => {
      const out = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    };
    proc.onaudioprocess = e => {
      const L = toInt16(e.inputBuffer.getChannelData(0));
      const R = toInt16(e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : e.inputBuffer.getChannelData(0));
      const mp3 = encoder.encodeBuffer(L, R);
      if (mp3.length) chunks.push(new Uint8Array(mp3));
      // 輸出靜音，避免重複出聲
      for (let c = 0; c < e.outputBuffer.numberOfChannels; c++) e.outputBuffer.getChannelData(c).fill(0);
    };
    // 從原始訊號錄（不受音量旋鈕影響）
    this.src.connect(proc);
    proc.connect(ctx.destination);
    this.recording = { encoder, proc, chunks, started: Date.now() };
    this.onStateChange();
  }

  stopRecording() {
    const r = this.recording;
    if (!r) return null;
    try { this.src.disconnect(r.proc); } catch {}
    r.proc.disconnect();
    r.proc.onaudioprocess = null;
    const tail = r.encoder.flush();
    if (tail.length) r.chunks.push(new Uint8Array(tail));
    this.recording = null;
    this.onStateChange();
    return {
      blob: new Blob(r.chunks, { type: "audio/mpeg" }),
      started: r.started,
      duration: Math.round((Date.now() - r.started) / 1000),
    };
  }

  get recordSeconds() {
    return this.recording ? Math.floor((Date.now() - this.recording.started) / 1000) : 0;
  }

  // 鎖定畫面／耳機控制（iPhone、Android）
  _mediaSession(meta) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title || "Radio Base TW",
        artist: meta.artist || "",
        album: "台灣電波地圖",
      });
    } catch {}
  }
}

// ---------- 自動配對串流（Radio Browser 公開資料庫） ----------
export async function findStreams(station) {
  const base = CONFIG.RADIO_BROWSER_API;
  const isSW = station.band === "SW";
  const terms = [...new Set([
    station.rbName,
    station.name,
    station.name.replace(/(廣播電[臺台]|電[臺台]|廣播)/g, "").split(/\s+/)[0],
    station.network,
  ].filter(t => t && t.length >= 2))];
  const results = [];
  const seen = new Set();
  for (const term of terms) {
    try {
      const q = new URLSearchParams({
        name: term, hidebroken: "true",
        order: "clickcount", reverse: "true", limit: "8",
      });
      if (!isSW) q.set("countrycode", "TW");   // 短波電台是國際台，不限國家
      const res = await fetch(`${base}/json/stations/search?${q}`);
      if (!res.ok) continue;
      for (const r of await res.json()) {
        const url = r.url_resolved || r.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        results.push({ name: r.name, url, codec: r.codec, bitrate: r.bitrate, homepage: r.homepage, score: scoreMatch(station, r.name) });
      }
    } catch (e) { console.warn("Radio Browser 查詢失敗", e); }
    if (results.length >= 3) break;
  }
  return results.sort((a, b) => b.score - a.score);
}

function scoreMatch(station, rbName) {
  let score = 0;
  const n = rbName || "";
  if (station.band === "SW") {
    // 短波台名都很像（Radio…、Voice of…），要求整個搜尋名或所有字詞都出現
    const key = (station.rbName || "").toLowerCase();
    const low = n.toLowerCase();
    if (!key) return 0;
    if (low.includes(key)) return 5;
    return key.split(/\s+/).every(w => low.includes(w)) ? 3 : 0;
  }
  const freq = station.band === "AM" ? String(Math.round(station.freq)) : station.freq.toFixed(1);
  if (n.includes(freq)) score += 5;
  const core = station.name.replace(/(廣播電[臺台]|電[臺台]|廣播)/g, "").split(/\s+/)[0];
  if (core && n.includes(core)) score += 3;
  if (station.network && n.includes(station.network)) score += 2;
  if (station.county && n.includes(station.county.slice(0, 2))) score += 1;
  return score;
}
