// ============================================================
//  main.js  —  UI controller. Wires the Bliss markup to identity,
//  matchmaking (lobby.js), rooms (room.js), voice/video (media.js)
//  and listen-together radio (radio.js). No framework — just the
//  DOM and the modules.
// ============================================================
import { getIdentity, setName, reroll, initials } from "./identity.js";
import { loadRooms, rememberRoom } from "./storage.js";
import { findMatch } from "./lobby.js";
import { joinRoom } from "./room.js";
import * as media from "./media.js";
import * as radio from "./radio.js";

const $ = (id) => document.getElementById(id);
const THEME_KEY = "openwhisper:v1:theme";
const SUGGESTED = ["lounge", "late-night", "music", "study", "games", "introverts"];

let identity = getIdentity();
let room = null;            // active room controller
let currentRoomId = null;
let matcher = null;         // active quick-match search
const renderedIds = new Set();
const msgEls = new Map();       // msgId -> { el, msg }  (for reactions / updates)
const memberMap = new Map();   // id -> {name, color}

const REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🔥", "👀"];
const EMOJIS = ["😀","😂","😍","😎","🤔","😴","😢","😡","🥳","😱","👍","👎","🙏","👏","🙌","🔥","❤️","💯","✨","🎉","👀","🤝","💀","🤯"];
const IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i;
const URL_RE = /(https?:\/\/[^\s]+)/g;
const MAX_FILE = 6 * 1024 * 1024;   // 6 MB cap for arbitrary files
const MAX_IMG_DIM = 1280;           // downscale large images to this longest edge
const tiles = new Map();       // memberId -> tile element
let stations = [];
let currentStation = null;
let avLocked = false;          // true when the room is over the mesh cap

/* ===================== identity & theme ===================== */
function paintAvatar(el, name, color) {
  if (!el) return;
  el.textContent = initials(name);
  el.style.setProperty("--ow-color", color);
}
function renderIdentity() {
  $("idChipName").textContent = identity.name;
  $("nameInput").value = identity.name;
  paintAvatar($("idAvatar"), identity.name, identity.color);
  paintAvatar($("idAvatarLg"), identity.name, identity.color);
}
function applyTheme(name) {
  Bliss.setTheme(name, document.body);
  try { localStorage.setItem(THEME_KEY, name); } catch {}
  document.querySelectorAll("[data-theme]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === name)));
}

$("nameInput").addEventListener("input", () => {
  identity = setName($("nameInput").value);
  $("idChipName").textContent = identity.name;
  paintAvatar($("idAvatar"), identity.name, identity.color);
  paintAvatar($("idAvatarLg"), identity.name, identity.color);
  if (room) room.updateIdentity(identity);
});
$("rerollBtn").addEventListener("click", () => {
  identity = reroll();
  renderIdentity();
  if (room) room.updateIdentity(identity);
});
document.querySelectorAll("[data-theme]").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.theme)));

/* ===================== home screen ===================== */
function renderSuggested() {
  const wrap = $("suggestedRooms");
  wrap.innerHTML = "";
  for (const name of SUGGESTED) {
    const b = document.createElement("button");
    b.className = "bl-btn bl-btn--sm";
    b.type = "button";
    b.textContent = "#" + name;
    b.addEventListener("click", () => enterRoom(name, { label: "#" + name }));
    wrap.appendChild(b);
  }
}
function renderRecent() {
  const rooms = loadRooms().filter((r) => !r.id.startsWith("match-"));
  const wrap = $("recentRooms");
  $("recentWrap").hidden = rooms.length === 0;
  wrap.innerHTML = "";
  for (const r of rooms) {
    const item = document.createElement("div");
    item.className = "bl-listview__item";
    item.role = "option";
    const dot = document.createElement("span");
    dot.className = "ow-avatar"; dot.style.setProperty("--ow-color", "#7d8a99"); dot.textContent = "#";
    const label = document.createElement("span"); label.textContent = r.label || r.id;
    const meta = document.createElement("span"); meta.className = "bl-listview__meta ow-recent__meta"; meta.textContent = "rejoin";
    item.append(dot, label, meta);
    item.addEventListener("click", () => enterRoom(r.id, { label: r.label }));
    wrap.appendChild(item);
  }
}

$("roomForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("roomInput").value.trim();
  if (!name) return;
  enterRoom(name, { label: "#" + name.toLowerCase() });
  $("roomInput").value = "";
});

/* ===================== quick match ===================== */
$("quickMatchBtn").addEventListener("click", startQuickMatch);
function startQuickMatch() {
  $("searchStatus").textContent = "Looking for people…";
  Bliss.openDialog("#searchOverlay");
  matcher = findMatch({
    onStatus: (s) => { $("searchStatus").textContent = s; },
    onMatched: (code) => { matcher = null; Bliss.closeDialog("#searchOverlay"); enterRoom(code, { label: "Quick Match", private: true }); },
    onError: () => { cancelSearch(); Bliss.toast({ title: "Matchmaking", body: "Couldn't reach the lobby. Try again." }); },
  });
}
function cancelSearch() {
  if (matcher) { matcher.cancel(); matcher = null; }
  Bliss.closeDialog("#searchOverlay");
}
$("cancelSearchBtn").addEventListener("click", cancelSearch);
$("cancelSearchX").addEventListener("click", cancelSearch);

/* ===================== room: enter / leave ===================== */
function showScreen(which) {
  $("screen-home").hidden = which !== "home";
  $("screen-room").hidden = which !== "room";
}
function enterRoom(roomId, opts = {}) {
  if (room) room.leave();
  currentRoomId = roomId;
  renderedIds.clear(); msgEls.clear(); memberMap.clear(); tiles.clear();
  $("messages").innerHTML = "";
  $("memberList").innerHTML = "";
  $("mediaStrip").innerHTML = ""; $("mediaStrip").hidden = true;
  $("roomTitle").textContent = opts.label || ("#" + roomId);
  setConn("info", "connecting…");
  $("roleStatus").textContent = "—";
  avLocked = false;
  showScreen("room");
  $("msgInput").focus();

  if (!opts.private) { rememberRoom(roomId, opts.label || roomId); renderRecent(); }
  ensureStations();

  room = joinRoom({
    roomId,
    identity,
    handlers: {
      onStatus: (s) => { setConn(s === "Connected" || s === "Hosting room" ? "ok" : "info", s); $("roomStatus").textContent = s; },
      onSelf: ({ hub }) => { $("roleStatus").textContent = hub ? "Hosting" : "Guest"; },
      onError: (t) => Bliss.toast({ title: "Connection", body: "Error: " + t }),
      onRoster: (members, info) => renderRoster(members, info),
      onHistory: (msgs) => msgs.forEach((m) => renderMessage(m)),
      onChat: (m) => renderMessage(m),
      onReact: (msgId, reactions, emoji, from) => onReact(msgId, reactions, emoji, from),
      onRadio: (state) => onRemoteRadio(state),
      onRemoteStream: (memberId, stream) => addTile(memberId, stream, false),
      onRemoteEnd: (memberId) => removeTile(memberId),
    },
  });
}
function leaveRoom() {
  closePicker();
  if (room) { room.leave(); room = null; }
  media.stopLocal(); radio.stopRadio();
  setMicState(false); setCamState(false);
  currentStation = null; $("nowPlaying").textContent = "Nothing playing.";
  showScreen("home"); renderRecent();
}
$("leaveBtn").addEventListener("click", leaveRoom);
$("leaveBtn2").addEventListener("click", leaveRoom);

function setConn(kind, text) {
  const badge = $("connBadge");
  badge.className = "bl-badge bl-badge--" + (kind === "ok" ? "ok" : kind === "danger" ? "danger" : "info");
  $("connText").textContent = text;
}

/* ===================== roster ===================== */
function renderRoster(members, info = {}) {
  memberMap.clear();
  for (const m of members) memberMap.set(m.id, { name: m.name, color: m.color });
  $("memberCount").textContent = members.length;
  const list = $("memberList");
  list.innerHTML = "";
  for (const m of members) {
    const item = document.createElement("div");
    item.className = "bl-listview__item";
    const av = document.createElement("span");
    av.className = "ow-avatar"; av.style.setProperty("--ow-color", m.color); av.textContent = initials(m.name);
    const name = document.createElement("span"); name.textContent = m.name;
    const meta = document.createElement("span"); meta.className = "bl-listview__meta";
    meta.textContent = (m.id === identity.id ? "you" : "") + (m.av ? " 🔊" : "");
    item.append(av, name, meta);
    list.appendChild(item);
  }
  // refresh any open tile labels
  for (const [id, tile] of tiles) {
    const info2 = id === identity.id ? identity : memberMap.get(id);
    if (info2) tile.querySelector(".ow-tile__name span:last-child").textContent = info2.name;
  }
  avLocked = !!info.capped;
  $("capNote").hidden = !avLocked;
  updateMediaButtons();
}

/* ===================== messages ===================== */
function nearBottom() {
  const el = $("messages");
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}
// Turn a plain string into a fragment: clickable links, and inline thumbnails
// for any URL that points at an image. Built with DOM nodes (no innerHTML) so
// remote text can't inject markup.
function linkify(text) {
  const frag = document.createDocumentFragment();
  const line = document.createElement("div"); line.className = "ow-msg__text";
  const imgUrls = [];
  let last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last) line.appendChild(document.createTextNode(text.slice(last, m.index)));
    const url = m[0];
    const a = document.createElement("a");
    a.href = url; a.textContent = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "bl-link";
    line.appendChild(a);
    if (IMG_RE.test(url)) imgUrls.push(url);
    last = m.index + url.length;
  }
  if (last < text.length) line.appendChild(document.createTextNode(text.slice(last)));
  frag.appendChild(line);
  for (const url of imgUrls) frag.appendChild(makeChatImage(url));
  return frag;
}

function makeChatImage(src) {
  const img = document.createElement("img");
  img.className = "ow-msg-img"; img.loading = "lazy"; img.src = src; img.alt = "shared image";
  img.addEventListener("click", () => window.open(src, "_blank", "noopener"));
  return img;
}

function makeFileChip(file) {
  const a = document.createElement("a");
  a.className = "ow-file"; a.href = file.dataUrl; a.download = file.name || "file"; a.title = "Download " + (file.name || "file");
  const icon = document.createElement("span"); icon.className = "ow-file__icon"; icon.textContent = "📄";
  const meta = document.createElement("span"); meta.className = "ow-file__meta";
  const nm = document.createElement("div"); nm.className = "ow-file__name"; nm.textContent = file.name || "file";
  const sz = document.createElement("div"); sz.className = "ow-file__size"; sz.textContent = fmtSize(file.size || 0);
  meta.append(nm, sz); a.append(icon, meta);
  return a;
}
function fmtSize(b) { return b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB"; }

function renderMessage(msg) {
  if (!msg || !msg.id || renderedIds.has(msg.id)) return;
  renderedIds.add(msg.id);
  const stick = nearBottom();
  const wrap = document.createElement("div");

  if (msg.kind === "system") {
    wrap.className = "ow-msg ow-msg--sys";
    const s = document.createElement("span"); s.className = "ow-sys"; s.textContent = msg.text;
    wrap.appendChild(s);
    $("messages").appendChild(wrap);
    if (stick) $("messages").scrollTop = $("messages").scrollHeight;
    return;
  }

  const me = msg.from === identity.id;
  wrap.className = "ow-msg" + (me ? " ow-msg--me" : "");
  const av = document.createElement("span");
  av.className = "ow-avatar"; av.style.setProperty("--ow-color", msg.color || "#888"); av.textContent = initials(msg.name);
  const body = document.createElement("div"); body.className = "ow-msg__body";
  if (!me) { const who = document.createElement("div"); who.className = "ow-msg__who"; who.style.color = msg.color || ""; who.textContent = msg.name; body.appendChild(who); }

  if (msg.image && msg.image.src) body.appendChild(makeChatImage(msg.image.src));
  if (msg.file && msg.file.dataUrl) body.appendChild(makeFileChip(msg.file));
  if (msg.text) body.appendChild(linkify(msg.text));

  const time = document.createElement("div"); time.className = "ow-msg__time"; time.textContent = fmtTime(msg.ts);
  body.appendChild(time);

  const reacts = document.createElement("div"); reacts.className = "ow-reacts";
  body.appendChild(reacts);
  wrap.append(av, body);

  $("messages").appendChild(wrap);
  const entry = { el: wrap, msg, reacts };
  msgEls.set(msg.id, entry);
  renderReactions(entry);
  if (stick) $("messages").scrollTop = $("messages").scrollHeight;
}

/* ---- reactions ---- */
function renderReactions(entry) {
  const { reacts, msg } = entry;
  reacts.innerHTML = "";
  const r = msg.reactions || {};
  for (const emoji of Object.keys(r)) {
    const ids = r[emoji] || [];
    if (!ids.length) continue;
    const mine = ids.includes(identity.id);
    const chip = document.createElement("button");
    chip.type = "button"; chip.className = "ow-react" + (mine ? " is-mine" : "");
    chip.title = ids.map((id) => (id === identity.id ? "you" : (memberMap.get(id) || {}).name || "someone")).join(", ");
    chip.innerHTML = "";
    chip.append(document.createTextNode(emoji));
    const n = document.createElement("span"); n.className = "ow-react__n"; n.textContent = ids.length; chip.appendChild(n);
    chip.addEventListener("click", () => { if (room) room.sendReact(msg.id, emoji); });
    reacts.appendChild(chip);
  }
  const add = document.createElement("button");
  add.type = "button"; add.className = "ow-react-add"; add.textContent = "＋"; add.title = "Add reaction";
  add.addEventListener("click", (e) => { e.stopPropagation(); openPicker(add, REACTIONS, (emoji) => { if (room) room.sendReact(msg.id, emoji); }); });
  reacts.appendChild(add);
}

function onReact(msgId, reactions, emoji, from) {
  const entry = msgEls.get(msgId);
  if (!entry) return;
  if (reactions) entry.msg.reactions = reactions;
  else { // message not in history (cap-evicted): toggle locally
    const r = entry.msg.reactions || (entry.msg.reactions = {});
    const arr = r[emoji] || [];
    const i = arr.indexOf(from);
    if (i >= 0) arr.splice(i, 1); else arr.push(from);
    if (arr.length) r[emoji] = arr; else delete r[emoji];
  }
  renderReactions(entry);
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("msgInput").value.trim();
  if (!text || !room) return;
  room.sendChat(text);
  $("msgInput").value = "";
});

/* ---- emoji picker (shared by reactions + composer) ---- */
let pickerEl = null;
function closePicker() {
  if (pickerEl) { pickerEl.remove(); pickerEl = null; document.removeEventListener("pointerdown", onPickerOutside, true); }
}
function onPickerOutside(e) { if (pickerEl && !pickerEl.contains(e.target)) closePicker(); }
function openPicker(anchor, emojis, onPick) {
  closePicker();
  pickerEl = document.createElement("div"); pickerEl.className = "ow-picker";
  for (const em of emojis) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = em;
    b.addEventListener("click", () => { onPick(em); closePicker(); });
    pickerEl.appendChild(b);
  }
  document.body.appendChild(pickerEl);
  const r = anchor.getBoundingClientRect();
  const pw = pickerEl.offsetWidth, ph = pickerEl.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
  let top = r.top - ph - 6; if (top < 8) top = r.bottom + 6;
  pickerEl.style.left = left + "px"; pickerEl.style.top = top + "px";
  setTimeout(() => document.addEventListener("pointerdown", onPickerOutside, true), 0);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });

$("emojiBtn").addEventListener("click", () => openPicker($("emojiBtn"), EMOJIS, insertEmoji));
function insertEmoji(em) {
  const inp = $("msgInput");
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, s) + em + inp.value.slice(e);
  inp.focus(); const pos = s + em.length; inp.setSelectionRange(pos, pos);
}

/* ---- file & image sharing ---- */
$("attachBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });

$("msgInput").addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const it of items) if (it.kind === "file") { const f = it.getAsFile(); if (f) files.push(f); }
  if (files.length) { e.preventDefault(); handleFiles(files); }
});

const chatPane = $("chatPane");
function hasFiles(e) { return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"); }
chatPane.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); $("dropMask").hidden = false; } });
chatPane.addEventListener("dragleave", (e) => { if (!chatPane.contains(e.relatedTarget)) $("dropMask").hidden = true; });
chatPane.addEventListener("drop", (e) => { $("dropMask").hidden = true; if (hasFiles(e)) { e.preventDefault(); handleFiles(e.dataTransfer.files); } });

async function handleFiles(list) {
  if (!room) { Bliss.toast("Join a room first"); return; }
  for (const file of Array.from(list || [])) {
    try {
      if (file.type && file.type.startsWith("image/")) {
        const image = await fileToImage(file);
        if (image) room.sendImage(image);
      } else {
        const f = await fileToFile(file);
        if (f) room.sendFile(f);
      }
    } catch { Bliss.toast({ title: "Share failed", body: file.name || "file" }); }
  }
}

function readDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Downscale + compress an image to keep it light enough to relay and persist.
async function fileToImage(file) {
  const src = await readDataUrl(file);
  if (file.type === "image/gif" && file.size <= 3 * 1024 * 1024) return { src, name: file.name }; // keep animation
  const img = await loadImg(src);
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_IMG_DIM / Math.max(w, h || 1));
  w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  const png = file.type === "image/png";
  let out; try { out = c.toDataURL(png ? "image/png" : "image/jpeg", 0.82); } catch { out = src; }
  if (out.length > src.length) out = src; // never make it bigger
  return { src: out, w, h, name: file.name };
}
async function fileToFile(file) {
  if (file.size > MAX_FILE) { Bliss.toast({ title: "Too big", body: (file.name || "file") + " is over 6 MB" }); return null; }
  const dataUrl = await readDataUrl(file);
  return { name: file.name, size: file.size, mime: file.type || "application/octet-stream", dataUrl };
}

/* ===================== voice / video ===================== */
let micOn = false, camOn = false;
function setMicState(on) { micOn = on; $("micBtn").setAttribute("aria-pressed", String(on)); }
function setCamState(on) { camOn = on; $("camBtn").setAttribute("aria-pressed", String(on)); }
function updateMediaButtons() {
  $("micBtn").disabled = avLocked && !micOn;
  $("camBtn").disabled = avLocked && !camOn;
}

async function applyMedia() {
  try {
    await media.setMedia({ audio: micOn, video: camOn });
  } catch (e) {
    Bliss.toast({ title: "Permission", body: "Couldn't access mic/camera. Check browser permissions." });
    setMicState(false); setCamState(false);
    await media.setMedia({ audio: false, video: false }).catch(() => {});
  }
  renderSelfTile();
  if (room) room.refreshMedia();
}
$("micBtn").addEventListener("click", () => { if ($("micBtn").disabled) return; setMicState(!micOn); applyMedia(); });
$("camBtn").addEventListener("click", () => { if ($("camBtn").disabled) return; setCamState(!camOn); applyMedia(); });

function renderSelfTile() {
  if (media.hasMedia()) addTile(identity.id, media.getLocalStream(), true);
  else removeTile(identity.id);
}
function addTile(memberId, stream, isSelf) {
  let tile = tiles.get(memberId);
  const info = isSelf ? identity : (memberMap.get(memberId) || { name: "Guest", color: "#888" });
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "ow-tile" + (isSelf ? " ow-tile--self" : "");
    const video = document.createElement("video");
    video.autoplay = true; video.playsInline = true; if (isSelf) video.muted = true;
    const label = document.createElement("div"); label.className = "ow-tile__name";
    const dot = document.createElement("span"); dot.className = "ow-avatar"; dot.style.width = dot.style.height = "16px"; dot.style.fontSize = "8px";
    dot.style.setProperty("--ow-color", info.color); dot.textContent = initials(info.name);
    const nm = document.createElement("span"); nm.textContent = info.name;
    label.append(dot, nm);
    tile.append(video, label);
    $("mediaStrip").appendChild(tile);
    tiles.set(memberId, tile);
  }
  const video = tile.querySelector("video");
  if (video.srcObject !== stream) video.srcObject = stream;
  $("mediaStrip").hidden = tiles.size === 0;
}
function removeTile(memberId) {
  const tile = tiles.get(memberId);
  if (tile) { const v = tile.querySelector("video"); if (v) v.srcObject = null; tile.remove(); tiles.delete(memberId); }
  $("mediaStrip").hidden = tiles.size === 0;
}

/* ===================== listen-together radio ===================== */
async function ensureStations() {
  if (stations.length) return;
  try {
    stations = await radio.fetchStations();
    const sel = $("stationSelect");
    sel.innerHTML = '<option value="">Pick a station…</option>';
    for (const s of stations) {
      const o = document.createElement("option");
      o.value = s.url; o.textContent = `${s.name} · ${s.tag}`;
      sel.appendChild(o);
    }
  } catch {
    $("stationSelect").innerHTML = '<option value="">Stations unavailable</option>';
  }
}
$("radioPlayBtn").addEventListener("click", async () => {
  const url = $("stationSelect").value;
  if (!url) { Bliss.toast("Pick a station first"); return; }
  const s = stations.find((x) => x.url === url) || { name: "Station", url };
  const ok = await radio.playStation(url);
  currentStation = s;
  $("nowPlaying").textContent = ok ? "▶ " + s.name : "Couldn't play this station.";
  if (ok && room) room.sendRadio({ action: "play", station: s });
});
$("radioStopBtn").addEventListener("click", () => {
  radio.stopRadio();
  $("nowPlaying").textContent = "Stopped.";
  if (room) room.sendRadio({ action: "stop" });
});
$("radioVol").addEventListener("input", (e) => radio.setRadioVolume(e.target.value / 100));

function onRemoteRadio(state) {
  if (!state) return;
  if (state.action === "stop") { radio.stopRadio(); $("nowPlaying").textContent = "Stopped by the room."; return; }
  if (state.action === "play" && state.station) {
    currentStation = state.station;
    $("stationSelect").value = state.station.url || "";
    radio.playStation(state.station.url).then((ok) => {
      $("nowPlaying").textContent = ok ? "▶ " + state.station.name + " (room)" : "▶ " + state.station.name + " — tap Play to join";
    });
  }
}

/* ===================== boot ===================== */
function boot() {
  let theme = "blue";
  try { theme = localStorage.getItem(THEME_KEY) || "blue"; } catch {}
  applyTheme(theme);
  renderIdentity();
  renderSuggested();
  renderRecent();
  showScreen("home");
}
boot();
window.addEventListener("beforeunload", () => { if (room) room.leave(); });
