// 台灣電台地圖（Leaflet + OpenStreetMap）
import { CONFIG } from "./config.js";
import { formatFreq } from "./data.js";

export class StationMap {
  constructor(el, { onSelect }) {
    this.onSelect = onSelect;
    this.map = L.map(el, { zoomControl: true, attributionControl: true })
      .setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    this.markers = new Map();
  }

  icon(s, active) {
    const cls = ["pin", s.band === "AM" ? "pin-am" : "pin-fm", s.stream ? "pin-stream" : "", active ? "pin-active" : ""].join(" ");
    return L.divIcon({
      className: "",
      html: `<div class="${cls}"><span>${s.band === "AM" ? Math.round(s.freq) : s.freq.toFixed(1)}</span></div>`,
      iconSize: [46, 22],
      iconAnchor: [23, 22],
    });
  }

  show(stations, activeId) {
    this.layer.clearLayers();
    this.markers.clear();
    stations.filter(s => !isNaN(s.lat) && !isNaN(s.lng)).forEach(s => {
      const m = L.marker([s.lat, s.lng], { icon: this.icon(s, s.id === activeId), title: `${s.name} ${formatFreq(s)}`, riseOnHover: true })
        .on("click", () => this.onSelect(s));
      m.bindTooltip(`${s.name}<br>${s.band} ${formatFreq(s)}`, { direction: "top", offset: [0, -20] });
      m.addTo(this.layer);
      this.markers.set(s.id, { m, s });
    });
  }

  highlight(id) {
    this.markers.forEach(({ m, s }) => {
      m.setIcon(this.icon(s, s.id === id));
      if (s.id === id) m.setZIndexOffset(1000); else m.setZIndexOffset(0);
    });
  }

  focus(s) {
    if (!isNaN(s.lat)) this.map.flyTo([s.lat, s.lng], Math.max(this.map.getZoom(), 10), { duration: 0.8 });
  }

  invalidate() { setTimeout(() => this.map.invalidateSize(), 60); }
}
