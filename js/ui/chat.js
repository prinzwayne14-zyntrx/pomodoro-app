// Chat with Zyn. Renders with textContent only (no HTML from messages), persists history on this device,
// and routes every message through the assistant (which validates before anything is saved).
const SUGGEST_EMPTY = ['I did 20 push-ups', 'I read 15 pages', 'I studied for 1 hour', 'What did I accomplish today?', 'Start a focus session'];
const SUGGEST_MORE = ['How many push-ups this week?', 'Show me my progress', 'What should I improve tomorrow?', 'Am I consistent with my goals?', 'I drank 500 ml of water'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function initChat(ctx) {
  const { store, assistant, $, wolfSVG, listener, toast, dialog } = ctx;
  const log = $('chatLog'), input = $('chatInput'), send = $('sendBtn'), mic = $('micBtn');
  let msgs = store.chat.slice(), busy = false, inputSrc = 'chat';
  const ZYN_AV = `<svg viewBox="0 0 100 100"><use href="#zmark"/></svg>`;
  $('chatWolf').innerHTML = wolfSVG();

  const persist = () => store.saveChat(msgs);
  const time = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function bubble(m) {
    const row = document.createElement('div');
    row.className = `msg ${m.role}${m.kind ? ' ' + m.kind : ''}`;
    row.dataset.id = m.id;
    const av = document.createElement('div'); av.className = 'av'; if (m.role === 'zyn') av.innerHTML = ZYN_AV; else av.hidden = true;
    const col = document.createElement('div');
    const b = document.createElement('div'); b.className = 'bub'; b.textContent = m.text; col.appendChild(b);
    if (m.actions && m.actions.length) {
      const acts = document.createElement('div'); acts.className = 'acts';
      m.actions.forEach((a, i) => {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = a.label; btn.dataset.act = a.id;
        if (i === 0 && a.style !== 'ghost' && m.kind === 'question') btn.className = 'primary';
        btn.disabled = !!m.used || !assistant.hasAction(a.id);
        acts.appendChild(btn);
      });
      col.appendChild(acts);
    }
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = time(m.ts) + (m.role === 'user' && m.src === 'voice' ? ' · voice' : '') + (m.note ? ' · ' + m.note : '') + (m.role === 'zyn' && m.engine && m.engine !== 'rules' ? ' · AI model' : '');
    col.appendChild(meta);
    row.append(av, col);
    return row;
  }
  function render() {
    log.textContent = '';
    if (!msgs.length) {
      log.appendChild(bubble({ id: 'hello', role: 'zyn', ts: Date.now(), text: 'Hey, I’m Zyn 🐺\nTell me what you did and I’ll record it — “I did 20 squats and a 45-second plank”. Ask me about your progress any time.\nEverything stays on this device.' }));
    }
    for (const m of msgs) log.appendChild(bubble(m));
    if (busy) { const t = document.createElement('div'); t.className = 'msg zyn typing'; t.innerHTML = `<div class="av">${ZYN_AV}</div><div class="bub" aria-label="Zyn is typing"><i></i><i></i><i></i></div>`; log.appendChild(t); }
    renderSuggest();
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }
  function renderSuggest() {
    const box = $('chatSuggest'); box.textContent = '';
    const list = msgs.length < 2 ? SUGGEST_EMPTY : SUGGEST_MORE;
    for (const s of list) { const b = document.createElement('button'); b.type = 'button'; b.textContent = s; b.onclick = () => submit(s, 'chat'); box.appendChild(b); }
    box.hidden = busy;
  }
  async function submit(text, src) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    msgs.push({ id: uid(), role: 'user', text, ts: Date.now(), src });
    persist(); render();
    const started = Date.now();
    let r;
    try { r = await assistant.handle(text, src); }
    catch (e) { r = { text: 'Something went wrong on my side, so nothing was saved. Please try again.', kind: 'error', actions: [] }; }
    await new Promise(res => setTimeout(res, Math.max(0, 380 - (Date.now() - started))));   // feels less robotic than an instant answer
    busy = false; send.disabled = false;
    if (r) push(r);
  }
  function push(r) {
    msgs.push({ id: uid(), role: 'zyn', text: r.text, ts: Date.now(), kind: r.kind, actions: r.actions || [], engine: r.engine, note: r.note });
    persist(); render();
    ctx.onReply && ctx.onReply(r);
  }
  log.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]'); if (!btn || busy) return;
    const row = btn.closest('.msg'), m = msgs.find(x => x.id === row.dataset.id);
    if (m) m.used = true;
    busy = true; render();
    let r; try { r = await assistant.act(btn.dataset.act); } catch (err) { r = { text: 'That didn’t work, nothing was changed.', kind: 'error', actions: [] }; }
    busy = false;
    if (r) push(r); else render();
  });

  $('chatForm').addEventListener('submit', e => { e.preventDefault(); const t = input.value; input.value = ''; autosize(); submit(t, inputSrc); inputSrc = 'chat'; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chatForm').requestSubmit(); } });
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  input.addEventListener('input', autosize);

  $('chatClear').onclick = async () => {
    const ok = await dialog({ title: 'Clear conversation?', text: 'This removes the chat messages only. Your recorded activities and sessions stay.', buttons: [{ label: 'Cancel', value: false, cls: 'ghost', primary: true }, { label: 'Clear', value: true, cls: 'danger' }] });
    if (ok !== true) return;
    msgs = []; store.clearChat(); assistant.reset(); render();
  };

  // voice input: the transcript lands in the text box for review; the user sends it
  function micVisible() { mic.hidden = !(listener.supported && store.settings.stt); }
  mic.onclick = () => {
    if (listener.active) { listener.stop(); mic.classList.remove('rec'); return; }
    const before = input.value;
    const ok = listener.start({
      onText: t => { input.value = (before ? before + ' ' : '') + t; autosize(); },
      onEnd: () => { mic.classList.remove('rec'); if (input.value.trim() !== before.trim()) { inputSrc = 'voice'; input.focus(); toast('Check the text, then tap send'); } },
      onError: err => { mic.classList.remove('rec'); toast(err === 'not-allowed' ? 'Microphone access was denied' : 'Voice input stopped'); }
    });
    if (ok) mic.classList.add('rec');
  };

  render(); micVisible();
  return {
    render, micVisible,
    status(text) { $('aiStatus').textContent = text; },
    send: submit
  };
}
