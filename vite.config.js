import fs from "node:fs";

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
  plugins: [deviceLog],
  server: { port: 5180, strictPort: true, host: true },
  preview: { port: 5181 },
};
