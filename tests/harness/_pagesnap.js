// pagesnap — a PHOTO OF THE PAGE (HTML menus included, not just the 3D canvas) for harnesses: html2canvas renders the iframe's document,
// the game canvas is drawn in underneath first. snap(w, tag) posts a PNG to the sink as png/<tag>.
let h2c = null;
export async function snap(w, tag) {
  h2c ||= (await import("https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.8/+esm")).default;
  const d = w.document, gl = d.querySelector("canvas#stage") || d.querySelector("canvas");
  const shot = await h2c(d.body, { backgroundColor: null, width: w.innerWidth, height: w.innerHeight, windowWidth: w.innerWidth, windowHeight: w.innerHeight, scale: 1, logging: false,
    ignoreElements: (el) => el === gl });
  const c = d.createElement("canvas"); c.width = w.innerWidth; c.height = w.innerHeight; const x = c.getContext("2d");
  if (gl) { try { x.drawImage(gl, 0, 0, c.width, c.height); } catch { /* tainted: menu only */ } }
  x.drawImage(shot, 0, 0);
  await fetch("http://127.0.0.1:8899/png/" + tag, { method: "POST", body: c.toDataURL("image/png") });
}
