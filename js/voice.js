// Zyn's voice (text-to-speech) and voice input (speech-to-text), both via the browser's Web Speech API.
// Speech synthesis uses the voices installed on the device. Recognition is provided by the browser/OS
// (on iPhone and Chrome it may be processed by Apple/Google servers) — the UI says so and it is optional.

const PREFERRED = [/siri/i, /premium/i, /enhanced/i, /natural/i, /neural/i, /samantha/i, /ava/i, /daniel/i, /karen/i, /google us english/i, /google uk english/i];

export function createVoice(getSettings) {
  const synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  let lastText = '', lastAt = 0, voices = [];
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
  return {
    supported: !!synth,
    voices: () => english().map(v => ({ name: v.name, lang: v.lang, local: v.localService })),
    /** Speak a line. priority: interrupts whatever is being said. Repeats within 8 s are ignored. */
    speak(text, { priority = false, force = false } = {}) {
      const s = getSettings();
      if (!synth || (!s.voice && !force) || !text) return false;
      const now = Date.now();
      if (!force && text === lastText && now - lastAt < 8000) return false;
      if (!priority && !force && synth.speaking && now - lastAt < 2500) return false;
      try {
        if (priority || force || synth.speaking) synth.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/[🐺🎯💪]/gu, ''));
        const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
        u.volume = Math.max(0, Math.min(1, (s.voiceVol ?? 80) / 100)); u.rate = 1.0; u.pitch = 0.95;
        synth.speak(u); lastText = text; lastAt = now; return true;
      } catch (e) { return false; }
    },
    stop() { try { synth && synth.cancel(); } catch (e) {} }
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
