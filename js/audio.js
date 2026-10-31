// Generated sound effects (Web Audio). No audio files, no network.
// Chain: voices -> dry + reverb send -> master volume -> compressor -> makeup gain -> speakers.
// The compressor lets the effects play loud without clipping on small phone speakers.
export function createAudio(getSettings) {
  let ac, master, bus, verb;
  function ctx() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        if (navigator.audioSession) navigator.audioSession.type = 'playback';   // ignore the iPhone silent switch (Safari 16.4+)
        master = ac.createGain();
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = .002; comp.release.value = .2;
        const makeup = ac.createGain(); makeup.gain.value = 2.2;
        master.connect(comp); comp.connect(makeup); makeup.connect(ac.destination);
        bus = ac.createGain(); bus.connect(master);
        // small generated room reverb
        const len = Math.floor(ac.sampleRate * 1.6), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        verb = ac.createConvolver(); verb.buffer = ir;
        const wet = ac.createGain(); wet.gain.value = .32; verb.connect(wet); wet.connect(master);
      } catch (e) { ac = null; return false; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return true;
  }
  function ready() {
    const s = getSettings();
    if (!s.sound || !ctx()) return false;
    master.gain.value = Math.pow(s.volume / 100, 1.15);
    return true;
  }
  // one voice: oscillator + envelope, optional pitch glide / vibrato / filter, sent dry + to reverb
  function tone(f, t0, d, o = {}) {
    const { type = 'sine', g = .3, to = null, a = .005, rev = .5, lp = 0, vib = 0, detune = 0 } = o, now = ac.currentTime + t0;
    const osc = ac.createOscillator(), v = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, now); osc.detune.value = detune;
    if (to) osc.frequency.exponentialRampToValueAtTime(to, now + d * .8);
    if (vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 5.5; lg.gain.value = vib; l.connect(lg); lg.connect(osc.frequency); l.start(now); l.stop(now + d + .1); }
    v.gain.setValueAtTime(.0001, now);
    v.gain.exponentialRampToValueAtTime(g, now + a);
    v.gain.exponentialRampToValueAtTime(.0001, now + d);
    let n = osc;
    if (lp) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp; f2.Q.value = 1.2; osc.connect(f2); n = f2; }
    n.connect(v); v.connect(bus);
    if (rev) { const sg = ac.createGain(); sg.gain.value = rev; v.connect(sg); sg.connect(verb); }
    osc.start(now); osc.stop(now + d + .1);
  }
  // instruments
  const bell = (f, t, d = 2, g = .26) => { tone(f, t, d, { g }); tone(f * 2.76, t, d * .45, { g: g * .32 }); tone(f * 5.4, t, d * .2, { g: g * .14 }); tone(f * .5, t, d * .8, { g: g * .2 }); };
  const marimba = (f, t, g = .3) => { tone(f, t, .55, { g, a: .002 }); tone(f * 4, t, .12, { g: g * .25, a: .001, rev: .2 }); };
  const pluck = (f, t, g = .22) => { tone(f, t, .32, { type: 'triangle', g, a: .002 }); tone(f * 2, t, .16, { g: g * .3, a: .002 }); };
  const brass = (f, t, d, g = .16) => { tone(f, t, d, { type: 'sawtooth', g, a: .03, lp: 2400 }); tone(f * 1.005, t, d, { type: 'sawtooth', g: g * .6, a: .04, lp: 1800 }); };
  const howl = (t, g = .22) => {                                       // a short wolf howl: rising, vibrato, falling
    const now = ac.currentTime + t, osc = ac.createOscillator(), osc2 = ac.createOscillator(), v = ac.createGain(), bp = ac.createBiquadFilter();
    osc.type = 'sawtooth'; osc2.type = 'sine'; bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.5;
    for (const o of [osc, osc2]) { o.frequency.setValueAtTime(330, now); o.frequency.exponentialRampToValueAtTime(560, now + .45); o.frequency.setValueAtTime(560, now + 1.2); o.frequency.exponentialRampToValueAtTime(420, now + 1.8); }
    const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 5; lg.gain.value = 9; l.connect(lg); lg.connect(osc.frequency); lg.connect(osc2.frequency);
    v.gain.setValueAtTime(.0001, now); v.gain.exponentialRampToValueAtTime(g, now + .25); v.gain.setValueAtTime(g, now + 1.3); v.gain.exponentialRampToValueAtTime(.0001, now + 1.9);
    const g2 = ac.createGain(); g2.gain.value = .5; osc.connect(bp); bp.connect(v); osc2.connect(g2); g2.connect(v);
    v.connect(bus); const sg = ac.createGain(); sg.gain.value = .9; v.connect(sg); sg.connect(verb);
    for (const o of [osc, osc2, l]) { o.start(now); o.stop(now + 2); }
  };
  const fx = {
    tap()   { tone(1500, 0, .045, { type: 'triangle', g: .16, to: 1000, rev: 0 }); },
    start() { tone(110, 0, .35, { g: .35, to: 70, rev: 0 }); [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => pluck(f, .04 + i * .06, .2)); bell(1568, .3, 1.2, .1); },
    pause() { pluck(783.99, 0, .2); pluck(523.25, .09, .2); },
    reset() { tone(600, 0, .25, { type: 'triangle', g: .18, to: 240 }); },
    count() { marimba(1318.5, 0, .32); },
    warn()  { marimba(880, 0, .3); marimba(880, .18, .3); },
    task()  { marimba(783.99, 0, .28); marimba(1174.7, .09, .3); bell(1568, .18, .9, .1); },
    // focus finished: bright marimba run into a full bell chord
    focusDone() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => marimba(f, i * .1, .34));
      [523.25, 659.25, 783.99].forEach(f => bell(f, .55, 2.4, .2)); bell(1046.5, .55, 2.6, .16); tone(130.8, .55, 2, { g: .3 });
    },
    // break over: gentle "wake up" bells
    breakDone() { bell(659.25, 0, 1.6, .26); bell(880, .3, 1.6, .26); bell(1318.5, .6, 2.2, .22); },
    levelUp() { [392, 523.25, 659.25, 783.99].forEach((f, i) => brass(f, i * .11, .4)); brass(1046.5, .45, 1.2, .14); brass(783.99, .45, 1.2, .1); bell(2093, .5, 2, .12); },
    rankUp()  { this.levelUp(); howl(1.1, .2); [523.25, 783.99, 1046.5].forEach(f => bell(f, 1.3, 2.6, .14)); },
    evolve()  { for (let i = 0; i < 12; i++) tone(523.25 * Math.pow(2, i / 6), i * .05, .5, { g: .12, detune: (i % 2 ? 7 : -7) }); howl(.6, .22); bell(1046.5, .7, 2.8, .2); bell(1568, .9, 2.6, .14); },
    howl()    { howl(0); }
  };
  /* ---------- ambient focus sounds (looped, generated noise) ---------- */
  let amb = null, ambKind = 'off';
  function noise(kind) {
    const len = ac.sampleRate * 4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') { b0 = .99765 * b0 + w * .099; b1 = .963 * b1 + w * .2965; b2 = .57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * .1848) * .2; }
      else d[i] = w * .5;
    }
    const fade = Math.floor(ac.sampleRate * .05);       // smooth the loop seam
    for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[len - fade + i] * (1 - k); }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; return src;
  }
  function buildAmbient(kind) {
    const out = ac.createGain(); out.gain.value = 0; out.connect(ac.destination);
    const nodes = [];
    const chain = (src, ...fs) => { let n = src; for (const f of fs) { n.connect(f); n = f; } n.connect(out); src.start(); nodes.push(src); };
    const filt = (type, f, q = .7) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    if (kind === 'brown') chain(noise('brown'), filt('lowpass', 1200));
    else if (kind === 'white') chain(noise('white'), filt('lowpass', 8000), (() => { const g = ac.createGain(); g.gain.value = .45; return g; })());
    else if (kind === 'rain') {
      chain(noise('pink'), filt('highpass', 500), filt('lowpass', 7000), (() => { const g = ac.createGain(); g.gain.value = 1.1; return g; })());
      chain(noise('brown'), filt('lowpass', 400), (() => { const g = ac.createGain(); g.gain.value = .5; return g; })());
    } else if (kind === 'waves') {
      const g = ac.createGain(); g.gain.value = .55;
      const lfo = ac.createOscillator(), depth = ac.createGain(); lfo.frequency.value = .085; depth.gain.value = .45;
      lfo.connect(depth); depth.connect(g.gain); lfo.start(); nodes.push(lfo);
      chain(noise('brown'), filt('lowpass', 700), g);
    }
    return { out, nodes };
  }
  function ambVolume() { return Math.pow((getSettings().ambVol ?? 50) / 100, 1.5) * .9; }
  function ambient(kind) {
    kind = kind || 'off';
    if (kind === ambKind) { if (amb) amb.out.gain.setTargetAtTime(ambVolume(), ac.currentTime, .2); return; }
    if (amb) { const old = amb; old.out.gain.setTargetAtTime(0, ac.currentTime, .35); setTimeout(() => { old.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); old.out.disconnect(); }, 1600); amb = null; }
    ambKind = 'off';
    if (kind === 'off' || !ctx()) return;
    try { amb = buildAmbient(kind); ambKind = kind; amb.out.gain.setTargetAtTime(ambVolume(), ac.currentTime, .6); } catch (e) { amb = null; }
  }

  return {
    play(name) { if (ready()) { try { fx[name](); } catch (e) {} } },
    unlock() { ready(); },                     // call from a user gesture to satisfy browser autoplay rules
    ambient,                                   // 'off' | 'rain' | 'brown' | 'waves' | 'white'
    get ambientKind() { return ambKind; }
  };
}
