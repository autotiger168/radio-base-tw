// =============================================================
//  台灣電波地圖 Radio Base TW — 設定檔
//  你只需要改這個檔案的兩個網址，其他程式不用動。
// =============================================================

export const CONFIG = {
  // ① Google 試算表「發佈到網路」後的 CSV 網址
  //    （檔案 → 共用 → 發佈到網路 → 選「台灣電台」分頁 → 格式選 CSV）
  //    留空字串 "" 時，網站會使用 repo 內建的 data/stations.csv
  SHEET_CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQE23fwuXRaLqxPeyUlUNVOs5f3P7KiirTa-7HUIWSvUYKvaTQ69YrMZNUiTp8qVF3kboUJ38DAVgIW/pub?gid=0&single=true&output=csv",

  // ② Cloudflare Worker 串流中繼網址（例如 https://radio-proxy.你的帳號.workers.dev）
  //    留空時：只能播放 https 串流，且大部分電台無法錄音
  PROXY_URL: "https://radio-proxy.jarcle-huang.workers.dev",

  // ③（選填）短波電台資料表的 Google 試算表 CSV 網址（「短波電台」分頁）
  //    留空時使用 repo 內建的 data/sw-stations.csv
  SW_SHEET_CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQE23fwuXRaLqxPeyUlUNVOs5f3P7KiirTa-7HUIWSvUYKvaTQ69YrMZNUiTp8qVF3kboUJ38DAVgIW/pub?gid=515081126&single=true&output=csv",

  // ④（選填）你常用的 KiwiSDR 網路接收機，第一台會用在頻率表的 📡 按鈕
  //    到 https://rx.kiwisdr.com/ 挑離台灣近的，複製網址填進來，例如：
  //    { name: "某某站", url: "http://xxxxx.proxy.kiwisdr.com:8073" },
  KIWISDR_RECEIVERS: [
  ],

  // 內建備用資料
  FALLBACK_CSV: "data/stations.csv",

  // 找不到串流網址時，到 Radio Browser 公開資料庫自動配對
  AUTO_MATCH_STREAM: true,
  RADIO_BROWSER_API: "https://de1.api.radio-browser.info",

  // 地圖初始中心（台灣）
  MAP_CENTER: [23.7, 120.95],
  MAP_ZOOM: 7,

  // 錄音 MP3 位元率（kbps）
  MP3_BITRATE: 128,
};
