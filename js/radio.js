// ============================================================
//  radio.js  —  social "listen together" internet radio via the
//  Radio Browser API (free, open, CORS-enabled). We fetch a
//  curated set of stations across genres, keep only HTTPS streams
//  (HTTP is blocked as mixed content on GitHub Pages), and play
//  the chosen one in a plain <audio>. Which station is playing is
//  synced between members by the caller over the data channel.
// ============================================================
const MIRRORS = [
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://fr1.api.radio-browser.info",
];
const TAGS = ["lofi", "jazz", "classical", "rock", "electronic", "pop", "reggae", "ambient"];

let baseCache = null;
let audio = null;
let lastVolume = 0.5;

async function apiGet(path) {
  const order = baseCache ? [baseCache, ...MIRRORS.filter((m) => m !== baseCache)] : MIRRORS;
  for (const m of order) {
    try {
      const r = await fetch(m + path, { cache: "no-store" });
      if (r.ok) { baseCache = m; return await r.json(); }
    } catch {}
  }
  throw new Error("Radio Browser unreachable");
}

// A curated, genre-diverse list of working HTTPS stations.
export async function fetchStations() {
  const lists = await Promise.all(TAGS.map(async (tag) => {
    try {
      const arr = await apiGet(`/json/stations/search?tag=${encodeURIComponent(tag)}&order=votes&reverse=true&hidebroken=true&limit=6`);
      return arr
        .filter((s) => s.url_resolved && s.url_resolved.startsWith("https://"))
        .map((s) => ({ name: (s.name || "Unknown").trim().slice(0, 42), url: s.url_resolved, tag, bitrate: s.bitrate || 0, codec: s.codec || "" }));
    } catch { return []; }
  }));
  const seen = new Set(), out = [];
  for (const list of lists) {
    let perTag = 0;
    for (const s of list) {
      if (perTag >= 2) break;
      if (seen.has(s.url) || !s.name) continue;
      seen.add(s.url); out.push(s); perTag++;
    }
  }
  return out;
}

// Returns true if playback started (autoplay can be blocked until a gesture).
export async function playStation(url) {
  stopRadio();
  audio = new Audio(url);
  audio.volume = lastVolume;
  try { await audio.play(); return true; }
  catch { return false; }
}
export function resumeRadio() {
  if (!audio) return Promise.resolve(false);
  return audio.play().then(() => true).catch(() => false);
}
export function stopRadio() {
  if (audio) { try { audio.pause(); } catch {} audio.src = ""; audio = null; }
}
export function setRadioVolume(v) { lastVolume = Math.max(0, Math.min(1, v)); if (audio) audio.volume = lastVolume; }
export function radioVolume() { return lastVolume; }
export function isRadioOn() { return !!audio; }
export function onRadioError(cb) { if (audio) audio.onerror = cb; }
