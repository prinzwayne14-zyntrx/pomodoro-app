# ZENTRY

A personal productivity app for iPhone, Android, tablet and desktop: Pomodoro focus sessions, exercise and habit tracking, accurate statistics, **Zyn** (a wolf companion that evolves with your discipline) and a **private AI chat assistant** that records what you did.

Plain HTML/CSS/JS (ES modules): **no build step, no accounts, no servers.** Everything is stored on your device and works offline. Hosted free on GitHub Pages.

## Install on iPhone

1. Open the app URL in **Safari** → **Share → Add to Home Screen → Add**. The launcher shows the ZENTRY wolf icon.
2. Already installed an older version (Solo Leveling / Zyntry)? It updates itself and keeps your data. iOS caches the home-screen icon and name: to see the new icon, export a backup (Settings → Data), delete the old icon and add it again.

## Features

| Area | What you get |
|---|---|
| **Focus timer** | Focus / short / long break, custom durations, auto-start, 3-second countdown, repeating end alarm, focus sounds (rain, brown noise, waves, white noise), banner notifications, screen kept awake. |
| **Zyn (chat)** | Natural language logging: “I did 20 squats and a 45-second plank”, “read 15 pages yesterday”, “actually it was 25”. Questions answered from your data: “How many push-ups this week?”, “What did I accomplish today?”, “What should I improve tomorrow?”. Timer commands and goals. Voice input with review before sending. |
| **Track** | Today’s goals, quick-log buttons, a manual form (any day in the past), and the full entry list with edit / delete / undo. |
| **Statistics** | *Focus* tab: today, goal ring, evolution, rank, 14-day consistency score, 7-day chart, best time of day, 12-week heatmap, totals and history. *Activity* tab: entries per day / week / month, exercise days, habit completion rates (7 and 30 days), totals per activity, exercise history. Tap any **i** for the exact definition. |
| **Zyn the wolf** | Moods follow real events: calm (idle), alert (focus), motivated (second half of a session), relaxed / asleep (break), proud (today’s goal met), serious (yesterday’s goal missed), celebrating (level-up, rank-up, evolution). Evolves Pup → Scout → Hunter → Alpha → Spirit Wolf from discipline points (active days, strong days, best streak) — never lost. Speaks at key moments (optional, adjustable volume, device voices). |
| **Appearance** | 10 backgrounds (Aurora, AMOLED, Charcoal, Midnight, Purple, Dusk, Wolf moon, Mountains, Forest, Light), 4 accent colours, calm mode. Backgrounds are lightweight vector art; picture backgrounds get a dimming layer and more opaque cards for readability. |
| **Data** | Local storage with validation, migrations, duplicate protection, audit trail of activity changes, JSON backup / restore (old Solo Leveling and Zyntry backups import too). |

## How the AI assistant records data safely

```
message ─► engine (built-in parser | on-device model | local server)  ── proposes JSON only
        ─► sanitize()      coerce to the schema, drop unknown fields
        ─► validateItems() catalog lookup, unit normalisation, dates (local calendar), limits,
                           every number must appear in your message (no invented amounts)
        ─► clarify / confirm when anything is missing or unusual (unknown activity, huge amount,
                           manual Pomodoro sessions, corrections that could mean “more”, every deletion)
        ─► store.addActivities()  all-or-nothing write; rolled back if the device refuses
        ─► reply built from the records the store returned  (+ Undo)
```

The model can never write to storage. If an AI engine is unavailable, times out or returns nonsense, the built-in parser takes over and the reply says so.

### Language engines (Settings → AI assistant)

1. **Built-in parser** (default) — deterministic, instant, offline, nothing leaves the device. Handles the phrasing in the examples above, number words, sets (“3×10”), mixed units, past dates.
2. **On-device AI model** — [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.79 (vendored in `js/vendor`, Apache-2.0) running Qwen 2.5 0.5B / 1.5B or Llama 3.2 1B in a Web Worker on the GPU. Requires **WebGPU**: iOS / iPadOS 26+ Safari, recent Chrome / Edge, Safari 26 on Mac. One-time download (~280 MB – 900 MB, from Hugging Face), then offline. Small phones may not have enough GPU memory for the larger models.
3. **Local model server** — any [Ollama](https://ollama.com) or OpenAI-compatible server (LM Studio, llama.cpp) on your computer or network, e.g. `ollama pull qwen2.5:1.5b`, then start it with `OLLAMA_ORIGINS=*` so the browser may call it. Safari blocks `http://` addresses from the HTTPS site except `localhost`; use it from a desktop browser on the same machine, or serve ZENTRY locally.

## Definitions (single source of truth: `js/analytics.js`, `js/rpg.js`)

- **Days** are local calendar days on the device. **This week** = Monday → today. **This month** = calendar month. **Last 7 / 30 days** include today.
- **Focus time** = every focused minute, including interrupted sessions of ≥ 1 min. **Sessions** = completed focus sessions only. Sessions added by hand (via chat, after confirmation) count as focus time but never earn XP.
- **Interrupted sessions**: resetting / skipping / switching mode during a focus session asks first; if you abandon it after ≥ 1 minute it is logged as *Interrupted* (0 XP), shorter ones are discarded.
- **XP**: only focus sessions that run to the end and last ≥ 10 min (1 XP/min, +10 for ≥ 20 min). **Streak**: consecutive days with ≥ 1 XP-earning session.
- **Activities** count on the day they happened (`day`), not when they were typed. Totals never mix units. Edits and deletions update every statistic immediately — nothing is stored as a separate counter.
- **Habit completion** = days the daily goal was met ÷ days in the window. **Consistency (14 days)** = 60 % days you showed up + 40 % strong days (4+ sessions).

## Architecture

```
index.html, style.css          UI shell + design system (tokens, dark & light themes, backgrounds)
js/app.js                      wiring: timer UI, navigation, settings, notifications, updates
js/timer.js                    pure timestamp-based timer logic
js/store.js                    validated local storage, migrations, activities, goals, audit, backup
js/catalog.js                  supported activities, aliases, units, limits
js/analytics.js, js/rpg.js     statistics, ranges, XP, ranks, discipline / evolution
js/ai/nlu.js                   built-in language understanding
js/ai/validate.js              sanitize + validate (the gate before storage)
js/ai/engines.js               engine interface: rules, WebLLM (WebGPU), local server
js/ai/assistant.js             conversation, clarifications, confirmations, read-only answers
js/ui/chat.js, js/ui/track.js  chat and tracking screens
js/voice.js, js/wolf.js, js/audio.js   voice, companion, generated sounds
```

## Tests

```bash
npm test          # 55 unit tests (Node ≥ 18); the analytics tests re-run in New York, India and Auckland time zones
npm run e2e       # 38 browser tests (needs `playwright` + Chromium, python3)
npm run icons     # re-render launcher icons from icons/icon.svg + icons/maskable.svg
```

## Releasing an update

Push to `main`. Bump `VERSION` in `sw.js` **and** `APP_VERSION` in `js/app.js` (a unit test checks they match). Installed copies update themselves; user data is never touched by an update.

## Known limits

- iOS suspends web apps when the screen locks: the timer is still correct when you return, but sounds, speech and notifications cannot fire while suspended. A banner on a locked phone would need a push server, which ZENTRY deliberately does not use.
- Voice input uses the browser’s speech recognition, which on iPhone and Chrome may be processed by Apple / Google. It is optional and you always review the text before it is sent.
- Speech uses voices installed on the device; quality depends on the device (iPhone “Enhanced/Premium” voices sound best — Settings → Accessibility → Spoken Content → Voices).
- Data lives on one device (no cloud sync). Use Export backup to move or protect it. Clearing website data deletes it.
