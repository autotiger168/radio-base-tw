// 錄音檔保存（存在這台裝置的瀏覽器裡）
import { db } from "./db.js";

export const saveRecording = rec => db.put("recordings", rec);
export const listRecordings = async () => (await db.all("recordings")).sort((a, b) => b.started - a.started);
export const deleteRecording = id => db.remove("recordings", id);
export async function renameRecording(id, name) {
  const r = await db.get("recordings", id);
  if (r) { r.name = name; await db.put("recordings", r); }
}

export function fileName(stationName, started) {
  const d = new Date(started);
  const p = n => String(n).padStart(2, "0");
  const safe = stationName.replace(/[\\/:*?"<>|\s]+/g, "_");
  return `${safe}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.mp3`;
}
