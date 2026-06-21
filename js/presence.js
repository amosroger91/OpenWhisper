// ============================================================
//  presence.js  —  a global "how many people are online" counter,
//  with no server. Same trick as the lobby: the first tab to claim
//  a well-known peer-id ("ow-presence-vN") becomes the HUB and
//  counts everyone connected to it (itself + clients), broadcasting
//  the total. Every tab keeps this connection open for its whole
//  session, so the number reflects everyone using OpenWhisper. If
//  the hub closes, clients re-elect.
//
//  Note: this counts open sessions/tabs, not unique humans — good
//  enough for a friendly "N online" on the landing page.
// ============================================================
// PeerJS is vendored locally (vendor/peerjs.min.js → window.Peer).
const Peer = window.Peer;

const PRESENCE_ID = "ow-presence-v1";
const HEARTBEAT_MS = 15000;

export function trackPresence({ onCount } = {}) {
  let peer = null, isHub = false, stopped = false;
  const conns = new Map();   // hub: peerId -> DataConnection
  let reelectTimer = null, beat = null;

  function broadcast() {
    const n = conns.size + 1;
    for (const c of conns.values()) { try { if (c.open) c.send({ t: "count", n }); } catch {} }
    onCount && onCount(n);
  }

  function startHub() {
    isHub = true;
    onCount && onCount(1);
    peer.on("connection", (c) => {
      c.on("open", () => { conns.set(c.peer, c); broadcast(); });
      c.on("close", () => { conns.delete(c.peer); broadcast(); });
      c.on("error", () => {});
    });
    clearInterval(beat);
    beat = setInterval(broadcast, HEARTBEAT_MS); // keep stragglers in sync
  }

  function startClient() {
    isHub = false;
    const c = peer.connect(PRESENCE_ID, { reliable: true });
    c.on("data", (m) => { if (m && m.t === "count") onCount && onCount(m.n); });
    c.on("close", () => { if (!stopped) reelect(); });
    c.on("error", () => { if (!stopped) reelect(); });
  }

  function reelect() {
    clearTimeout(reelectTimer); clearInterval(beat);
    try { if (peer) peer.destroy(); } catch {}
    peer = null;
    reelectTimer = setTimeout(connect, 300 + Math.random() * 900);
  }

  function connect() {
    if (stopped || !Peer) return;
    peer = new Peer(PRESENCE_ID);
    peer.on("open", startHub);
    peer.on("error", (e) => {
      const type = e && e.type;
      if (type === "unavailable-id") {
        try { peer.destroy(); } catch {}
        peer = new Peer();
        peer.on("open", startClient);
        peer.on("error", () => { if (!stopped) reelect(); });
      } else if (!stopped) {
        reelect();
      }
    });
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(reelectTimer); clearInterval(beat);
      try { for (const c of conns.values()) c.close(); } catch {}
      try { if (peer) peer.destroy(); } catch {}
      peer = null;
    },
  };
}
