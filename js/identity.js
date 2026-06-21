// ============================================================
//  identity.js  —  accountless identity. Everyone gets a random
//  nickname + a colored avatar on first visit, persisted locally.
//  No signup, no server: this is just a label you carry around.
// ============================================================
import { loadIdentity, saveIdentity } from "./storage.js";

const ADJECTIVES = [
  "Lucid", "Glossy", "Velvet", "Cobalt", "Mellow", "Sunny", "Brave", "Quiet",
  "Wired", "Frosty", "Amber", "Neon", "Plush", "Cosmic", "Jolly", "Swift",
  "Dreamy", "Crisp", "Lunar", "Gentle", "Breezy", "Vivid", "Snug", "Witty",
];
const ANIMALS = [
  "Otter", "Falcon", "Koala", "Marten", "Heron", "Lynx", "Gecko", "Panda",
  "Raven", "Tapir", "Wombat", "Fox", "Moth", "Newt", "Quokka", "Seal",
  "Stork", "Yak", "Civet", "Ibis", "Puffin", "Bison", "Crane", "Mole",
];
// The Luna palette — warm, optimistic, readable on white.
const COLORS = [
  "#1668e0", "#e0631a", "#3a9b35", "#b5179e", "#0f9bb0", "#d4145a",
  "#7048e8", "#e8a90c", "#2f9e44", "#1098ad", "#e8590c", "#5c7cfa",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomId() {
  // A stable per-person id so presence/roster can dedupe across reconnects.
  return "m-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function makeRandomIdentity() {
  return {
    id: randomId(),
    name: pick(ADJECTIVES) + " " + pick(ANIMALS),
    color: pick(COLORS),
  };
}

// The current identity — loaded from storage or freshly minted (and saved).
export function getIdentity() {
  let id = loadIdentity();
  if (!id || !id.id || !id.name) {
    id = makeRandomIdentity();
    saveIdentity(id);
  }
  return id;
}

export function setName(name) {
  const id = getIdentity();
  id.name = String(name || "").trim().slice(0, 24) || id.name;
  saveIdentity(id);
  return id;
}

export function reroll() {
  const fresh = makeRandomIdentity();
  // Keep the same stable id so we don't look like a different person mid-session.
  fresh.id = getIdentity().id;
  saveIdentity(fresh);
  return fresh;
}

export function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return ((parts[0] || "")[0] || "?").toUpperCase() + ((parts[1] || "")[0] || "").toUpperCase();
}

export const PALETTE = COLORS;
