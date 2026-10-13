/* base.js — WHERE THE GAME IS SERVED FROM (10-13: the GitHub Pages demo lives at /fortissimo/, not at the root). The game asks for its
   files by root paths ("/models/Gate.glb", "/songs/songs.json"); here those get the base in front when the build has one
   (vite `base`, BASE env at build time). At the root (dev, play.sh, the apps) nothing changes. Imported FIRST by main.js. */
export const BASE = import.meta.env.BASE_URL || "/";
export const withBase = (u) => (BASE !== "/" && typeof u === "string" && u.startsWith("/") && !u.startsWith("//") && !u.startsWith(BASE) ? BASE.slice(0, -1) + u : u);
if (BASE !== "/") {
  const f = window.fetch.bind(window);
  window.fetch = (input, init) => f(typeof input === "string" ? withBase(input) : input, init);
}
