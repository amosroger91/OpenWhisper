# OpenWhisper

<p align="center">
  <a href="https://amosroger91.github.io/OpenWhisper/">
    <img src="https://img.shields.io/badge/%E2%96%B6%20%20OPEN%20THE%20APP-Drop%20in%20%26%20talk-5c7cfa?style=for-the-badge&labelColor=2b3a67&color=5c7cfa" alt="Open OpenWhisper" height="62" />
  </a>
</p>

<h3 align="center">🗨️ <a href="https://amosroger91.github.io/OpenWhisper/">amosroger91.github.io/OpenWhisper</a></h3>

**Drop in and talk.** A serverless, account-free chat space you can host on GitHub Pages. Match with a random stranger or join a community room — **text, voice, video, GIFs, listen-together radio, synced YouTube, and shared audio** — with no signup, no login, and no backend.

Open the page, you get a random nickname, and you're in.

---

## What it does

- **Live online count** — the landing page shows how many people are using OpenWhisper right now.
- **Profile** — pick a display name and upload a profile photo (or keep the random name + colored avatar). All stored locally.
- **Quick Match** — get paired with the next random person who's also looking, for a private 1-on-1 (text + voice + video).
- **Community Rooms** — pick from a curated list (Lounge, The Galaxy Gateway, Dem Church Bois, Wellspring Studio, Late Night, Music). Everyone who picks the same room lands together.
- **Voice & video** — toggle your mic/camera; a WebRTC mesh connects everyone in the room. (Auto-paused above ~8 people to keep things smooth — text and radio keep working.)
- **Images & files** — attach, paste, or drag-and-drop. Images are auto-downscaled and render inline; any file (≤6 MB) sends as a download chip. Paste an image **link** and it renders too.
- **Emoji reactions** — react to any message with 👍❤️😂…; reactions sync to everyone and persist with the message.
- **GIFs** — a GIF search button next to emoji (powered by Tenor); pick one and it sends inline + animated. Uploaded `.gif` files keep their animation too.
- **Listen together** — a music-player-style control: pick an internet radio station (lofi, jazz, rock, country, classical, electronic, pop, …) and it plays for the whole room, in sync, with a live "now playing" + equalizer.
- **Watch together (YouTube)** — paste a YouTube link and an embedded player appears for everyone, with synced play / pause / seek.
- **Shared audio** — share an audio file (≤6 MB) and it plays in sync for the whole room.
- **One thing at a time** — the radio, a YouTube video, and shared audio are mutually exclusive: starting one pauses the others across the room.
- **History** — recent messages are kept on your device and replayed when you (or a newly-elected host) return. Best-effort, not guaranteed.
- **No accounts** — your identity is a random name + color stored only in your browser. Rename or reroll anytime.

The UI uses the **Bliss** design system (a Windows XP "Luna" homage) — switch between the Blue / Olive / Silver schemes from the toolbar.

---

## How it works (no server)

GitHub Pages only serves static files, so OpenWhisper is pure browser P2P:

- **[PeerJS](https://peerjs.com/)** provides WebRTC data + media connections through a free public broker — no backend to run.
- Each room is a **star topology**: the first person in claims the room's well-known peer-id and becomes the **hub**, relaying chat / presence / radio to everyone and handing new joiners the recent history. If the hub leaves, the others race to take over (history survives because every member saves what it sees).
- **Quick Match** uses the same trick for a tiny lobby that pairs people off into a private room.
- **Voice/video** is a full mesh layered on top — members dial each other directly (lower peer-id initiates, to avoid duplicate calls).

### Modules

| File | Role |
|------|------|
| `index.html` / `css/app.css` | Bliss-themed UI shell |
| `js/main.js` | UI controller — wires everything together |
| `js/identity.js` | random nickname + avatar, persisted locally |
| `js/storage.js` | localStorage: identity, recent rooms, capped per-room history |
| `js/lobby.js` | accountless Quick-Match matchmaking |
| `js/room.js` | the star-topology room: relay, presence, history, hub re-election, A/V mesh |
| `js/media.js` | mic/camera capture |
| `js/radio.js` | listen-together internet radio (Radio Browser API) |
| `js/gifs.js` | GIF search (Tenor API) |
| `js/watch.js` | synced YouTube watch-together (IFrame API) |
| `css/bliss.css`, `js/bliss.js` | the Bliss design system |

---

## Run it locally

WebRTC and `getUserMedia` need a secure context, so use `http://localhost` (not `file://`):

```sh
# any static server works
python -m http.server 8000
# then open http://localhost:8000
```

To actually try matchmaking / rooms, open it in **two** browser windows (or two devices).

## Deploy to GitHub Pages

Push to `main`, then in the repo **Settings → Pages**, set the source to **Deploy from a branch → `main` / root**. The site goes live at `https://amosroger91.github.io/OpenWhisper/`.

---

## Limitations

- The public PeerJS broker is best-effort; if it's down or rate-limited, connections may fail. For heavy use you'd self-host a PeerJS server or move presence to a shared store (Supabase/Firebase).
- A/V is a mesh, so it's meant for small rooms (capped at ~8).
- History lives only in browsers — if everyone who has a room's history is gone, it starts fresh.

## License

MIT. Bliss is a design study and homage; not affiliated with Microsoft. "Windows XP" and "Luna" are referenced descriptively.
