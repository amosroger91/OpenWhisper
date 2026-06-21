// ============================================================
//  watch.js  —  synced YouTube "watch together" via the YouTube
//  IFrame Player API. We own the local player; main.js syncs the
//  {videoId, playing, time} state across the room over the data
//  channel. An `applyingRemote` guard stops remote-applied state
//  changes from echoing back out.
// ============================================================
let player = null;
let ready = false;
let readyCbs = [];
let onStateCb = null;
let applyingRemote = false;
let applyTimer = null;

function suppress(ms = 700) {
  applyingRemote = true;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => { applyingRemote = false; }, ms);
}

export function initYouTube(containerId, onState) {
  onStateCb = onState;
  if (window.YT && window.YT.Player) return create(containerId);
  if (!document.getElementById("yt-api")) {
    const s = document.createElement("script");
    s.id = "yt-api"; s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  }
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch {} create(containerId); };
}

function create(containerId) {
  if (player) return;
  player = new YT.Player(containerId, {
    width: "100%", height: "100%",
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
    events: {
      onReady: () => { ready = true; readyCbs.forEach((f) => f()); readyCbs = []; },
      onStateChange: (e) => {
        if (applyingRemote || !onStateCb) return;
        // 1 = playing, 2 = paused, 0 = ended
        if (e.data === 1) onStateCb("play", currentTime());
        else if (e.data === 2) onStateCb("pause", currentTime());
        else if (e.data === 0) onStateCb("ended", currentTime());
      },
    },
  });
}
function whenReady(f) { if (ready) f(); else readyCbs.push(f); }

export function loadVideo(id, startAt = 0, play = true) {
  whenReady(() => {
    suppress(1400);
    if (play) player.loadVideoById({ videoId: id, startSeconds: Math.max(0, startAt) });
    else player.cueVideoById({ videoId: id, startSeconds: Math.max(0, startAt) });
  });
}
export function play() { whenReady(() => { suppress(); try { player.playVideo(); } catch {} }); }
export function pause() { whenReady(() => { suppress(); try { player.pauseVideo(); } catch {} }); }
export function seek(sec) { whenReady(() => { suppress(); try { player.seekTo(Math.max(0, sec), true); } catch {} }); }
export function stop() { whenReady(() => { suppress(); try { player.stopVideo(); } catch {} }); }
export function currentTime() { try { return player && player.getCurrentTime ? player.getCurrentTime() : 0; } catch { return 0; } }
export function currentVideo() { try { const d = player.getVideoData(); return d && d.video_id; } catch { return null; } }
export function isReady() { return ready; }

// Pull the 11-char video id out of any YouTube URL (or accept a raw id).
export function extractId(input) {
  const s = String(input || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
