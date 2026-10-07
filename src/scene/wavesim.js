/* wavesim.js — WATER AS CLOTH (owner, 2026-10-07: "I used to use silk and a cloth simulator
   to do cheap water — do something like that").

   A square patch of the sea is a grid of masses on springs (the silk): each cell's height is
   pulled toward its four neighbours (the 2D wave equation, which IS a cloth with no
   stretch), damped a little, absorbing at the edges so waves don't echo off the patch
   border. Things PRESS it (the hydra's necks, a strike) and the waves spread, cross, and
   pile up by themselves — the part a ring hack can't do. Stepped on the CPU each frame
   (160×160 = 25k cells, well under a millisecond) and handed to the sea shader as a float
   texture that displaces the fine mesh.
     new WaveSim({ x0, z0, size, n })  world patch, n cells a side
     press(x, z, amount, radius)       push the surface down (amount in metres) around a point
     step(dt)                          advance; call every frame
     texture                           THREE.DataTexture of heights (R, float), updated each step
     heightAt(x, z)                    the simulated height at a world point (0 outside the patch) */
import * as THREE from "three";

export class WaveSim {
  constructor({ x0 = -24, z0 = 14, size = 48, n = 160, speed = 3.2, damping = 0.35 } = {}) {
    this.x0 = x0; this.z0 = z0; this.size = size; this.n = n; this.dx = size / (n - 1);
    this.c = speed; this.damping = damping;
    this.h = new Float32Array(n * n); this.v = new Float32Array(n * n);
    this.texture = new THREE.DataTexture(this.h, n, n, THREE.RedFormat, THREE.FloatType);
    this.texture.minFilter = THREE.LinearFilter; this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping; this.texture.needsUpdate = true;
    // the absorbing rim: damping rises toward the edges over 10 cells
    this.rim = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const d = Math.min(i, j, n - 1 - i, n - 1 - j);
      this.rim[j * n + i] = d >= 10 ? 0 : (1 - d / 10) * 6;
    }
    this._acc = 0;
  }
  cell(x, z) { return [(x - this.x0) / this.dx, (z - this.z0) / this.dx]; }
  inside(x, z) { return x >= this.x0 && x <= this.x0 + this.size && z >= this.z0 && z <= this.z0 + this.size; }
  press(x, z, amount, radius = 0.9) {
    if (!this.inside(x, z)) return false;
    const [cx, cz] = this.cell(x, z), r = radius / this.dx, n = this.n;
    const i0 = Math.max(1, Math.floor(cx - r)), i1 = Math.min(n - 2, Math.ceil(cx + r)), j0 = Math.max(1, Math.floor(cz - r)), j1 = Math.min(n - 2, Math.ceil(cz + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d2 = ((i - cx) ** 2 + (j - cz) ** 2) / (r * r);
      if (d2 < 1) this.v[j * n + i] -= amount * (1 - d2) * (1 - d2) * 6;   // a velocity kick: the surface dips, then the ring runs out
    }
    return true;
  }
  step(dt) {
    // fixed substeps keep the spring stable: c * h / dx must stay under ~0.7
    const n = this.n, h = this.h, v = this.v, rim = this.rim;
    const hs = Math.min(0.012, 0.6 * this.dx / this.c);
    this._acc = Math.min(this._acc + dt, 0.1);
    const k = (this.c * this.c) / (this.dx * this.dx);
    while (this._acc >= hs) {
      this._acc -= hs;
      for (let j = 1; j < n - 1; j++) {
        const row = j * n;
        for (let i = 1; i < n - 1; i++) {
          const p = row + i;
          const lap = h[p - 1] + h[p + 1] + h[p - n] + h[p + n] - 4 * h[p];
          v[p] = (v[p] + k * lap * hs) * (1 - (this.damping + rim[p]) * hs);
        }
      }
      for (let p = 0; p < n * n; p++) h[p] += v[p] * hs;
    }
    this.texture.needsUpdate = true;
  }
  heightAt(x, z) {
    if (!this.inside(x, z)) return 0;
    const [cx, cz] = this.cell(x, z), i = Math.min(this.n - 2, Math.max(0, Math.floor(cx))), j = Math.min(this.n - 2, Math.max(0, Math.floor(cz)));
    const fx = cx - i, fz = cz - j, n = this.n, h = this.h;
    return (h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx) * (1 - fz) + (h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx) * fz;
  }
}
