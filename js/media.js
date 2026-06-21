// ============================================================
//  media.js  —  microphone / camera capture helpers for the
//  WebRTC voice + video mesh. This module only owns the *local*
//  capture stream; room.js wires the peer-to-peer calls and
//  surfaces remote streams to the UI.
// ============================================================
let localStream = null;
let state = { audio: false, video: false };

export function getState() { return { ...state }; }
export function getLocalStream() { return localStream; }
export function hasMedia() { return !!localStream && (state.audio || state.video); }

// Build (or rebuild) the local capture stream to match the requested
// audio/video flags. Returns the stream (or null if nothing is on).
// Throws if the user denies permission or no device exists.
export async function setMedia({ audio, video }) {
  const want = { audio: !!audio, video: !!video };

  // Nothing requested → tear the stream down entirely.
  if (!want.audio && !want.video) {
    stopLocal();
    state = want;
    return null;
  }

  // Re-capture from scratch. Simple and reliable across browsers; the
  // mesh recalls peers with the new stream (room.js handles that).
  const fresh = await navigator.mediaDevices.getUserMedia({
    audio: want.audio,
    video: want.video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false,
  });
  stopLocal();
  localStream = fresh;
  state = want;
  return localStream;
}

export function stopLocal() {
  if (localStream) {
    for (const t of localStream.getTracks()) { try { t.stop(); } catch {} }
  }
  localStream = null;
}

// Convenience toggles used by the UI; return the resulting state.
export async function toggleAudio() { return setMedia({ audio: !state.audio, video: state.video }).then(() => getState()); }
export async function toggleVideo() { return setMedia({ audio: state.audio, video: !state.video }).then(() => getState()); }
