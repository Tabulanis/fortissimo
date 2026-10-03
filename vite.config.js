import fs from "node:fs";
import path from "node:path";

// DEV ONLY: rounds are written in Hackbeat (its own folders). While developing,
// the game reads them from there, so a save in Hackbeat is a reload away:
//   /rounds/roundN.json      <- the Hackbeat project named by its "project" in rounds.json, else garden-roundN
//   /rounds/samples/<path>   <- Hackbeat/samples/<path> (else the pulled copy in public/)
// `node tools/pull-rounds.mjs` snapshots both into public/rounds for the repo/shipping.
const HACKBEAT = path.resolve(process.env.HACKBEAT_DIR || "../Hackbeat");
// which Hackbeat project a round plays: its "project" in rounds.json (round 1 = "Dope"), else garden-roundN
const roundProject = (file, n) => {
  try { return JSON.parse(fs.readFileSync("public/rounds/rounds.json", "utf8")).find((r) => r.file === file)?.project || `garden-round${n}`; }
  catch { return `garden-round${n}`; }
};
const inside = (root, rel) => { const p = path.resolve(root, rel); return p.startsWith(root + path.sep) ? p : null; };
const hackbeatRounds = {
  name: "hackbeat-rounds",
  configureServer(server) {
    server.middlewares.use("/rounds", (req, res, next) => {
      const rel = decodeURIComponent((req.url || "").split("?")[0]).replace(/^\/+/, "");
      let file = null;
      const m = rel.match(/^round(\d+)\.json$/);
      if (m) file = inside(path.join(HACKBEAT, "projects"), `${roundProject(rel, m[1])}.json`);
      // Hackbeat's own copy first (edit there, reload here); the pulled copy in public/ is the fallback
      else if (rel.startsWith("samples/")) file = inside(path.join(HACKBEAT, "samples"), rel.slice(8));
      if (!file || !fs.existsSync(file)) return next();
      res.setHeader("Cache-Control", "no-store");
      if (file.endsWith(".json")) {
        // the samples embedded in a Hackbeat project are dead weight here: the game loads the files
        const { sampleData, ...lean } = JSON.parse(fs.readFileSync(file, "utf8"));
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(lean));
      }
      res.setHeader("Content-Type", "audio/wav");
      fs.createReadStream(file).pipe(res);
    });
  },
};

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

export default {
  plugins: [deviceLog, hackbeatRounds],
  server: { port: 5180, strictPort: true, host: true },
  preview: { port: 5181 },
};
