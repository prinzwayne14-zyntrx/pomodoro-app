# Zyntry

An offline-first focus timer for iPhone, Android, tablet and desktop — with **Zyn**, an animated wolf companion who focuses, rests and levels up with you.
Plain HTML/CSS/JS (ES modules): **no build step, no dependencies, no accounts, no servers.** Hosted free on GitHub Pages.

## Features

- **Zyn the wolf** — animated companion in the timer dial. Focused brows while you work, looks around when paused, sleeps on breaks, bounces when you finish, howls on level-up. Tap for encouragement.
- **Zyn evolves with your discipline** — Pup → Scout → Hunter → Alpha → Spirit Wolf, earned from routine, not raw hours: +1 point per active day, +2 per strong day (4+ XP sessions), +2 per day of your best streak. Points never go down. His mood follows your recent routine (energetic / sleepy after 2–3 days off / misses you after 4+).
- **Ranks with titles** — E Novice, D Apprentice, C Adept, B Expert, A Master, S Legend; each with its own colour and emblem, a rank-up celebration and progress to the next rank.
- **Statistics** — daily goal ring, evolution card, rank card, 14-day discipline score, 7-day chart with average line, best time of day to focus, 12-week calendar heatmap, totals and history. Tap any bar or cell for its value.
- **Sound** — louder, richer generated sounds (compressor + reverb), repeating end alarm (stops when you touch the screen), wolf howl on rank-up and evolution.
- **Notifications** — banner at the top of the screen when a session or break ends, with a "Send test" button. On iPhone the app must be on the Home Screen (iOS 16.4+).
- **Daily goal** — set a number of focus sessions per day; progress under the timer and in Stats ("goal days" over the last 7 days).
- **Focus sounds** — rain, brown noise, ocean waves, white noise. Generated on-device (no files, works offline), play only while a focus session runs. Quick toggle next to the task chip.
- **Streak** in the header, **quick add** a task right from the timer's task picker.
- **Timer** — focus / short break / long break, custom durations, start · pause · resume · reset · skip, glowing progress ring, 3-second countdown, 1-minute warning. Timestamp-based, so it stays accurate across refreshes, phone locks and long background periods.
- **Guards** — abandoning a running session (reset, skip, mode change) asks for confirmation. Changing durations never touches a running session.
- **RPG** — XP, levels, ranks E → D → C → B → A → S, level-up animation, daily/total XP.
- **Tasks** — add / edit / complete / delete, priorities, "today" view with carry-over, assign a task to a focus session (sessions are counted per task).
- **Statistics** — today / week / month focus time, daily average, best day, streak & best streak, completion rate, sessions, XP, 7-day chart, 28-day heatmap, full session history. Everything is computed from recorded sessions.
- **Sound** — synthesized effects (start, pause, countdown, session complete, break over, level-up, task done). Volume + master switch.
- **Settings** — durations, sessions before long break, auto-start, sound, notifications, accent colour (4), pure-black mode, calm mode (no motion).
- **Data safety** — validated local storage, unique session ids (no duplicates), corrupted data is kept aside instead of discarded, JSON export / import (merge or replace), confirmation before any destructive action.
- **Offline + auto-update** — service worker precaches the app; updates are fetched on launch, on return to the app and every 30 min, and applied automatically when no timer is running. User data is never touched by an update.

## XP rules (single source of truth: `js/rpg.js`)

| Event | XP |
|---|---|
| Focus session that runs to the end, ≥ 10 min | 1 per minute (max 180) |
| …and ≥ 20 min | +10 bonus |
| Focus session under 10 min, interrupted session, any break | 0 |

XP is stored on each session when it is recorded, so changing the rules later never rewrites history.
Level *n* needs 50·n·(n−1) total XP (100 for level 2, 300 for level 3, …). Ranks: E 1–4, D 5–9, C 10–14, B 15–24, A 25–39, S 40+.
Streaks count days with at least one XP-earning session. An interrupted session is logged (as "Interrupted") only if ≥ 1 minute was focused.

## Install on iPhone

1. Open the app URL in **Safari**.
2. **Share → Add to Home Screen → Add.**

## Run locally

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

## Tests

```bash
npm test          # unit tests, Node ≥ 18, no dependencies
npm run e2e       # browser tests: needs `npm i -D playwright` + a Chromium, and python3
```

The e2e suite covers timer persistence, sessions that end while the app is closed, duplicate protection across tabs, XP rules, the abandon guards, tasks, statistics, settings, backup/restore/reset, corrupted and legacy data, four screen sizes (no horizontal scroll, no overlapping controls), offline use and a real service-worker update.

## Icons

The logo lives in `icons/icon.svg`. After editing it run `npm run icons` (needs Playwright) to regenerate the PNGs.

## Releasing an update

Push to `main`. Bump `VERSION` in `sw.js` **and** `APP_VERSION` in `js/app.js` (a unit test fails if they differ). Installed copies update themselves.

## Known limits

- iOS suspends web apps when the screen locks or the app is closed: the timer is still correct when you return, but sounds and notifications cannot fire while suspended. Keep the app open during a session (it keeps the screen awake).
- Notifications appear while the app is open or was just sent to the background. A banner on a locked iPhone would need a push server, which this app deliberately does not use (no accounts, no servers). Tip: iPhone Settings → Notifications → Zyntry → Banner Style: Persistent.
- Data lives in the browser's local storage on one device. Use Export backup to move or protect it. (Data and backups from the app's previous name, Solo Leveling, carry over automatically.) Clearing Safari website data deletes it.
- The clock is the device clock; changing it can bend stats and XP (unavoidable for an offline app).
