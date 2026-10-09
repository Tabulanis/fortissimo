// sw.js — the phone app's service worker (10-09, home-screen install). It only exists so Android treats Fortissimo as an app;
// it stores nothing and answers nothing itself (no respondWith) — every request goes to the game server as usual, so the dev
// server's live reload and the editor's saves are untouched. Offline play comes with the real packaged app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
