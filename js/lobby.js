// ============================================================
//  lobby.js  —  accountless "Quick Match": pair two strangers
//  with no signup and no server.
//
//  PeerJS is point-to-point (no shared room/mesh), so we run a
//  tiny coordinator: the first person to claim a well-known lobby
//  peer-id ("ow-lobby-vN") becomes the HUB; everyone else joins it
//  as a CLIENT. The hub keeps an ordered waiting list (itself
//  included — it wants a match too), pairs people off, mints a
//  private room code, and tells each pair their code. Both then
//  drop into that room via room.js (a 2-person star). If the hub
//  leaves, clients re-elect.
// ============================================================
// PeerJS is vendored locally (vendor/peerjs.min.js → window.Peer).
const Peer = window.Peer;

const LOBBY_ID = "ow-lobby-v1";

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let s = "match-";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function findMatch(handlers = {}) {
  const { onStatus, onMatched, onError } = handlers;
  let peer = null, isHub = false, cancelled = false, matched = false;
  const conns = new Map();    // hub: peerId -> DataConnection
  let waiting = [];           // hub: ordered waiting peer ids (hub self at [0])
  let reelectTimer = null;

  const status = (s) => onStatus && onStatus(s);

  function teardown() {
    clearTimeout(reelectTimer);
    try { for (const c of conns.values()) c.close(); } catch {}
    conns.clear();
    try { if (peer) peer.destroy(); } catch {}
    peer = null;
  }
  function finish(code) {
    if (matched) return;
    matched = true;
    teardown();
    onMatched && onMatched(code);
  }

  // ---- hub ----
  function pairLoop() {
    // Notify client peers first; defer only the hub's own match so we don't
    // tear the lobby down before a partner's message has flushed.
    let selfMatch = null;
    while (waiting.length >= 2) {
      const a = waiting.shift(), b = waiting.shift();
      const code = makeRoomCode();
      for (const id of [a, b]) {
        if (peer && id === peer.id) selfMatch = code;
        else { const c = conns.get(id); if (c && c.open) { try { c.send({ t: "match", code }); } catch {} } }
      }
    }
    if (selfMatch) { const code = selfMatch; setTimeout(() => finish(code), 500); return; }
    const others = waiting.includes(peer && peer.id) ? waiting.length - 1 : waiting.length;
    status(others > 0 ? `Waiting for a match… (${others} also waiting)` : "Waiting for a match…");
  }
  function startAsHub() {
    isHub = true;
    waiting = [peer.id];
    status("Waiting for a match…");
    peer.on("connection", (c) => {
      c.on("open", () => { if (!waiting.includes(c.peer)) waiting.push(c.peer); conns.set(c.peer, c); pairLoop(); });
      c.on("close", () => { conns.delete(c.peer); waiting = waiting.filter((x) => x !== c.peer); });
      c.on("error", () => {});
    });
  }

  // ---- client ----
  function startAsClient() {
    isHub = false;
    const c = peer.connect(LOBBY_ID, { reliable: true });
    c.on("open", () => status("Waiting for a match…"));
    c.on("data", (m) => { if (m && m.t === "match") finish(m.code); });
    c.on("close", () => { if (!matched && !cancelled) reelect(); });
    c.on("error", () => { if (!matched && !cancelled) reelect(); });
  }
  function reelect() {
    clearTimeout(reelectTimer);
    try { if (peer) peer.destroy(); } catch {}
    peer = null;
    reelectTimer = setTimeout(connect, 300 + Math.random() * 900);
  }

  function connect() {
    if (cancelled || matched) return;
    if (!Peer) { onError && onError("peerjs-unavailable"); return; }
    status("Looking for people…");
    peer = new Peer(LOBBY_ID);
    peer.on("open", () => startAsHub());
    peer.on("error", (e) => {
      const type = e && e.type;
      if (type === "unavailable-id") {        // someone already hosts the lobby → join it
        try { peer.destroy(); } catch {}
        peer = new Peer();
        peer.on("open", () => startAsClient());
        peer.on("error", () => { if (!matched && !cancelled) reelect(); });
      } else if (!matched && !cancelled) {
        onError && onError(type || String(e));
      }
    });
  }

  connect();
  return { cancel() { cancelled = true; teardown(); } };
}
