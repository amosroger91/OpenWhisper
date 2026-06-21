// ============================================================
//  storage.js  —  local persistence in localStorage. Holds the
//  accountless identity, a list of rooms you've visited, and a
//  capped per-room message history so conversations survive a
//  reload and can be replayed when you (or a new hub) returns.
//
//  Everything is best-effort: quota / private-mode failures are
//  swallowed and the app keeps working in-memory.
// ============================================================
const NS = "openwhisper:v1";
const ID_KEY = NS + ":identity";
const ROOMS_KEY = NS + ":rooms";
const HIST_KEY = (roomId) => NS + ":hist:" + roomId;

const HISTORY_CAP = 500; // messages kept per room

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/* ---------------- identity ---------------- */
export function loadIdentity() { return read(ID_KEY, null); }
export function saveIdentity(id) { write(ID_KEY, id); }

/* ---------------- recent rooms ---------------- */
export function loadRooms() { return read(ROOMS_KEY, []); }
export function rememberRoom(roomId, label) {
  const rooms = loadRooms().filter((r) => r.id !== roomId);
  rooms.unshift({ id: roomId, label: label || roomId, ts: Date.now() });
  write(ROOMS_KEY, rooms.slice(0, 20));
}
export function forgetRoom(roomId) {
  write(ROOMS_KEY, loadRooms().filter((r) => r.id !== roomId));
}

/* ---------------- per-room history ---------------- */
export function loadHistory(roomId) { return read(HIST_KEY(roomId), []); }

// Append one message, de-duped by id, keeping chronological order and the cap.
export function appendHistory(roomId, msg) {
  if (!msg || !msg.id) return;
  const hist = loadHistory(roomId);
  if (hist.some((m) => m.id === msg.id)) return;
  hist.push(msg);
  hist.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  write(HIST_KEY(roomId), hist.slice(-HISTORY_CAP));
}

// Merge a backlog (e.g. received from the hub) into local history.
export function mergeHistory(roomId, messages) {
  if (!Array.isArray(messages) || !messages.length) return;
  const hist = loadHistory(roomId);
  const seen = new Set(hist.map((m) => m.id));
  for (const m of messages) { if (m && m.id && !seen.has(m.id)) { hist.push(m); seen.add(m.id); } }
  hist.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  write(HIST_KEY(roomId), hist.slice(-HISTORY_CAP));
}

export function clearHistory(roomId) {
  try { localStorage.removeItem(HIST_KEY(roomId)); } catch {}
}
