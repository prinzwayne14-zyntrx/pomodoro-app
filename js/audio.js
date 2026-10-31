// Generated sound effects (Web Audio). No audio files, no network.
export function createAudio(getSettings) {
  let ac, master;
  function ready() {
    const s = getSettings();
    if (!s.sound) return false;
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.connect(ac.destination);
        if (navigator.audioSession) navigator.audioSession.type = 'playback';   // ignore the iPhone silent switch (Safari 16.4+)
      } catch (e) { return false; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
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
  return {
    play(name) { if (ready()) { try { fx[name](); } catch (e) {} } },
    unlock() { ready(); }                      // call from a user gesture to satisfy browser autoplay rules
  };
}
