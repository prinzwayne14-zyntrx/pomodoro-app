// Language engines behind one interface, so the model can be swapped without touching the rest of the app.
//
//   interface Engine {
//     id, name, private: boolean            // private = nothing leaves this device / local network
//     status(): Promise<{ ready, text }>
//     interpret(text, ctx): Promise<object>  // raw Interpretation-shaped JSON (sanitized + validated by the caller)
//   }
//
// Engines never touch the database. Their output is only a proposal: validate.js decides what may be saved.
import { parse } from './nlu.js';
import { ACTIVITIES } from '../catalog.js';
import { dkey } from '../rpg.js';

export const WEBLLM_MODELS = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 · 0.5B', size: '≈ 280 MB download · ≈ 1 GB GPU memory · phones' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 · 1B', size: '≈ 700 MB download · ≈ 1.3 GB GPU memory' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 · 1.5B', size: '≈ 900 MB download · ≈ 1.7 GB GPU memory · best accuracy' }
];

/* ---------- prompt: the model only classifies and extracts; it never decides what gets saved ---------- */
export function systemPrompt(now = Date.now()) {
  const names = ACTIVITIES.map(a => a.name).join(', ');
  return `You convert one chat message from a productivity app user into JSON. Output ONLY a JSON object, no prose.
Today is ${dkey(now)} (${new Date(now).toLocaleDateString('en-US', { weekday: 'long' })}).
Schema:
{"intent": "log"|"correct"|"delete"|"query"|"timer"|"goal"|"greet"|"thanks"|"help"|"unknown",
 "items": [{"activity": string, "quantity": number|null, "unit": string|null, "date": "today"|"yesterday"|"YYYY-MM-DD"|null}],
 "query": {"metric": "activity"|"focus_time"|"focus_sessions"|"exercise_days"|"summary"|"progress"|"advice"|"streak"|"goals"|"level"|"evolution"|"tasks", "activity": string|null, "range": "today"|"yesterday"|"this_week"|"last_week"|"this_month"|"last_month"|"last_7"|"last_30"|"all"|null},
 "timer": {"action": "start"|"pause"|"resume"|"reset"|"skip", "mode": "focus"|"short"|"long", "minutes": number|null},
 "goal": {"target": string, "quantity": number, "unit": string|null}}
Rules:
- "log" = the user reports something they did. One item per activity. Known activities: ${names}. Other activities: use the user's words.
- quantity and unit EXACTLY as the user said them (e.g. 2 + "liters", 45 + "seconds"). If no number was said, quantity is null. Never guess a number.
- "correct" = the user fixes an earlier entry ("actually", "I meant"). "delete" = remove/undo an entry.
- "query" = a question about their data. "timer" = control the Pomodoro timer. "goal" = set a daily goal.
- "I completed 3 sessions" without saying Pomodoro/focus: intent "log", activity "sessions".
Examples:
"I did 10 push-ups" -> {"intent":"log","items":[{"activity":"push-ups","quantity":10,"unit":null,"date":null}]}
"did 20 squats and a 45 second plank yesterday" -> {"intent":"log","items":[{"activity":"squats","quantity":20,"unit":null,"date":"yesterday"},{"activity":"plank","quantity":45,"unit":"seconds","date":"yesterday"}]}
"I did some push-ups" -> {"intent":"log","items":[{"activity":"push-ups","quantity":null,"unit":null,"date":null}]}
"how many push-ups this week?" -> {"intent":"query","query":{"metric":"activity","activity":"push-ups","range":"this_week"}}
"start a 50 minute focus session" -> {"intent":"timer","timer":{"action":"start","mode":"focus","minutes":50}}`;
}
const extractJSON = txt => {
  const s = String(txt || '').trim(), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('the model did not return JSON');
  return JSON.parse(s.slice(a, b + 1));
};
const messagesFor = (text, ctx) => [
  { role: 'system', content: systemPrompt(ctx.now) },
  ...(ctx.history || []).slice(-4).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 300) })),
  { role: 'user', content: text }
];
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

/* ---------- 1. built-in rules: always available, offline, instant ---------- */
export const rulesEngine = {
  id: 'rules', name: 'Built-in parser', private: true,
  async status() { return { ready: true, text: 'Ready · offline · nothing leaves this device' }; },
  async interpret(text, ctx = {}) { return parse(text, ctx); }
};

/* ---------- 2. on-device LLM (WebLLM + WebGPU), runs in a Web Worker ---------- */
export function createWebLLMEngine(getModel, { importLib = () => import('../vendor/web-llm-0.2.79.js') } = {}) {
  let engine = null, loadedModel = null, loading = null, lastError = '', progress = '';
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(); } catch (e) {} });
  const supported = () => typeof navigator !== 'undefined' && 'gpu' in navigator;
  async function load() {
    const model = getModel();
    if (engine && loadedModel === model) return engine;
    if (loading) return loading;
    if (!supported()) throw new Error('WebGPU is not available in this browser (needs iOS/iPadOS 26+, recent Chrome/Edge, or Safari 26 on Mac).');
    loading = (async () => {
      try {
        progress = 'Loading model library…'; emit();
        const lib = await importLib();
        const worker = new Worker(new URL('./webllm-worker.js', import.meta.url), { type: 'module' });
        engine = await lib.CreateWebWorkerMLCEngine(worker, model, { initProgressCallback: r => { progress = r.text || ''; emit(); } });
        loadedModel = model; lastError = ''; progress = 'Ready'; return engine;
      } catch (e) { engine = null; lastError = e.message || String(e); progress = ''; throw e; }
      finally { loading = null; emit(); }
    })();
    return loading;
  }
  return {
    id: 'webllm', name: 'On-device model', private: true, supported,
    onProgress(f) { listeners.add(f); return () => listeners.delete(f); },
    get progress() { return progress; },
    async status() {
      if (!supported()) return { ready: false, text: 'Not supported here: this browser has no WebGPU.' };
      if (engine && loadedModel === getModel()) return { ready: true, text: 'Loaded · running on this device' };
      if (loading) return { ready: false, text: progress || 'Loading…' };
      if (lastError) return { ready: false, text: 'Error: ' + lastError };
      let cached = false; try { cached = await (await importLib()).hasModelInCache(getModel()); } catch (e) {}
      return { ready: false, text: cached ? 'Downloaded · loads on first message' : 'Not downloaded yet' };
    },
    load,
    async unload() { try { await engine?.unload(); } catch (e) {} engine = null; loadedModel = null; emit(); },
    async remove() { await this.unload(); const lib = await importLib(); await lib.deleteModelAllInfoInCache(getModel()); emit(); },
    get loaded() { return !!engine && loadedModel === getModel(); },
    async interpret(text, ctx = {}) {
      // never start a multi-hundred-MB download from a chat message: the user loads the model in Settings
      if (!(engine && loadedModel === getModel())) throw new Error('the on-device model is not loaded yet (Settings → AI assistant)');
      const e = engine;
      const r = await withTimeout(e.chat.completions.create({ messages: messagesFor(text, ctx), temperature: 0, max_tokens: 320, response_format: { type: 'json_object' } }), 45000, 'the model took too long');
      return extractJSON(r.choices[0].message.content);
    }
  };
}

/* ---------- 3. a model server you run yourself (Ollama, LM Studio, llama.cpp …) ---------- */
export const isPrivateUrl = url => { try { const h = new URL(url).hostname; return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$)/.test(h); } catch (e) { return false; } };
export function createServerEngine(getConf, fetchImpl = (...a) => fetch(...a)) {
  const req = async (path, body, ms) => {
    const { url } = getConf(), ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetchImpl(url + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal } : { signal: ac.signal });
      if (!r.ok) throw new Error(`server answered ${r.status}`);
      return await r.json();
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'the server did not answer in time' : e.message || 'cannot reach the server'); }
    finally { clearTimeout(t); }
  };
  return {
    id: 'server', name: 'Local model server', get private() { return isPrivateUrl(getConf().url); },
    async status() {
      const c = getConf();
      try { const j = await req(c.api === 'openai' ? '/v1/models' : '/api/tags', null, 4000); const n = (j.models || j.data || []).length; return { ready: true, text: `Connected · ${n} model${n === 1 ? '' : 's'} available` }; }
      catch (e) { return { ready: false, text: 'Not reachable: ' + e.message }; }
    },
    async interpret(text, ctx = {}) {
      const c = getConf(), messages = messagesFor(text, ctx);
      if (c.api === 'openai') { const j = await req('/v1/chat/completions', { model: c.model, messages, temperature: 0, response_format: { type: 'json_object' } }, 45000); return extractJSON(j.choices[0].message.content); }
      const j = await req('/api/chat', { model: c.model, messages, stream: false, format: 'json', options: { temperature: 0 } }, 45000);
      return extractJSON(j.message && j.message.content);
    }
  };
}
