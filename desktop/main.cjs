/* desktop/main.cjs — Fortissimo as a DESKTOP APP (Windows / macOS / Linux, 10-09, "deployment across multiple platforms").
   Electron opens the built game (dist/) in its own window: no browser bars, fullscreen on F11, the same code as the web.
   Built by electron-builder (`npm run desktop:build`, config in package.json → "build"); the release wizard and GitHub
   Actions call that. Gamepads, the keyboard and WebGL all work as in Chrome, which this is. */
const { app, BrowserWindow, globalShortcut } = require("electron");
const path = require("node:path");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");   // a game: sound without a click first

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540, backgroundColor: "#000000", autoHideMenuBar: true, title: "Fortissimo",
    icon: path.join(__dirname, "..", "public", "app", "icon-512.png"),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  globalShortcut.register("F11", () => win.setFullScreen(!win.isFullScreen()));
}
app.whenReady().then(() => { createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
