// Generated sound effects (Web Audio). No audio files, no network.
export function createAudio(getSettings) {
  let ac, master;
  function ctx() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.connect(ac.destination);
        if (navigator.audioSession) navigator.audioSession.type = 'playback';   // ignore the iPhone silent switch (Safari 16.4+)
      } catch (e) { return false; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return true;
  }
  function ready() {
    const s = getSettings();
    if (!s.sound || !ctx()) return false;
    master.gain.value = Math.pow(s.volume / 100, 1.6);
    return true;
  }
  function tone(f, t0, d, o = {}) {
    const { type = 'sine', g = .3, to = null, a = .006 } = o, now = ac.currentTime + t0;
    const osc = ac.createOscillator(), v = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, now);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, now + d);
    v.gain.setValueAtTime(.0001, now);
    v.gain.exponentialRampToValueAtTime(g, now + a);
    v.gain.exponentialRampToValueAtTime(.0001, now + d);
    osc.connect(v); v.connect(master); osc.start(now); osc.stop(now + d + .05);
  }
  const bell = (f, t0, d = 1.2, g = .25) => { tone(f, t0, d, { g }); tone(f * 2, t0, d * .7, { g: g * .4 }); tone(f * 3.01, t0, d * .4, { g: g * .15 }); };
  const fx = {
    tap()   { tone(1400, 0, .05, { type: 'triangle', g: .14, to: 900 }); },
    start() { tone(392, 0, .18, { type: 'triangle', g: .25 }); tone(587, .09, .3, { type: 'triangle', g: .25 }); tone(784, .18, .5, { g: .18 }); },
    pause() { tone(587, 0, .14, { type: 'triangle', g: .22 }); tone(392, .08, .26, { type: 'triangle', g: .22 }); },
    reset() { tone(520, 0, .22, { type: 'sawtooth', g: .07, to: 200 }); },
    count() { tone(880, 0, .12, { g: .2 }); },
    task()  { tone(660, 0, .1, { type: 'triangle', g: .2 }); tone(990, .08, .22, { type: 'triangle', g: .2 }); },
    focusDone() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, i * .13, 1.5, .22)); tone(130.8, 0, 1.3, { g: .25 }); },
    breakDone() { bell(659.25, 0, 1.1, .2); bell(880, .28, 1.5, .2); },
    levelUp() { [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => tone(f, i * .07, .55, { type: 'triangle', g: .17 })); bell(2093, .5, 1.8, .12); }
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
