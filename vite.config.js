import fs from "node:fs";
import path from "node:path";

// DEV ONLY: rounds are written in Hackbeat (its own folders). While developing,
// the game reads them from there, so a save in Hackbeat is a reload away:
//   /rounds/roundN.json      <- Hackbeat/projects/garden-roundN.json (if it exists)
//   /rounds/samples/<path>   <- Hackbeat/samples/<path> (if the game has no copy)
// `node tools/pull-rounds.mjs` snapshots both into public/rounds for the repo/shipping.
const HACKBEAT = path.resolve(process.env.HACKBEAT_DIR || "../Hackbeat");
const inside = (root, rel) => { const p = path.resolve(root, rel); return p.startsWith(root + path.sep) ? p : null; };
const hackbeatRounds = {
  name: "hackbeat-rounds",
  configureServer(server) {
    server.middlewares.use("/rounds", (req, res, next) => {
      const rel = decodeURIComponent((req.url || "").split("?")[0]).replace(/^\/+/, "");
      let file = null;
      const m = rel.match(/^round(\d+)\.json$/);
      if (m) file = inside(path.join(HACKBEAT, "projects"), `garden-round${m[1]}.json`);
      else if (rel.startsWith("samples/") && !fs.existsSync(path.resolve("public/rounds", rel))) file = inside(path.join(HACKBEAT, "samples"), rel.slice(8));
      if (!file || !fs.existsSync(file)) return next();
      res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "audio/wav");
      res.setHeader("Cache-Control", "no-store");
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
