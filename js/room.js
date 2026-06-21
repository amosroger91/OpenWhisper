// ============================================================
//  room.js  —  serverless group chat over PeerJS.
//
//  GitHub Pages is static, so there is no server. PeerJS gives us
//  peer-to-peer DataConnections (text/presence/radio) and media
//  calls (voice/video) through a free public broker — no backend.
//
//  Topology: a STAR. The first person to claim the room's
//  well-known peer-id ("ow-room-<slug>") becomes the HUB. Everyone
//  else connects to the hub as a CLIENT. The hub is the source of
//  truth: it relays every chat/presence/radio message to all
//  members, keeps the canonical message order, and hands new
//  joiners the recent history. If the hub leaves, clients race to
//  claim the id and the winner becomes the new hub (history
//  survives because every member persists what it sees).
//
//  Voice/video is a FULL MESH on top: members in the call dial
//  each other directly (lower peer-id initiates, to avoid double
//  calls). The mesh is capped — past MESH_CAP people we keep text
//  + radio but stop forming media connections, since a mesh gets
//  expensive fast.
// ============================================================
import * as peerjs from "https://esm.sh/peerjs@1.5.4";
import { getLocalStream, hasMedia } from "./media.js";
import { loadHistory, appendHistory, mergeHistory } from "./storage.js";

const Peer = peerjs.Peer || peerjs.default;
const MESH_CAP = 8;           // max members before A/V mesh is suspended
const HISTORY_SHARE = 200;    // messages handed to a new joiner

export function roomPeerId(roomId) {
  const slug = String(roomId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return "ow-room-" + (slug || "x");
}

function newMsgId() { return "x" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36); }

export function joinRoom({ roomId, identity, handlers = {} }) {
  const HUB_ID = roomPeerId(roomId);
  const h = handlers;

  let peer = null;
  let isHub = false;
  let hubConn = null;             // client: the one connection to the hub
  const clientConns = new Map();  // hub: remotePeerId -> DataConnection
  let members = [];               // both: roster [{id,name,color,peerId,av}]
  let radioState = null;          // last known shared radio state
  let leaving = false;
  let reelectTimer = null;

  const mediaConns = new Map();   // remotePeerId -> MediaConnection
  let reconcileTimer = null;

  const status = (s) => h.onStatus && h.onStatus(s);
  const myPeerId = () => (peer && peer.id) || "";
  const capped = () => members.length > MESH_CAP;

  /* ---------------- roster helpers ---------------- */
  function selfMember() {
    return { id: identity.id, name: identity.name, color: identity.color, peerId: myPeerId(), av: hasMedia() };
  }
  function upsert(m) {
    const i = members.findIndex((x) => x.id === m.id);
    if (i >= 0) members[i] = { ...members[i], ...m };
    else members.push(m);
  }
  function emitRoster() {
    h.onRoster && h.onRoster(members.slice(), { capped: capped(), hub: isHub });
    scheduleReconcile();
  }

  /* ---------------- message plumbing ---------------- */
  // Hub: relay to every client (optionally skipping one). Client: no-op.
  function broadcast(env, exceptPeerId) {
    for (const [pid, c] of clientConns) {
      if (pid === exceptPeerId) continue;
      try { if (c.open) c.send(env); } catch {}
    }
  }
  // Send a message toward the hub (client) or process it here (hub).
  function toHub(env) {
    if (isHub) handleAtHub(env, null);
    else { try { if (hubConn && hubConn.open) hubConn.send(env); } catch {} }
  }

  function stampChat(text, member) {
    return { id: newMsgId(), kind: "chat", from: member.id, name: member.name, color: member.color, text: String(text).slice(0, 2000), ts: Date.now() };
  }
  function sysMsg(text) { return { id: newMsgId(), kind: "system", text, ts: Date.now() }; }

  function deliverChat(msg) {
    appendHistory(roomId, msg);
    h.onChat && h.onChat(msg);
  }

  /* ---------------- hub: handle an incoming envelope ---------------- */
  function handleAtHub(env, fromPeerId) {
    if (!env || !env.t) return;
    if (env.t === "hello") {
      const m = env.d || {};
      upsert({ id: m.id, name: m.name, color: m.color, peerId: fromPeerId, av: false });
      const conn = fromPeerId ? clientConns.get(fromPeerId) : null;
      if (conn) {
        const hist = loadHistory(roomId).slice(-HISTORY_SHARE);
        try { conn.send({ t: "welcome", d: { roster: members.slice(), history: hist, radio: radioState } }); } catch {}
      }
      const sm = sysMsg(`${m.name || "Someone"} joined`);
      deliverChat(sm); broadcast({ t: "chat", d: sm });
      emitRoster(); broadcast({ t: "roster", d: members.slice() });
    } else if (env.t === "chat") {
      const member = members.find((x) => x.peerId === fromPeerId) || { id: "?", name: "?", color: "#888" };
      const msg = stampChat((env.d && env.d.text) || "", member);
      deliverChat(msg); broadcast({ t: "chat", d: msg });
    } else if (env.t === "radio") {
      radioState = env.d || null;
      h.onRadio && h.onRadio(radioState);
      broadcast({ t: "radio", d: radioState }, fromPeerId);
    } else if (env.t === "meta") {
      const i = members.findIndex((x) => x.peerId === fromPeerId);
      if (i >= 0) members[i].av = !!(env.d && env.d.av);
      emitRoster(); broadcast({ t: "roster", d: members.slice() });
    }
  }

  /* ---------------- client: handle a message from the hub ---------------- */
  function handleFromHub(env) {
    if (!env || !env.t) return;
    if (env.t === "welcome") {
      members = (env.d.roster || []).slice();
      radioState = env.d.radio || null;
      mergeHistory(roomId, env.d.history || []);
      if (env.d.history && env.d.history.length && h.onHistory) h.onHistory(env.d.history);
      if (radioState && h.onRadio) h.onRadio(radioState);
      emitRoster();
    } else if (env.t === "roster") {
      members = (env.d || []).slice();
      pruneStaleMedia();
      emitRoster();
    } else if (env.t === "chat") {
      deliverChat(env.d);
    } else if (env.t === "radio") {
      radioState = env.d || null;
      h.onRadio && h.onRadio(radioState);
    }
  }

  /* ---------------- A/V mesh ---------------- */
  function resolveMemberId(peerId) {
    const m = members.find((x) => x.peerId === peerId);
    return m ? m.id : peerId;
  }
  function trackCall(call) {
    const pid = call.peer;
    mediaConns.set(pid, call);
    call.on("stream", (s) => h.onRemoteStream && h.onRemoteStream(resolveMemberId(pid), s));
    // On drop, re-evaluate the mesh: if the peer is still here and in the call,
    // the lower peer-id will re-dial (covers a peer that refreshed its stream).
    call.on("close", () => { mediaConns.delete(pid); h.onRemoteEnd && h.onRemoteEnd(resolveMemberId(pid)); scheduleReconcile(); });
    call.on("error", () => { mediaConns.delete(pid); h.onRemoteEnd && h.onRemoteEnd(resolveMemberId(pid)); scheduleReconcile(); });
  }
  function scheduleReconcile() {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(reconcileMesh, 350);
  }
  function reconcileMesh() {
    if (capped() || !hasMedia()) return;          // not in the call, or too many people
    const stream = getLocalStream();
    if (!stream) return;
    for (const m of members) {
      if (m.id === identity.id || !m.av || !m.peerId) continue;
      if (mediaConns.has(m.peerId)) continue;
      // Deterministic initiator: the lower peer-id dials, the other answers.
      if (myPeerId() < m.peerId) {
        try { trackCall(peer.call(m.peerId, stream)); } catch {}
      }
    }
  }
  function pruneStaleMedia() {
    const live = new Set(members.map((m) => m.peerId));
    for (const [pid, call] of mediaConns) {
      if (!live.has(pid)) { try { call.close(); } catch {} mediaConns.delete(pid); h.onRemoteEnd && h.onRemoteEnd(resolveMemberId(pid)); }
    }
  }
  function closeAllMedia() {
    for (const [pid, call] of mediaConns) { try { call.close(); } catch {} h.onRemoteEnd && h.onRemoteEnd(resolveMemberId(pid)); }
    mediaConns.clear();
  }

  /* ---------------- connection lifecycle ---------------- */
  function wireClientConn(c) {
    hubConn = c;
    c.on("open", () => {
      status("Connected");
      try { c.send({ t: "hello", d: { id: identity.id, name: identity.name, color: identity.color } }); } catch {}
    });
    c.on("data", handleFromHub);
    c.on("close", () => { if (!leaving) reelect(); });
    c.on("error", () => { if (!leaving) reelect(); });
  }

  function startAsHub() {
    isHub = true;
    members = [selfMember()];
    status("Hosting room");
    // Replay our own persisted history so a re-elected hub keeps the thread.
    if (h.onHistory) { const hist = loadHistory(roomId); if (hist.length) h.onHistory(hist); }
    h.onSelf && h.onSelf({ hub: true });
    emitRoster();
    peer.on("connection", (c) => {
      c.on("open", () => { clientConns.set(c.peer, c); });
      c.on("data", (env) => handleAtHub(env, c.peer));
      c.on("close", () => {
        clientConns.delete(c.peer);
        const m = members.find((x) => x.peerId === c.peer);
        members = members.filter((x) => x.peerId !== c.peer);
        if (m) { const sm = sysMsg(`${m.name} left`); deliverChat(sm); broadcast({ t: "chat", d: sm }); }
        pruneStaleMedia();
        emitRoster(); broadcast({ t: "roster", d: members.slice() });
      });
      c.on("error", () => {});
    });
    // Incoming media calls (mesh): answer with our stream if we're in the call.
    peer.on("call", (call) => { call.answer(getLocalStream() || undefined); trackCall(call); });
  }

  function startAsClient() {
    isHub = false;
    status("Joining…");
    h.onSelf && h.onSelf({ hub: false });
    wireClientConn(peer.connect(HUB_ID, { reliable: true }));
    peer.on("call", (call) => { call.answer(getLocalStream() || undefined); trackCall(call); });
  }

  function reelect() {
    if (leaving) return;
    closeAllMedia();
    clearTimeout(reelectTimer);
    try { if (peer) peer.destroy(); } catch {}
    peer = null; hubConn = null;
    status("Reconnecting…");
    // Jitter so clients don't stampede the hub id all at once.
    reelectTimer = setTimeout(connect, 300 + Math.random() * 900);
  }

  function connect() {
    if (leaving) return;
    status("Connecting…");
    peer = new Peer(HUB_ID);
    peer.on("open", () => startAsHub());
    peer.on("error", (e) => {
      const type = (e && e.type) || String(e);
      if (type === "unavailable-id") {
        // Someone already hosts this room → join it as a client.
        try { peer.destroy(); } catch {}
        peer = new Peer();
        peer.on("open", () => startAsClient());
        peer.on("error", (e2) => {
          const t2 = (e2 && e2.type) || String(e2);
          if (t2 === "peer-unavailable" && !leaving) reelect(); // hub vanished mid-join
          else if (!leaving) h.onError && h.onError(t2);
        });
      } else if (!leaving) {
        h.onError && h.onError(type);
      }
    });
  }

  connect();

  /* ---------------- public API ---------------- */
  return {
    get isHub() { return isHub; },
    get size() { return members.length; },
    get capped() { return capped(); },
    sendChat(text) {
      text = String(text || "").trim();
      if (!text) return;
      if (isHub) {
        const msg = stampChat(text, selfMember());
        deliverChat(msg); broadcast({ t: "chat", d: msg });
      } else {
        toHub({ t: "chat", d: { text } });
      }
    },
    // Caller applies radio locally first (autoplay needs a gesture), then syncs.
    sendRadio(state) {
      radioState = state || null;
      if (isHub) broadcast({ t: "radio", d: radioState });
      else toHub({ t: "radio", d: radioState });
    },
    // Call after media.setMedia(): refresh our streams across the mesh and
    // announce our new A/V status so others (re)dial us.
    refreshMedia() {
      closeAllMedia();
      const i = members.findIndex((x) => x.id === identity.id);
      if (i >= 0) members[i].av = hasMedia();
      if (isHub) { emitRoster(); broadcast({ t: "roster", d: members.slice() }); }
      else { toHub({ t: "meta", d: { av: hasMedia() } }); scheduleReconcile(); }
    },
    // Reflect a local identity (name) change into the roster.
    updateIdentity(next) {
      identity = { ...identity, ...next };
      const i = members.findIndex((x) => x.id === identity.id);
      if (i >= 0) { members[i].name = identity.name; members[i].color = identity.color; }
      if (isHub) { emitRoster(); broadcast({ t: "roster", d: members.slice() }); }
    },
    leave() {
      leaving = true;
      clearTimeout(reelectTimer); clearTimeout(reconcileTimer);
      closeAllMedia();
      try { for (const c of clientConns.values()) c.close(); } catch {}
      clientConns.clear();
      try { if (hubConn) hubConn.close(); } catch {}
      try { if (peer) peer.destroy(); } catch {}
      peer = null;
    },
  };
}
