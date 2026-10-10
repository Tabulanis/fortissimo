/* native.js — what the PACKAGED app needs that a web page doesn't (10-09, "make it professional"):
     BACK BUTTON (Android): opens / closes the settings instead of killing the game — the same as Escape;
     SCREEN AWAKE while a song plays (the Wake Lock API, which the Android WebView has), let go when it ends or the app hides;
     HAPTICS: a tiny buzz on a touch hit (navigator.vibrate), never on a keyboard.
   Every piece is optional: in a plain browser each one simply does nothing. The Capacitor App plugin is loaded only inside the
   app (window.Capacitor exists there), so the web build never carries it.
     initNative({ onBack }) ; wake.on() / wake.off() ; haptic(kind) */
export function initNative({ onBack } = {}) {
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    import("@capacitor/app").then(({ App }) => {
      App.addListener("backButton", () => { if (onBack) onBack(); });   // never App.exitApp(): the game decides
    }).catch(() => { /* no plugin: the system back closes the app, as before */ });
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) wake.off(); });
}
let lock = null;
export const wake = {
  async on() { try { if (!lock && navigator.wakeLock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch { lock = null; } },
  off() { try { if (lock) lock.release(); } catch { /* fine */ } lock = null; },
};
export function haptic(kind = "hit") {
  if (!navigator.vibrate || !("ontouchstart" in window)) return;
  try { navigator.vibrate(kind === "miss" ? 0 : kind === "perfect" ? 12 : 8); } catch { /* fine */ }
}
