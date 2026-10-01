export class Loops {
  constructor(barDur) {
    this.barDur = barDur;
    this._layers = [];
  }

  add(layer) { this._layers.push(layer); }
  get count() { return this._layers.length; }
  clear() { this._layers = []; }

  events(fromT, toT, first) {
    const out = [];
    for (const layer of this._layers) {
      for (const h of layer.hits) {
        let k = Math.ceil((fromT - first - h.pos) / this.barDur);
        if (k < layer.startBar) k = layer.startBar;
        for (;;) {
          const t = first + k * this.barDur + h.pos;
          if (t >= toT) break;
          if (t >= fromT) out.push({ lane: h.lane, time: t, velocity: h.velocity });
          k++;
        }
      }
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }
}
