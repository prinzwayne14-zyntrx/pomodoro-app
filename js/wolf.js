// Zyn, ZENTRY's wolf companion: an inline SVG character animated with CSS.
// The look is driven by data attributes on the root element:
//   data-state = idle | focus | working | paused | rest | proud | serious | happy | howl
//   data-stage = 1..5 (evolution from discipline), data-mood = new | strong | tired | lonely

export function wolfSVG() {
  return `<svg class="wolf-svg" viewBox="-6 -8 132 126" aria-hidden="true">
  <ellipse class="w-aura" cx="60" cy="62" rx="54" ry="56"/>
  <ellipse class="w-shadow" cx="60" cy="111" rx="34" ry="4"/>
  <g class="w-bodywrap">
  <g class="w-tail"><path class="w-shade" d="M80 104 C 98 102, 108 88, 104 70 C 102 62, 96 58, 94 64 C 98 78, 92 90, 76 96 Z"/>
    <path class="w-light w-tip" d="M104 70 C 102 62, 96 58, 94 64 C 96 70, 97 74, 96 79 C 100 77, 104 74, 104 70 Z"/></g>
  <g class="w-body">
    <path class="w-fur" d="M38 108 C 34 84, 44 64, 60 62 C 76 64, 86 84, 82 108 Z"/>
    <path class="w-shade w-flank" d="M38 108 C 35 92, 39 78, 46 70 C 44 84, 44 96, 47 108 Z M82 108 C 85 92, 81 78, 74 70 C 76 84, 76 96, 73 108 Z"/>
    <path class="w-mane" d="M29 84 L33 70 L39 75 L40 62 L48 69 L52 58 L60 66 L68 58 L72 69 L80 62 L81 75 L87 70 L91 84 C 82 76, 72 72, 60 72 C 48 72, 38 76, 29 84 Z"/>
    <path class="w-light" d="M48 108 C 47 92, 52 78, 60 74 C 68 78, 73 92, 72 108 Z"/>
    <path class="w-light" d="M50 82 L54 88 L57 82 L60 89 L63 82 L66 88 L70 82 L66 78 L54 78 Z"/>
    <ellipse class="w-fur" cx="50" cy="108" rx="8" ry="4.5"/><ellipse class="w-fur" cx="70" cy="108" rx="8" ry="4.5"/>
    <path class="w-line" d="M47 108v-2M51 108v-2M67 108v-2M71 108v-2"/>
    <g class="w-scarf"><path d="M42 70 C 52 78, 68 78, 78 70 L 79 76 C 68 84, 52 84, 41 76 Z"/><path d="M66 78 L 74 92 L 64 88 Z"/></g>
  </g>
  </g>
  <g class="w-headwrap">
  <g class="w-head">
    <g class="w-ear w-ear-l"><path class="w-shade" d="M34 32 L 31 4 L 54 20 Z"/><path class="w-inner" d="M37 27 L 35.5 11 L 48 20.5 Z"/></g>
    <g class="w-ear w-ear-r"><path class="w-shade" d="M86 32 L 89 4 L 66 20 Z"/><path class="w-inner" d="M83 27 L 84.5 11 L 72 20.5 Z"/></g>
    <path class="w-fur" d="M60 15 C 77 15, 89 25, 91 39 L 99 47 L 88 49 C 84 61, 73 68, 60 68 C 47 68, 36 61, 32 49 L 21 47 L 29 39 C 31 25, 43 15, 60 15 Z"/>
    <path class="w-shade" d="M60 15 C 66 15, 70 17, 72 20 L 60 33 L 48 20 C 50 17, 54 15, 60 15 Z"/>
    <path class="w-light" d="M38 37 C 42 32, 50 32, 54 37 C 52 44, 42 46, 38 37 Z M82 37 C 78 32, 70 32, 66 37 C 68 44, 78 46, 82 37 Z"/>
    <path class="w-light" d="M60 36 C 69 36, 76 44, 76 52 C 76 61, 68 66, 60 66 C 52 66, 44 61, 44 52 C 44 44, 51 36, 60 36 Z"/>
    <path class="w-marks" d="M30 44 L 38 45.5 M31 49 L 38.5 49 M90 44 L 82 45.5 M89 49 L 81.5 49"/>
    <path class="w-star" d="M60 22 l1.8 3.8 4.1.5 -3 2.8 .8 4.1 -3.7-2 -3.7 2 .8-4.1 -3-2.8 4.1-.5z"/>
    <g class="w-crown"><path d="M47 14 L 50 3 L 55 9 L 60 0 L 65 9 L 70 3 L 73 14 Z"/><circle cx="60" cy="9.5" r="1.6"/></g>
    <ellipse class="w-blush" cx="40" cy="51" rx="5" ry="2.6"/><ellipse class="w-blush" cx="80" cy="51" rx="5" ry="2.6"/>
    <g class="w-brows"><path d="M41 31 L 52 34"/><path d="M79 31 L 68 34"/></g>
    <g class="w-brows2"><path d="M41.5 32.5 L 52 32.5"/><path d="M78.5 32.5 L 68 32.5"/></g>
    <g class="w-eyes">
      <g class="w-eye"><ellipse class="w-iris" cx="47" cy="40" rx="4.6" ry="5.2"/><circle class="w-pupil" cx="47.4" cy="40.6" r="2.7"/><circle class="w-glint" cx="45.6" cy="38.4" r="1.3"/></g>
      <g class="w-eye"><ellipse class="w-iris" cx="73" cy="40" rx="4.6" ry="5.2"/><circle class="w-pupil" cx="72.6" cy="40.6" r="2.7"/><circle class="w-glint" cx="71.2" cy="38.4" r="1.3"/></g>
    </g>
    <g class="w-lids"><path d="M41.6 36.5 Q 47 34 52.4 36.5 L 52.4 40 Q 47 38.6 41.6 40 Z"/><path d="M67.6 36.5 Q 73 34 78.4 36.5 L 78.4 40 Q 73 38.6 67.6 40 Z"/></g>
    <g class="w-closed"><path d="M42 41 Q 47 44.5 52 41"/><path d="M68 41 Q 73 44.5 78 41"/></g>
    <g class="w-joy"><path d="M42 42 Q 47 36 52 42"/><path d="M68 42 Q 73 36 78 42"/></g>
    <path class="w-nose" d="M54.5 48.5 Q 60 46 65.5 48.5 Q 64 54 60 55 Q 56 54 54.5 48.5 Z"/>
    <path class="w-glint2" d="M57 48.6 Q 59 47.8 61 48.3"/>
    <g class="w-mouth"><path d="M60 55 v3.2"/><path d="M60 58.2 Q 56 61.5 52.5 58.6"/><path d="M60 58.2 Q 64 61.5 67.5 58.6"/></g>
    <path class="w-frown" d="M54 61 Q 60 57.5 66 61"/>
    <path class="w-flat" d="M55 59.6 L 65 59.6"/>
    <path class="w-tongue" d="M56.6 59.6 Q 60 61 63.4 59.6 Q 63.6 65.5 60 65.8 Q 56.4 65.5 56.6 59.6 Z"/>
    <ellipse class="w-howl" cx="60" cy="60" rx="3.6" ry="4.4"/>
  </g>
  </g>
  <g class="w-sparks"><circle cx="14" cy="60" r="1.6"/><circle cx="106" cy="40" r="1.3"/><circle cx="22" cy="20" r="1.1"/><circle cx="100" cy="92" r="1.5"/><circle cx="8" cy="96" r="1.2"/></g>
  <g class="w-shine"><path d="M18 30 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6-4 -4-1.6 4-1.6z"/><path d="M100 22 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3-3.2 -3.2-1.3 3.2-1.3z"/><path d="M106 60 l1 2.5 2.5 1 -2.5 1 -1 2.5 -1-2.5 -2.5-1 2.5-1z"/></g>
  <g class="w-zzz"><text x="92" y="22">z</text><text x="100" y="12">z</text><text x="107" y="4">z</text></g>
</svg>`;
}

const LINES = {
  idle: ['Ready when you are.', 'One focused block. That’s all.', 'Pick a task and let’s hunt.', 'Small steps, every day.', 'Tap Start — I’ll keep watch.'],
  focus: ['Hunt mode. Phone down.', 'Deep focus. I’ve got your back.', 'Stay on the trail.', 'One thing at a time.', 'Quiet mind, sharp claws.'],
  working: ['Halfway there. Keep pushing.', 'You’re in the zone.', 'Strong focus. Stay with it.'],
  proud: ['Daily goal done. Proud of you.', 'Goal reached — that’s discipline.', 'We did it today. Awoo!'],
  serious: ['Yesterday slipped. Today we hunt.', 'One session gets us back on track.', 'No guilt — just the next session.'],
  paused: ['Taking a breather?', 'I’ll wait right here.', 'Back on the trail soon?'],
  rest: ['Rest, stretch, drink water.', 'Eyes off the screen for a bit.', 'Good wolves rest too.'],
  done: ['Great hunt!', 'That’s how the pack does it.', 'Another one down. Proud of you.'],
  goal: ['Daily goal smashed! Awoooo!'],
  tired: ['Missed you yesterday. One session?', 'Let’s get the streak back.', 'A short hunt wakes me up.'],
  lonely: ['I missed you! Let’s start small.', 'The pack waits for you. 10 minutes?', 'Comebacks start with one session.'],
  tap: ['Awoo!', 'You’re doing great.', 'Focus is a muscle. We’re training.', 'Hydrate, hunter.', 'Consistency beats intensity.', 'Done is better than perfect.', 'Let’s make today count.']
};
const pick = a => a[Math.floor(Math.random() * a.length)];

export function createWolf(root, bubble) {
  root.innerHTML = wolfSVG();
  let base = 'idle', tempT = 0, sayT = 0;
  const apply = s => { root.dataset.state = s; };
  function say(text, ms = 3400) {
    if (!bubble) return;
    bubble.textContent = text; bubble.classList.add('show');
    clearTimeout(sayT); sayT = setTimeout(() => bubble.classList.remove('show'), ms);
  }
  return {
    // base state follows the timer; temporary reactions (happy/howl) win until they expire
    set(state, opts = {}) {
      if (state === base && !opts.say) return;
      const changed = state !== base; base = state;
      if (!tempT) apply(state);
      if (opts.say || (changed && opts.talk && !tempT)) say(typeof opts.say === 'string' ? opts.say : pick(LINES[state] || LINES.idle));
    },
    react(state, ms = 2600, line) {
      clearTimeout(tempT); apply(state);
      tempT = setTimeout(() => { tempT = 0; apply(base); }, ms);
      if (line) say(line, Math.max(ms, 3000));
    },
    stage(n) { root.dataset.stage = String(n); },
    mood(m) { root.dataset.mood = m; },
    say, line: k => pick(LINES[k] || LINES.tap)
  };
}
