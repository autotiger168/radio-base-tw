// 台灣電台地圖（Leaflet + OpenStreetMap）
// 發射站很多會蓋在同一座山上（例如陽明山竹子山），所以用「群組」顯示：
// 拉遠時合成一個圓圈數字，點圓圈會放大或展開成一個個電台。
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
    this.layer = L.markerClusterGroup
      ? L.markerClusterGroup({ maxClusterRadius: 40, spiderfyDistanceMultiplier: 1.6, showCoverageOnHover: false })
      : L.layerGroup();
    this.layer.addTo(this.map);
    this.markers = new Map();
    this.activeId = null;
  }

  icon(s, active) {
    const cls = ["pin", s.band === "AM" ? "pin-am" : s.band === "NET" ? "pin-net" : "pin-fm", s.stream ? "pin-stream" : "", s.geoLocked ? "pin-geo" : "", active ? "pin-active" : ""].join(" ");
    return L.divIcon({
      className: "",
      html: `<div class="${cls}"><span>${s.band === "NET" ? "網路" : !s.freq ? s.band : s.band === "AM" ? Math.round(s.freq) : s.freq.toFixed(1)}</span></div>`,
      iconSize: [46, 22],
      iconAnchor: [23, 22],
    });
  }

  show(stations, activeId) {
    this.layer.clearLayers();
    this.markers.clear();
    this.activeId = activeId || null;
    const list = [];
    stations.filter(s => !isNaN(s.lat) && !isNaN(s.lng)).forEach(s => {
      const m = L.marker([s.lat, s.lng], { icon: this.icon(s, s.id === activeId), title: `${s.name} ${formatFreq(s)}`, riseOnHover: true })
        .on("click", () => this.onSelect(s));
      m.bindTooltip(`${s.name}<br>${s.band} ${formatFreq(s)}`, { direction: "top", offset: [0, -20] });
      list.push(m);
      this.markers.set(s.id, { m, s });
    });
    if (this.layer.addLayers) this.layer.addLayers(list); else list.forEach(m => m.addTo(this.layer));
  }

  highlight(id) {
    const set = (key, on) => {
      const it = key && this.markers.get(key);
      if (!it) return;
      it.m.setIcon(this.icon(it.s, on));
      it.m.setZIndexOffset(on ? 1000 : 0);
    };
    set(this.activeId, false);
    set(id, true);
    this.activeId = id;
  }

  focus(s) {
    const it = this.markers.get(s.id);
    if (it && this.layer.zoomToShowLayer) { this.layer.zoomToShowLayer(it.m); return; }
    if (!isNaN(s.lat)) this.map.flyTo([s.lat, s.lng], Math.max(this.map.getZoom(), 10), { duration: 0.8 });
  }

  // 讓地圖顯示目前篩選出來的所有電台
  fit() {
    const pts = [...this.markers.values()].map(({ s }) => [s.lat, s.lng]);
    if (pts.length) this.map.fitBounds(pts, { padding: [30, 30], maxZoom: 11 });
  }

  invalidate() { setTimeout(() => this.map.invalidateSize(), 60); }
}
