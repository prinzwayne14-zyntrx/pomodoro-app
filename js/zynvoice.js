// Zyn's character voice: a cute, made-up "wolf language" (like game characters babble) plus real wolf-pup sounds
// (yip, giggle, howl, yawn, hum). Everything is synthesized with Web Audio: no files, no network, no robot TTS.
//
// How the babble works: the text is split into syllables. Each syllable becomes a short pitched blip shaped by two
// formant filters for its vowel (a/e/i/o/u), with a tiny noise burst for hard consonants. Pitch follows the
// sentence (rises on "?", jumps on "!"), and the same text always sounds the same, so Zyn has a consistent voice.

// vowel formants (Hz) for a small, bright voice — already shifted up from adult values
const VOWELS = {
  a: [980, 1700], e: [640, 2500], i: [420, 2900], o: [700, 1150], u: [460, 1050], y: [480, 2600]
};
const MOODS = {
  happy:   { pitch: 1.00, speed: 1.00, lift: 1.0 },
  excited: { pitch: 1.12, speed: 1.15, lift: 1.5 },
  calm:    { pitch: 0.93, speed: 0.88, lift: 0.6 },
  serious: { pitch: 0.86, speed: 0.92, lift: 0.4 },
  sleepy:  { pitch: 0.82, speed: 0.72, lift: 0.3 },
  proud:   { pitch: 1.05, speed: 0.98, lift: 1.2 }
};
const HARD = /[ptkbdgcq]/i, SOFT = /[sfzxhjv]/i;

// stable pseudo-random from a string, so a line always sounds the same
function seeded(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; }

/** Split text into syllables: [{ v: vowel, c: leading consonant or '', end: 'word'|'.'|'?'|'!'|',' }] */
export function syllables(text) {
  const out = [];
  const words = String(text).toLowerCase().replace(/[^a-z0-9'?!.,\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (const w of words) {
    const punct = /[?]$/.test(w) ? '?' : /[!]$/.test(w) ? '!' : /[.]$/.test(w) ? '.' : /[,]$/.test(w) ? ',' : 'word';
    const clean = w.replace(/[^a-z]/g, '') || (/\d/.test(w) ? 'nu' : '');
    if (!clean) continue;
    const groups = clean.match(/[^aeiouy]*[aeiouy]+/g) || [clean + 'a'];
    groups.forEach((g, i) => {
      const v = (g.match(/[aeiouy]/) || ['a'])[0], c = g.match(/^[^aeiouy]+/);
      out.push({ v, c: c ? c[0][0] : '', end: i === groups.length - 1 ? punct : '' });
    });
  }
  return out;
}

export function createZynVoice({ context, output }) {
  let speaking = null;            // { stopAt, timers: [] }

  function blip(ac, out, t, f, dur, vowel, consonant, gain) {
    const [f1, f2] = VOWELS[vowel] || VOWELS.a;
    const src = ac.createOscillator(), sub = ac.createOscillator();
    src.type = 'sawtooth'; sub.type = 'triangle';
    // cute "bloop": start a little high, settle on the note
    src.frequency.setValueAtTime(f * 1.09, t); src.frequency.exponentialRampToValueAtTime(f, t + dur * .45);
    sub.frequency.setValueAtTime(f * 1.09, t); sub.frequency.exponentialRampToValueAtTime(f, t + dur * .45);
    const b1 = ac.createBiquadFilter(), b2 = ac.createBiquadFilter(), lp = ac.createBiquadFilter();
    b1.type = 'bandpass'; b1.frequency.value = f1; b1.Q.value = 5;
    b2.type = 'bandpass'; b2.frequency.value = f2; b2.Q.value = 7;
    lp.type = 'lowpass'; lp.frequency.value = 3300; lp.Q.value = .5;
    const g1 = ac.createGain(), g2 = ac.createGain(), sg = ac.createGain(), env = ac.createGain();
    g1.gain.value = 1.6; g2.gain.value = .8; sg.gain.value = .22;
    src.connect(b1); src.connect(b2); b1.connect(g1); b2.connect(g2); sub.connect(sg);
    g1.connect(lp); g2.connect(lp); sg.connect(lp); lp.connect(env); env.connect(out);
    env.gain.setValueAtTime(.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + .012);
    env.gain.setValueAtTime(gain, t + dur * .6);
    env.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.start(t); sub.start(t); src.stop(t + dur + .02); sub.stop(t + dur + .02);
    if (consonant && (HARD.test(consonant) || SOFT.test(consonant))) {
      const len = Math.floor(ac.sampleRate * .03), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const n = ac.createBufferSource(), hp = ac.createBiquadFilter(), ng = ac.createGain();
      n.buffer = buf; hp.type = 'highpass'; hp.frequency.value = SOFT.test(consonant) ? 4000 : 1800;
      ng.gain.value = gain * (SOFT.test(consonant) ? .35 : .5);
      n.connect(hp); hp.connect(ng); ng.connect(out); n.start(t - .012);
    }
  }

  // a voiced slide with vibrato through one vowel: the building block of yips, howls and yawns
  function slide(ac, out, t, pts, vowel, gain, vib = 0) {
    const [f1, f2] = VOWELS[vowel] || VOWELS.u;
    const src = ac.createOscillator(), sub = ac.createOscillator(), env = ac.createGain();
    src.type = 'sawtooth'; sub.type = 'sine';
    const end = t + pts[pts.length - 1][0];
    for (const o of [src, sub]) { o.frequency.setValueAtTime(pts[0][1], t); for (const [dt, f] of pts.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t + dt); }
    if (vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 6; lg.gain.value = vib; l.connect(lg); lg.connect(src.frequency); lg.connect(sub.frequency); l.start(t); l.stop(end + .05); }
    const b1 = ac.createBiquadFilter(), b2 = ac.createBiquadFilter(), mix = ac.createGain(), sg = ac.createGain();
    b1.type = 'bandpass'; b1.frequency.value = f1; b1.Q.value = 4; b2.type = 'bandpass'; b2.frequency.value = f2; b2.Q.value = 6;
    src.connect(b1); src.connect(b2); b1.connect(mix); b2.connect(mix); sub.connect(sg); sg.gain.value = .45; sg.connect(mix);
    mix.gain.value = 1.4; mix.connect(env); env.connect(out);
    const dur = end - t;
    env.gain.setValueAtTime(.0001, t); env.gain.exponentialRampToValueAtTime(gain, t + Math.min(.05, dur * .2));
    env.gain.setValueAtTime(gain, t + dur * .7); env.gain.exponentialRampToValueAtTime(.0001, end);
    src.start(t); sub.start(t); src.stop(end + .02); sub.stop(end + .02);
    return dur;
  }

  // wolf-pup sounds. Each returns its length in seconds.
  const SOUNDS = {
    yip(ac, out, t, p = 1) { slide(ac, out, t, [[0, 720 * p], [.05, 1350 * p], [.11, 1100 * p]], 'i', .5); return .13; },
    yipyip(ac, out, t, p = 1) { SOUNDS.yip(ac, out, t, p); SOUNDS.yip(ac, out, t + .16, p * 1.12); return .3; },
    giggle(ac, out, t, p = 1) { [1, .94, .89, .84].forEach((k, i) => slide(ac, out, t + i * .1, [[0, 900 * p * k], [.07, 760 * p * k]], 'e', .38)); return .42; },
    awoo(ac, out, t, p = 1) { return slide(ac, out, t, [[0, 520 * p], [.28, 930 * p], [.75, 960 * p], [1.15, 700 * p]], 'u', .42, 14); },
    yawn(ac, out, t, p = 1) { return slide(ac, out, t, [[0, 640 * p], [.25, 760 * p], [.9, 380 * p]], 'a', .32, 4); },
    hmm(ac, out, t, p = 1) { return slide(ac, out, t, [[0, 430 * p], [.18, 470 * p], [.42, 410 * p]], 'u', .3); },
    wow(ac, out, t, p = 1) { return slide(ac, out, t, [[0, 600 * p], [.2, 1100 * p], [.45, 820 * p]], 'o', .42, 6); }
  };

  function stop() {
    if (!speaking) return;
    speaking.timers.forEach(clearTimeout);
    try { speaking.gain.gain.setTargetAtTime(0, speaking.ac.currentTime, .02); } catch (e) {}
    const s = speaking; speaking = null; s.onEnd && s.onEnd();
  }

  /**
   * Say a line in Zyn's voice.
   *   text   what Zyn says (shown as subtitles by the caller; here it only drives the babble)
   *   mood   happy | excited | calm | serious | sleepy | proud
   *   sound  optional wolf sound before the words: yip | yipyip | giggle | awoo | yawn | hmm | wow
   *   onMouth(open 0..1) is called per syllable so the wolf's mouth can move; onEnd when finished.
   * Returns the length in ms (0 if audio is not available).
   */
  function say(text, { mood = 'happy', sound = null, volume = .8, pitch = 1, onMouth = null, onEnd = null, maxSec = 2.8 } = {}) {
    const ac = context(); if (!ac || ac.state !== 'running') return 0;
    stop();
    const m = MOODS[mood] || MOODS.happy, rnd = seeded(text || sound || 'zyn');
    const out = ac.createGain(); out.gain.value = Math.max(0, Math.min(1, volume)); out.connect(output());
    const timers = [], t0 = ac.currentTime + .03;
    let t = t0;
    const mouthAt = (sec, v) => { if (onMouth) timers.push(setTimeout(() => onMouth(v), Math.max(0, (sec - ac.currentTime) * 1000))); };
    if (sound && SOUNDS[sound]) {
      const d = SOUNDS[sound](ac, out, t, pitch * m.pitch);
      mouthAt(t, sound === 'hmm' ? .15 : .9); mouthAt(t + d, 0);
      t += d + (text ? .14 : 0);
    }
    if (text) {
      let syl = syllables(text);
      const base = 600 * pitch * m.pitch, step = .085 / m.speed;
      // long lines: babble a bit faster and only up to maxSec — the full text is in the bubble
      const fit = Math.max(1, (syl.length * step) / maxSec);
      if (fit > 1.35) syl = syl.slice(0, Math.ceil(maxSec / (step / 1.35)));
      const st = step / Math.min(fit, 1.35);
      syl.forEach((s, i) => {
        const pos = i / Math.max(1, syl.length - 1);
        let f = base * Math.pow(2, ((rnd() - .5) * 5 * m.lift) / 12) * (1.04 - .1 * pos);   // gentle downward sentence melody
        if (s.end === '?') f *= 1.35;
        if (s.end === '!') f *= 1.18;
        const dur = st * (s.end && s.end !== 'word' ? 1.5 : .95 + rnd() * .2);
        blip(ac, out, t, f, dur, s.v, s.c, .34);
        mouthAt(t, { a: 1, o: .85, e: .6, u: .45, i: .4, y: .4 }[s.v] || .6); mouthAt(t + dur * .8, .1);
        t += dur + (s.end === 'word' ? .035 : s.end === ',' ? .12 : s.end ? .2 : 0);
      });
    }
    const ms = Math.round((t - ac.currentTime) * 1000) + 60;
    mouthAt(t + .02, 0);
    const self = { ac, gain: out, timers, onEnd };
    timers.push(setTimeout(() => { if (speaking === self) { speaking = null; onEnd && onEnd(); } setTimeout(() => out.disconnect(), 400); }, ms));
    speaking = self;
    return ms;
  }

  return { say, stop, get speaking() { return !!speaking; }, sounds: Object.keys(SOUNDS) };
}
