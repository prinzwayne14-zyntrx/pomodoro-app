// Zyn's voice (character voice or device text-to-speech) and voice input (speech-to-text).
// Voice input recognition is provided by the browser/OS
// (on iPhone and Chrome it may be processed by Apple/Google servers) — the UI says so and it is optional.

const PREFERRED = [/siri/i, /premium/i, /enhanced/i, /natural/i, /neural/i, /samantha/i, /ava/i, /google us english/i, /google uk english/i];

/**
 * Zyn's voice. Two styles (Settings → Zyn's voice):
 *   'zyn'    (default) the character voice: cute wolf-language babble + pup sounds, the words appear in the bubble
 *   'device' the device's text-to-speech reads the words out loud
 * Browsers only allow sound after the first tap on the page. A line Zyn wanted to say before that is kept and
 * played as soon as sound is allowed (if it is still recent), so Zyn talks on its own from then on.
 */
export function createVoice(getSettings, zyn = null, audio = null) {
  const synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  let lastText = '', lastAt = 0, voices = [], pending = null, mouth = null, talking = null;
  const load = () => { try { voices = synth ? synth.getVoices() : []; } catch (e) { voices = []; } };
  if (synth) { load(); try { synth.addEventListener('voiceschanged', load); } catch (e) { synth.onvoiceschanged = load; } }
  function english() { return voices.filter(v => /^en(-|_|$)/i.test(v.lang)); }
  function pickVoice() {
    const want = getSettings().voiceName;
    if (want) { const v = voices.find(x => x.name === want); if (v) return v; }
    const en = english();
    for (const re of PREFERRED) { const v = en.find(x => re.test(x.name)); if (v) return v; }
    return en.find(v => v.localService) || en[0] || null;
  }
  const style = () => getSettings().voiceStyle === 'device' && synth ? 'device' : zyn ? 'zyn' : synth ? 'device' : null;
  const vol = () => Math.max(0, Math.min(1, (getSettings().voiceVol ?? 80) / 100));
  const clean = t => String(t || '').replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').replace(/\s+/g, ' ').trim();

  function viaDevice(text, opts) {
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      u.volume = vol(); u.rate = 1.05; u.pitch = opts.mood === 'serious' || opts.mood === 'sleepy' ? 1.1 : 1.35;   // lighter, friendlier
      u.onboundary = () => { mouth && mouth(.8); setTimeout(() => mouth && mouth(.1), 120); };
      u.onend = u.onerror = () => { mouth && mouth(0); talking && talking(false); };
      talking && talking(true); synth.speak(u); return true;
    } catch (e) { return false; }
  }
  function viaZyn(text, opts) {
    const ac = audio && audio.context();
    if (!ac || ac.state !== 'running') return null;               // sound not allowed yet
    zyn.stop();                                                    // end the previous line first, so its "done" can't cancel this one
    talking && talking(true);
    const ms = zyn.say(text, { mood: opts.mood, sound: opts.sound, volume: vol(), pitch: getSettings().voicePitch === 'low' ? .82 : 1,
      onMouth: v => mouth && mouth(v), onEnd: () => { mouth && mouth(0); talking && talking(false); } });
    if (!ms) { talking && talking(false); return null; }
    return true;
  }
  function run(text, opts) {
    const st = style();
    if (st === 'device') return viaDevice(text, opts);
    return viaZyn(text, opts);
  }
  // sound became allowed (first tap): say the line we were holding
  function flush() {
    if (!pending) return;
    const p = pending; pending = null;
    if (Date.now() - p.at < 25000) run(p.text, p.opts);
  }
  if (audio) {
    const hook = () => { const ac = audio.context && audio.context(); if (ac && !ac.__zynHook) { ac.__zynHook = 1; ac.addEventListener('statechange', () => { if (ac.state === 'running') setTimeout(flush, 120); }); } };
    if (typeof window !== 'undefined') addEventListener('pointerdown', () => { hook(); setTimeout(flush, 150); }, true);
  }

  return {
    supported: !!(synth || zyn),
    deviceSupported: !!synth,
    get style() { return style(); },
    voices: () => english().map(v => ({ name: v.name, lang: v.lang, local: v.localService })),
    /** Wire the wolf: mouth(open 0..1) moves the mouth, talking(bool) toggles the talking pose. */
    bind({ onMouth, onTalking }) { mouth = onMouth; talking = onTalking; },
    /**
     * Speak a line. opts: { mood, sound, priority, force }.
     * Repeats of the same line within 8 s are ignored; a non-priority line does not cut off one being said.
     */
    speak(text, opts = {}) {
      const s = getSettings(), { priority = false, force = false } = opts;
      text = clean(text);
      if ((!s.voice && !force) || (!text && !opts.sound)) return false;
      const now = Date.now();
      if (!force && text && text === lastText && now - lastAt < 8000) return false;
      const busy = (zyn && zyn.speaking) || (synth && synth.speaking);
      if (!priority && !force && busy && now - lastAt < 2500) return false;
      const r = run(text, opts);
      if (r === null) { pending = { text, opts, at: now }; return false; }      // say it as soon as sound is allowed
      if (r) { lastText = text; lastAt = now; }
      return !!r;
    },
    stop() { pending = null; try { synth && synth.cancel(); } catch (e) {} try { zyn && zyn.stop(); } catch (e) {} },
    flush
  };
}

/** Voice input. onText(text, final) receives the running transcript; nothing is sent automatically. */
export function createListener() {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  let rec = null, active = false;
  return {
    supported: !!SR,
    get active() { return active; },
    start({ onText, onEnd, onError, lang = navigator.language || 'en-US' }) {
      if (!SR || active) return false;
      try {
        rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
        rec.onresult = e => { let t = ''; for (const r of e.results) t += r[0].transcript; onText(t.trim(), e.results[e.results.length - 1].isFinal); };
        rec.onerror = e => { active = false; onError && onError(e.error || 'error'); };
        rec.onend = () => { active = false; onEnd && onEnd(); };
        rec.start(); active = true; return true;
      } catch (e) { active = false; onError && onError(e.message); return false; }
    },
    stop() { try { rec && rec.stop(); } catch (e) {} active = false; }
  };
}
