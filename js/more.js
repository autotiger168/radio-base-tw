// =============================================================
//  「更多」分頁：台灣廣播史時間軸、日本電台角落
// =============================================================
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export class MorePage {
  constructor(root, { onAction }) {
    this.root = root;
    this.onAction = onAction;
    this.root.innerHTML = `
      <div class="card more-history"><p class="hint">讀取中…</p></div>
      <div class="card more-japan"><p class="hint">讀取中…</p></div>`;
    this.load();
  }

  async load() {
    try {
      const h = await (await fetch("data/history.json", { cache: "no-store" })).json();
      const eras = [...new Set(h.events.map(e => e.era))];
      this.root.querySelector(".more-history").innerHTML = `
        <h2 class="sec-title">🏛 ${esc(h.title)}</h2>
        <p class="hint">${esc(h.note)}</p>
        <div class="era-filter">${["全部", ...eras].map((e, i) => `<button class="mini ${i ? "" : "on"}" data-era="${esc(e)}">${esc(e)}</button>`).join("")}</div>
        <ol class="timeline">${h.events.map(e => `
          <li data-era="${esc(e.era)}">
            <span class="tl-year">${esc(e.year)}</span>
            <div class="tl-body"><b>${esc(e.title)}</b><p>${esc(e.text)}</p><small class="tl-era">${esc(e.era)}</small></div>
          </li>`).join("")}</ol>`;
      this.root.querySelectorAll(".era-filter button").forEach(b => b.addEventListener("click", () => {
        this.root.querySelectorAll(".era-filter button").forEach(x => x.classList.toggle("on", x === b));
        this.root.querySelectorAll(".timeline li").forEach(li => li.hidden = b.dataset.era !== "全部" && li.dataset.era !== b.dataset.era);
      }));
    } catch { this.root.querySelector(".more-history").innerHTML = `<p class="hint">無法讀取 data/history.json</p>`; }

    try {
      const j = await (await fetch("data/japan.json", { cache: "no-store" })).json();
      this.root.querySelector(".more-japan").innerHTML = `
        <h2 class="sec-title">🇯🇵 ${esc(j.title)}</h2>
        <p class="hint">${esc(j.intro)}</p>
        ${j.sections.map(s => `<h3 class="jp-h">${esc(s.title)}</h3>
          <div class="jp-grid">${s.items.map(it => `<div class="jp-item">
            <b>${esc(it.name)}</b><p>${esc(it.text)}</p>
            ${it.url ? `<a class="lnk" href="${esc(it.url)}" target="_blank" rel="noopener">前往 ↗</a>` : ""}
            ${it.action ? `<button class="lnk" data-action="${esc(it.action)}">查看 →</button>` : ""}
          </div>`).join("")}</div>`).join("")}`;
      this.root.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", () => this.onAction(b.dataset.action)));
    } catch { this.root.querySelector(".more-japan").innerHTML = `<p class="hint">無法讀取 data/japan.json</p>`; }
  }
}
