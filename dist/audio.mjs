// Presentation-only audio. This module deliberately never reads or changes simulation state.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function readAudioPreference(store = globalThis.localStorage) {
  try {
    const raw = JSON.parse(store?.getItem("wm-audio-v1") || "null");
    if (!raw || typeof raw !== "object") return { enabled: false, volume: 0.7 };
    return { enabled: raw.enabled === true, volume: clamp(Number(raw.volume) || 0.7, 0, 1) };
  } catch {
    return { enabled: false, volume: 0.7 };
  }
}

export function writeAudioPreference(preference, store = globalThis.localStorage) {
  try { store?.setItem("wm-audio-v1", JSON.stringify({ enabled: !!preference.enabled, volume: clamp(Number(preference.volume) || 0, 0, 1) })); } catch {}
}

export class AudioDirector {
  constructor({ AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext, maxQueue = 160, maxVoices = 24 } = {}) {
    this.AudioContext = AudioContext;
    this.maxQueue = maxQueue;
    this.maxVoices = maxVoices;
    this.preference = readAudioPreference();
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.queue = [];
    this.lastSeq = 0;
    this.voices = new Set();
    this.stats = { received: 0, consumed: 0, coalesced: 0, dropped: 0, stale: 0, duplicate: 0 };
  }
  get enabled() { return this.preference.enabled; }
  get status() { return !this.enabled ? "muted" : !this.context ? "blocked" : this.context.state === "running" ? "listening" : this.context.state || "blocked"; }
  setPreference(next) {
    this.preference = { ...this.preference, ...next, enabled: !!next.enabled, volume: clamp(Number(next.volume ?? this.preference.volume), 0, 1) };
    writeAudioPreference(this.preference);
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.preference.volume : 0, this.context.currentTime, 0.015);
    if (!this.enabled) this.clear({ stop: true, stale: true });
  }
  async resumeFromGesture() {
    if (!this.enabled || !this.AudioContext) return false;
    try {
      this.context ||= new this.AudioContext();
      this.makeBus();
      if (this.context.state === "suspended") await this.context.resume();
      return this.context.state === "running";
    } catch { return false; }
  }
  makeBus() {
    if (this.master) return;
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? this.preference.volume : 0;
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -14; this.compressor.knee.value = 12; this.compressor.ratio.value = 8;
    this.master.connect(this.compressor); this.compressor.connect(this.context.destination);
  }
  reset() { this.clear({ stop: true, stale: true }); this.lastSeq = 0; }
  clear({ stop = false, stale = false } = {}) {
    if (stale) this.stats.stale += this.queue.length;
    this.queue.length = 0;
    if (stop) for (const voice of [...this.voices]) { try { voice.stop(); } catch {} }
  }
  ingest(events = []) {
    for (const event of events) {
      if (!event || !Number.isFinite(event.seq) || event.seq <= this.lastSeq) { this.stats.duplicate++; continue; }
      this.lastSeq = event.seq; this.stats.received++;
      if (!this.enabled || !this.context || this.context.state !== "running") { this.stats.stale++; continue; }
      if (this.queue.length >= this.maxQueue) { this.queue.shift(); this.stats.dropped++; }
      this.queue.push(event);
    }
  }
  drain({ speed = 1, hidden = false } = {}) {
    if (hidden || !this.enabled || !this.context || this.context.state !== "running") { this.clear({ stale: true }); return; }
    const queued = this.queue.splice(0, Math.min(this.queue.length, 48));
    if (this.queue.length) { this.stats.dropped += this.queue.length; this.queue.length = 0; }
    const bursts = new Map();
    for (const event of queued) {
      if (event.kind === "fire" && speed > 1 && ["gatling", "machinegun"].includes(event.weapon)) {
        const key = `${event.weapon}:${event.side}:${Math.floor(event.t * 12)}`;
        const existing = bursts.get(key);
        if (existing) { existing.count++; this.stats.coalesced++; continue; }
        bursts.set(key, { ...event, count: 1 });
      } else this.play(event);
    }
    for (const event of bursts.values()) this.play(event);
  }
  play(event) {
    this.stats.consumed++;
    if (event.kind === "fire") return this.weapon(event.weapon, event.count || 1);
    if (event.kind === "impact") return this.noise(0.07, 0.035, 900);
    if (event.kind === "module-loss" || event.kind === "core-loss") return this.noise(0.24, 0.08, 700);
    if (event.kind === "terminal") return this.tone(event.winner === 0 ? 620 : 180, 0.22, 0.045, "triangle");
  }
  connect(node, gain = 0.03, duration = 0.12) {
    if (this.voices.size >= this.maxVoices) { this.stats.dropped++; return null; }
    const g = this.context.createGain(), now = this.context.currentTime;
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(Math.max(.0001, gain), now + .004); g.gain.exponentialRampToValueAtTime(.0001, now + duration);
    node.connect(g); g.connect(this.master); this.voices.add(node);
    node.onended = () => { this.voices.delete(node); try { node.disconnect(); g.disconnect(); } catch {} };
    return { g, now };
  }
  tone(hz, duration, gain, type = "sine", endHz = hz) {
    const o = this.context.createOscillator(), wire = this.connect(o, gain, duration);
    if (!wire) return; o.type = type; o.frequency.setValueAtTime(clamp(hz, 20, 18000), wire.now); o.frequency.exponentialRampToValueAtTime(clamp(endHz, 20, 18000), wire.now + duration); o.start(wire.now); o.stop(wire.now + duration);
  }
  noise(duration, gain, cutoff) {
    const size = Math.max(1, Math.floor(this.context.sampleRate * duration)), buffer = this.context.createBuffer(1, size, this.context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), wire = this.connect(source, gain, duration);
    if (!wire) return; filter.type = "lowpass"; filter.frequency.value = cutoff; source.buffer = buffer; source.disconnect(); source.connect(filter); filter.connect(wire.g); source.start(wire.now); source.stop(wire.now + duration);
  }
  weapon(id = "cannon", count = 1) {
    const burst = Math.min(count, 4);
    if (id === "laser") { this.tone(740, .13, .028, "sine", 980); return; }
    if (id === "railgun") { this.tone(180, .18, .035, "sawtooth", 1280); this.noise(.05, .018, 5200); return; }
    if (id === "plasma") { this.tone(170, .2, .04, "sine", 90); this.noise(.1, .015, 800); return; }
    if (["rocket", "mortar"].includes(id)) { this.noise(.18, .045, id === "rocket" ? 700 : 450); this.tone(id === "rocket" ? 140 : 95, .16, .025, "sawtooth", 50); return; }
    if (["tesla", "emp"].includes(id)) { this.noise(.08, .02, 4200); this.tone(id === "tesla" ? 360 : 130, .16, .027, "triangle", 80); return; }
    if (id === "flame") { this.noise(.11, .03, 1600); return; }
    if (id === "cryo") { this.noise(.1, .02, 6200); this.tone(1200, .14, .018, "sine", 720); return; }
    if (["gatling", "machinegun"].includes(id)) { this.tone(id === "gatling" ? 220 : 330, .035 + burst * .008, .015 + burst * .003, "square", 90); this.noise(.025, .01, 3200); return; }
    if (["flak", "shredder"].includes(id)) { this.noise(.08, .032, 3000); return; }
    if (id === "mine") { this.tone(110, .13, .022, "triangle", 70); return; }
    this.tone(145, .07, .032, "square", 55); this.noise(.045, .018, 2300);
  }
}
