// =============================================================
//  Radio Base TW — 串流中繼（Cloudflare Worker）
//  用途：
//   1. 讓 https 網站可以播放 http 串流
//   2. 加上跨網域標頭，讓網頁可以分析音量、錄成 MP3
//  用法：https://你的worker網址/?url=<原始串流網址>
//
//  部署：Cloudflare 後台 → Workers & Pages → 建立 Worker → 貼上本檔 → 部署
//  安全設定：把下面 ALLOWED_ORIGINS 改成你的 GitHub Pages 網址，
//            避免別人拿你的中繼去轉播其他東西。
// =============================================================

const ALLOWED_ORIGINS = [
  "https://你的帳號.github.io",   // ← 改成你的 GitHub Pages 網址
  "http://localhost:8000",        // 本機測試用，可保留
];

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(allowOrigin) });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    // 只服務自己的網站
    const referer = request.headers.get("Referer") || "";
    const fromAllowed = ALLOWED_ORIGINS.some(o => origin === o || referer.startsWith(o));
    if (!fromAllowed) return new Response("Forbidden", { status: 403 });

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("Missing ?url=", { status: 400 });

    let url;
    try { url = new URL(target); } catch { return new Response("Bad url", { status: 400 }); }
    if (!["http:", "https:"].includes(url.protocol)) return new Response("Bad protocol", { status: 400 });
    if (isPrivateHost(url.hostname)) return new Response("Forbidden host", { status: 403 });

    const fwd = {
      "User-Agent": "RadioBaseTW/1.0",
      "Icy-MetaData": "0",             // 不要夾帶歌曲資訊，避免干擾解碼
    };
    const range = request.headers.get("Range");
    if (range) fwd["Range"] = range;
    const upstream = await fetch(url.toString(), { method: request.method, headers: fwd, redirect: "follow" });

    const type = upstream.headers.get("Content-Type") || "";
    const okType = /audio|mpegurl|octet-stream|ogg|aac|mpeg|video\/mp2t/i.test(type) || type === "";
    if (!okType) return new Response("Not an audio stream", { status: 415 });

    const headers = corsHeaders(allowOrigin);
    headers.set("Content-Type", type || "audio/mpeg");
    headers.set("Cache-Control", "no-store");
    ["Content-Range", "Accept-Ranges"].forEach(h => {
      const v = upstream.headers.get(h); if (v) headers.set(h, v);
    });

    // HLS 播放清單：把裡面的分段網址也改走中繼
    if (/mpegurl/i.test(type)) {
      const text = await upstream.text();
      const self = new URL(request.url); self.search = "";
      const rewritten = text.split("\n").map(line => {
        const l = line.trim();
        if (!l || l.startsWith("#")) return line;
        const abs = new URL(l, url).toString();
        return `${self}?url=${encodeURIComponent(abs)}`;
      }).join("\n");
      return new Response(rewritten, { status: upstream.status, headers });
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function corsHeaders(origin) {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
    "Vary": "Origin",
  });
}

function isPrivateHost(h) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i.test(h);
}
