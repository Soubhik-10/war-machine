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
    if (event.kind === "impact") return this.impact(event.weapon);
    if (event.kind === "thermal") return this.thermal(event.phase);
    if (event.kind === "module-loss" || event.kind === "core-loss") return this.impact(event.weapon, true);
    if (event.kind === "terminal") return this.tone(event.winner === 0 ? 620 : 180, 0.22, 0.045, "triangle", event.winner === 0 ? 920 : 92);
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
  noise(duration, gain, cutoff, endCutoff = cutoff, type = "lowpass") {
    const size = Math.max(1, Math.floor(this.context.sampleRate * duration)), buffer = this.context.createBuffer(1, size, this.context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), wire = this.connect(source, gain, duration);
    if (!wire) return; filter.type = type; filter.frequency.setValueAtTime?.(cutoff, wire.now); filter.frequency.exponentialRampToValueAtTime?.(Math.max(20, endCutoff), wire.now + duration); filter.frequency.value = cutoff; source.buffer = buffer; source.disconnect(); source.connect(filter); filter.connect(wire.g); source.start(wire.now); source.stop(wire.now + duration);
  }
  impact(id = "cannon", destroyed = false) {
    const scale = destroyed ? 1.45 : 1;
    if (id === "laser") { this.tone(1780, .06, .018 * scale, "sine", 760); this.noise(.045, .009 * scale, 7200, 2800); return; }
    if (id === "railgun") { this.tone(920, .09, .028 * scale, "triangle", 180); this.noise(.07, .022 * scale, 5200, 1300); return; }
    if (id === "plasma") { this.tone(130, .21, .045 * scale, "sine", 58); this.noise(.14, .025 * scale, 1500, 330); return; }
    if (["rocket", "mortar", "mine"].includes(id)) { this.tone(id === "mortar" ? 74 : 92, .28, .052 * scale, "sawtooth", 38); this.noise(.24, .052 * scale, 1850, 320); return; }
    if (id === "flame") { this.noise(.11, .028 * scale, 2200, 780); this.tone(180, .1, .012 * scale, "triangle", 105); return; }
    if (id === "cryo") { this.tone(1480, .13, .024 * scale, "sine", 670); this.noise(.08, .014 * scale, 7200, 3900); return; }
    if (["tesla", "emp"].includes(id)) { this.noise(.09, .022 * scale, 6400, 1600, "bandpass"); this.tone(id === "tesla" ? 670 : 250, .12, .022 * scale, "square", id === "tesla" ? 180 : 72); return; }
    if (["machinegun", "gatling", "flak", "shredder"].includes(id)) { this.tone(id === "flak" ? 160 : 310, .055, .018 * scale, "square", 75); this.noise(.052, .014 * scale, 4000, 1500); return; }
    this.tone(115, .12, .032 * scale, "triangle", 52); this.noise(.1, .026 * scale, 2500, 700);
  }
  thermal(phase) {
    if (phase === "purge") { this.noise(.24, .028, 2800, 650); this.tone(310, .16, .014, "sine", 150); return; }
    if (phase === "retreat") { this.tone(460, .09, .026, "square", 270); return; }
    if (phase === "lockout") { this.tone(520, .12, .035, "square", 170); this.noise(.12, .018, 2600, 700); return; }
    if (phase === "online" || phase === "recovered") { this.tone(300, .11, .015, "triangle", 530); }
  }
  weapon(id = "cannon", count = 1) {
    const burst = Math.min(count, 4);
    if (id === "laser") { this.tone(820, .13, .025, "sine", 1560); this.tone(1480, .055, .011, "sine", 960); return; }
    if (id === "railgun") { this.tone(155, .16, .026, "sine", 1120); this.tone(980, .07, .025, "sawtooth", 2200); this.noise(.06, .014, 6000, 1900); return; }
    if (id === "plasma") { this.tone(155, .22, .042, "sine", 68); this.noise(.12, .018, 1250, 340); return; }
    if (id === "rocket") { this.tone(125, .19, .034, "sawtooth", 52); this.noise(.14, .031, 1000, 350); return; }
    if (id === "mortar") { this.tone(82, .22, .037, "sawtooth", 42); this.noise(.18, .033, 760, 240); return; }
    if (id === "flame") { this.noise(.12, .03, 2300, 620); this.tone(210, .09, .013, "triangle", 130); return; }
    if (id === "tesla") { this.noise(.075, .02, 6900, 2100, "bandpass"); this.tone(410, .14, .024, "triangle", 1180); return; }
    if (id === "emp") { this.noise(.1, .024, 4300, 820, "bandpass"); this.tone(180, .19, .028, "sine", 58); return; }
    if (id === "cryo") { this.tone(1260, .14, .021, "sine", 720); this.noise(.09, .013, 7600, 4300); return; }
    if (id === "gatling") { this.tone(245, .04 + burst * .009, .014 + burst * .003, "square", 88); this.noise(.028, .011 + burst * .002, 4200, 1700); return; }
    if (id === "machinegun") { this.tone(355, .052 + burst * .006, .017 + burst * .002, "square", 105); this.noise(.03, .011, 4600, 1700); return; }
    if (id === "flak") { this.tone(170, .09, .027, "square", 66); this.noise(.075, .028, 3600, 1100); return; }
    if (id === "shredder") { this.tone(470, .075, .023, "square", 130); this.noise(.06, .022, 4800, 1800); return; }
    if (id === "mine") { this.tone(105, .14, .021, "triangle", 60); return; }
    this.tone(135, .09, .034, "square", 52); this.noise(.06, .021, 2900, 900);
  }

}
