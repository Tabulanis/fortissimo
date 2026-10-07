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

// DEV ONLY: the song-maker (src/ui/maker-ui.js) saves a whole LEVEL here: POST /__song with
// { slug, level, songs: [r1, r2, r3] } -> public/songs/<slug>-1..3.json, public/levels/<slug>.json, and the
// three rounds added to public/songs/songs.json (saving the same name again replaces them)
const songSave = {
  name: "song-save",
  configureServer(server) {
    server.middlewares.use("/__song", (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
      let body = "";
      req.on("data", (c) => { if (body.length < 5_000_000) body += c; });
      req.on("end", () => {
        try {
          const { slug, level, songs } = JSON.parse(body);
          if (!/^[a-z0-9-]{1,40}$/.test(slug) || !Array.isArray(songs) || songs.length !== 3 || songs.some((x) => x.format !== "fortissimo-song")) throw new Error("not a level");
          const files = songs.map((_, i) => `${slug}-${i + 1}.json`);
          songs.forEach((x, i) => fs.writeFileSync(`public/songs/${files[i]}`, JSON.stringify(x, null, 1) + "\n"));
          fs.mkdirSync("public/levels", { recursive: true });
          fs.writeFileSync(`public/levels/${slug}.json`, JSON.stringify({ ...level, rounds: files }, null, 1) + "\n");
          const list = JSON.parse(fs.readFileSync("public/songs/songs.json", "utf8")).filter((m) => !files.includes(m.file));
          songs.forEach((x, i) => list.push({ name: x.name, title: x.title, file: files[i], level: slug }));
          fs.writeFileSync("public/songs/songs.json", JSON.stringify(list, null, 1) + "\n");
          fs.appendFileSync("device.log", `${new Date().toISOString()} maker {"step":"level saved","slug":"${slug}","notes":[${songs.map((x) => x.notes.length)}]}\n`);
          res.statusCode = 204; res.end();
        } catch (e) { res.statusCode = 400; res.end(String(e)); }
      });
    });
  },
};

export default {
  plugins: [deviceLog, levelSave, modelList, songSave],
  server: { port: 5180, strictPort: true, host: true },
  preview: { port: 5181 },
};
