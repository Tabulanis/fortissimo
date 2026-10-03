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
      // a layer repeats every `bars` bars (a long melody take); startBar is in bars
      const bars = layer.bars || 1, period = this.barDur * bars;
      const kMin = Math.round((layer.startBar || 0) / bars);
      for (const h of layer.hits) {
        let k = Math.ceil((fromT - first - h.pos) / period);
        if (k < kMin) k = kMin;
        for (;;) {
          const t = first + k * period + h.pos;
          if (t >= toT) break;
          if (t >= fromT) out.push({ lane: h.lane, time: t, velocity: h.velocity, midi: h.midi });
          k++;
        }
      }
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }
}
