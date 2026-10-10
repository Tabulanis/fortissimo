#!/usr/bin/env node
/* release.mjs — THE RELEASE WIZARD (owner, 10-09: "make it professional… wizard-like in use").
   One command walks a release through, asking only what it must and defaulting the rest:
     npm run release            the wizard
     npm run check              just the checks + a web build (no version change, no git)
     --yes                      take every default (for scripts);  --skip-android  --skip-desktop  --no-push
   Steps: 1 checks (git, tools) → 2 version → 3 what changed → 4 web build → 5 Android (signed if a key is set up, else
   debug) → 6 desktop (if set up) → 7 commit + tag (+ push: GitHub Actions then builds every platform and makes the Release).
   Outputs land in out/<version>/. Nothing here ever holds a password: Android signing reads android/keystore.properties
   (gitignored), which the owner writes — step 5 tells them exactly how. */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
process.chdir(ROOT);
const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check"), YES = args.has("--yes");
const rl = readline.createInterface({ input: stdin, output: stdout });
const c = { g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", b: "\x1b[1m", d: "\x1b[2m", x: "\x1b[0m" };
const say = (s = "") => console.log(s), ok = (s) => say(`  ${c.g}✓${c.x} ${s}`), warn = (s) => say(`  ${c.y}!${c.x} ${s}`), bad = (s) => say(`  ${c.r}✗${c.x} ${s}`);
const step = (n, t) => say(`\n${c.b}${n}. ${t}${c.x}`);
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
const run = (cmd, argv, env = {}) => spawnSync(cmd, argv, { stdio: "inherit", env: { ...process.env, ...env } }).status === 0;
async function ask(q, def) { if (YES) return def; const a = (await rl.question(`  ${q}${def !== undefined ? ` ${c.d}[${def}]${c.x}` : ""}: `)).trim(); return a === "" ? def : a; }
async function yes(q, def = true) { const a = await ask(`${q} (y/n)`, def ? "y" : "n"); return /^y/i.test(a); }
const pkg = () => JSON.parse(fs.readFileSync("package.json", "utf8"));
const bump = (v, kind) => { const [a, b, d] = v.split(".").map(Number); return kind === "major" ? `${a + 1}.0.0` : kind === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${d + 1}`; };
const toolsEnv = () => {   // the home-folder Java + Android SDK (tools/env.sh)
  const jdk = fs.existsSync(path.join(process.env.HOME, ".local/opt")) ? fs.readdirSync(path.join(process.env.HOME, ".local/opt")).filter((d) => d.startsWith("jdk-21")).map((d) => path.join(process.env.HOME, ".local/opt", d)).pop() : null;
  const sdk = path.join(process.env.HOME, "Android/Sdk");
  return jdk && fs.existsSync(sdk) ? { JAVA_HOME: jdk, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, PATH: `${jdk}/bin:${sdk}/platform-tools:${process.env.PATH}` } : null;
};

say(`${c.b}Fortissimo — release wizard${c.x}  ${c.d}(${CHECK ? "check only" : "full release"})${c.x}`);

// ---- 1. checks ---------------------------------------------------------------------------------------------
step(1, "Checks");
let dirty = "";
try { dirty = sh("git status --porcelain"); } catch { bad("not a git repository"); process.exit(1); }
if (dirty && !CHECK) { warn(`uncommitted changes:\n${dirty.split("\n").slice(0, 8).map((l) => "      " + l).join("\n")}`); if (!(await yes("Include them in the release commit?", true))) { say("  Commit or stash first."); process.exit(1); } } else ok("working tree " + (dirty ? "has changes (check only — fine)" : "clean"));
const branch = sh("git rev-parse --abbrev-ref HEAD"); ok(`branch ${branch}`);
if (!fs.existsSync("node_modules")) { bad("node_modules missing — run: npm install"); process.exit(1); } ok("node_modules");
const env = toolsEnv(); if (env) ok("Java + Android SDK (home folder)"); else warn("no Java/Android SDK in the home folder — the Android step will be skipped (GitHub Actions still builds it)");
const ks = fs.existsSync("android/keystore.properties"); if (ks) ok("Android signing key set up"); else warn("no Android signing key yet — Android builds will be DEBUG (installable, not for the store)");
const desktopReady = fs.existsSync("desktop/main.cjs") && fs.existsSync("node_modules/electron"); if (desktopReady) ok("desktop (Electron) ready"); else warn("desktop not set up (npm i -D electron electron-builder) — skipped");

// ---- 2. version --------------------------------------------------------------------------------------------
let version = pkg().version;
if (!CHECK) {
  step(2, `Version (now ${version})`);
  say(`  patch ${c.d}${bump(version, "patch")} — fixes${c.x}   minor ${c.d}${bump(version, "minor")} — new things${c.x}   major ${c.d}${bump(version, "major")} — the big one${c.x}`);
  const kind = await ask("patch / minor / major, or a number", "patch");
  version = /^\d+\.\d+\.\d+$/.test(kind) ? kind : bump(version, /^(major|minor)$/.test(kind) ? kind : "patch");
  const p = pkg(); p.version = version; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
  // Android: versionName = ours, versionCode = one more than last time (Play requires it to climb)
  const g = "android/app/build.gradle";
  if (fs.existsSync(g)) { let s = fs.readFileSync(g, "utf8"); const code = +(/versionCode (\d+)/.exec(s) || [0, 0])[1] + 1;
    s = s.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${version}"`); fs.writeFileSync(g, s); ok(`Android versionCode ${code}`); }
  ok(`version ${version}`);
  // ---- 3. what changed ---------------------------------------------------------------------------------------
  step(3, "What changed");
  const last = (() => { try { return sh("git describe --tags --abbrev=0"); } catch { return ""; } })();
  const log = last ? sh(`git log ${last}..HEAD --pretty=format:"- %s"`) : sh(`git log -15 --pretty=format:"- %s"`);
  say(c.d + log.split("\n").slice(0, 12).map((l) => "    " + l.slice(0, 100)).join("\n") + c.x);
  const summary = await ask("One line for the players (Enter to use the commit list)", "");
  const entry = `## ${version} — ${new Date().toISOString().slice(0, 10)}\n\n${summary ? summary + "\n\n" : ""}${log}\n\n`;
  const cl = fs.existsSync("CHANGELOG.md") ? fs.readFileSync("CHANGELOG.md", "utf8") : "# Fortissimo — changes\n\n";
  fs.writeFileSync("CHANGELOG.md", cl.replace(/^(# [^\n]*\n\n)/, `$1${entry}`)); ok("CHANGELOG.md");
}

// ---- 4. web build ------------------------------------------------------------------------------------------
step(CHECK ? 2 : 4, "Web build");
if (!run("npx", ["vite", "build"])) { bad("build failed"); process.exit(1); }
const OUT = path.join("out", version); fs.mkdirSync(OUT, { recursive: true });
const webZip = path.join(OUT, `fortissimo-web-${version}.zip`); fs.rmSync(webZip, { force: true });
run("bash", ["-c", `cd dist && zip -qr ../${webZip} .`]); ok(`${webZip} (${(fs.statSync(webZip).size / 1048576).toFixed(0)} MB)`);
if (CHECK) { ok("check passed"); rl.close(); process.exit(0); }

// ---- 5. android --------------------------------------------------------------------------------------------
step(5, "Android");
if (args.has("--skip-android") || !env) warn("skipped");
else {
  if (!ks) {
    say(`  ${c.y}To ship to the Play Store the app must be signed with YOUR key. One-time setup (you type the passwords, nothing stores them but the file below):${c.x}
    1. make the key:   keytool -genkeypair -v -keystore ~/fortissimo-release.jks -alias fortissimo -keyalg RSA -keysize 2048 -validity 10000
    2. write android/keystore.properties (gitignored, keep it private; back the .jks up — losing it means never updating the app):
         storeFile=/home/${process.env.USER}/fortissimo-release.jks
         storePassword=…   keyAlias=fortissimo   keyPassword=…
    Building a DEBUG apk for now.`);
  }
  if (run("npx", ["cap", "sync", "android"], env)) {
    const task = ks ? ["assembleRelease", "bundleRelease"] : ["assembleDebug"];
    if (run("./gradlew", [...task, "-q"], { ...env, cwd: "android" }) || run("bash", ["-c", `cd android && ./gradlew ${task.join(" ")} -q`], env)) {
      for (const f of sh("find android/app/build/outputs -name '*.apk' -o -name '*.aab'").split("\n").filter(Boolean)) {
        const dest = path.join(OUT, `fortissimo-${version}-${path.basename(f).replace("app-", "")}`); fs.copyFileSync(f, dest); ok(`${dest} (${(fs.statSync(dest).size / 1048576).toFixed(0)} MB)`);
      }
    } else bad("gradle failed (see above)");
  } else bad("cap sync failed");
}

// ---- 6. desktop --------------------------------------------------------------------------------------------
step(6, "Desktop");
if (args.has("--skip-desktop") || !desktopReady) warn("skipped");
else if (run("npm", ["run", "desktop:build"])) { for (const f of fs.readdirSync("desktop/out").filter((f) => /\.(AppImage|deb|exe|dmg|zip)$/.test(f))) { fs.copyFileSync(path.join("desktop/out", f), path.join(OUT, f)); ok(path.join(OUT, f)); } }
else bad("desktop build failed");

// ---- 7. commit, tag, push ----------------------------------------------------------------------------------
step(7, "Commit and tag");
sh("git add -A package.json CHANGELOG.md android/app/build.gradle"); if (dirty && await yes("Also commit everything else that changed?", true)) sh("git add -A");
sh(`git commit -q -m "release v${version}"`); sh(`git tag -a v${version} -m "Fortissimo v${version}"`); ok(`tag v${version}`);
if (!args.has("--no-push") && await yes("Push to GitHub? (its Actions then build web + Android + desktop and publish the Release)", true)) {
  if (run("git", ["push", "-q"]) && run("git", ["push", "-q", "origin", `v${version}`])) ok("pushed — watch: gh run watch"); else bad("push failed");
}
say(`\n${c.b}Done. v${version} is in ${OUT}/${c.x}`);
say(`  Next: Play Console → upload the .aab (internal testing first). Phone test: adb install -r ${OUT}/*.apk`);
rl.close();
