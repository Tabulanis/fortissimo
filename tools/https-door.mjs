// https-door.mjs — the game over HTTPS for the phone app (owner, 10-09: "do it" — the home-screen version).
// A phone only installs a page as an app from a secure address. This listens on :5181 with Void's house certificate
// (~/aidojo/shared/house-ca, the CA his phone already trusts from Castdeck) and passes everything to the game's own
// server on :5180 — pages, files, the editor's saves, and the live-reload socket. No packages, Node built-ins only.
//   node tools/https-door.mjs        (runs as the user service fortissimo-https.service)
import https from "node:https";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";

const CA = `${os.homedir()}/aidojo/shared/house-ca`, PORT = 5181, TO = { host: "127.0.0.1", port: 5180 };
const server = https.createServer({ cert: fs.readFileSync(`${CA}/void.crt`), key: fs.readFileSync(`${CA}/void.key`) }, (req, res) => {
  const up = http.request({ ...TO, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${TO.port}` } }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" }); res.end("Fortissimo's game server (:5180) isn't running."); });
  req.pipe(up);
});
server.on("upgrade", (req, sock, head) => {   // the dev server's live-reload websocket
  const up = net.connect(TO.port, TO.host, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries({ ...req.headers, host: `127.0.0.1:${TO.port}` }).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  const end = () => { up.destroy(); sock.destroy(); }; up.on("error", end); sock.on("error", end);
});
server.listen(PORT, "0.0.0.0", () => console.log(`https://192.168.1.155:${PORT}/ → :${TO.port}`));
