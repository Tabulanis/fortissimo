import fs from "node:fs";
import path from "node:path";

// (2026-10-07: the dev server no longer reads ../Hackbeat — the game plays only its own files:
// public/songs (songs) and public/rounds/samples (sounds). See src/game/roundfiles.js.)

// DEV ONLY: devices (tablets, phones) report how far the game got while
// loading, so a crash on a device we can't see still tells us where it died.
// The game sends one line per step to /__log; it lands in device.log here.
const deviceLog = {
  name: "device-log",
  configureServer(server) {
    server.middlewares.use("/__log", (req, res) => {
      let body = "";
      req.on("data", (c) => { if (body.length < 4000) body += c; });
      req.on("end", () => {
        const who = (req.socket.remoteAddress || "?").replace("::ffff:", "");
        fs.appendFileSync("device.log", `${new Date().toISOString()} ${who} ${body.slice(0, 4000)}\n`);
        res.statusCode = 204;
        res.end();
      });
    });
  },
};

// DEV ONLY: the dev-mode editor saves the level layout here (src/scene/editables.js):
// POST /__level with the edits JSON -> public/levels/edits.json (in git, applied on every load)
const levelSave = {
  name: "level-save",
  configureServer(server) {
    server.middlewares.use("/__level", (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
      let body = "";
      req.on("data", (c) => { if (body.length < 2_000_000) body += c; });
      req.on("end", () => {
        try {
          const j = JSON.parse(body);
          fs.mkdirSync("public/levels", { recursive: true });
          fs.writeFileSync("public/levels/edits.json", JSON.stringify(j, null, 1) + "\n");
          fs.appendFileSync("device.log", `${new Date().toISOString()} editor {"step":"level saved","objects":${Object.keys(j).length}}\n`);
          res.statusCode = 204; res.end();
        } catch (e) { res.statusCode = 400; res.end(String(e)); }
      });
    });
  },
};

// DEV ONLY: the editor's palette asks what models exist (GET /__models -> ["Cliffs", "Gate", ...])
const modelList = {
  name: "model-list",
  configureServer(server) {
    server.middlewares.use("/__models", (req, res) => {
      const names = fs.readdirSync("public/models").filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4)).sort();
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(names));
    });
  },
};

export default {
  plugins: [deviceLog, levelSave, modelList],
  server: { port: 5180, strictPort: true, host: true },
  preview: { port: 5181 },
};
