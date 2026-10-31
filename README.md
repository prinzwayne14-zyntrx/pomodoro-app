# Solo Leveling

An offline-first focus timer for iPhone, Android, tablet and desktop that turns discipline into progression.
Plain HTML/CSS/JS (ES modules): **no build step, no dependencies, no accounts, no servers.** Hosted free on GitHub Pages.

## Features

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

## Releasing an update

Push to `main`. Bump `VERSION` in `sw.js` **and** `APP_VERSION` in `js/app.js` (a unit test fails if they differ). Installed copies update themselves.

## Known limits

- iOS suspends web apps when the screen locks or the app is closed: the timer is still correct when you return, but sounds and notifications cannot fire while suspended. Keep the app open during a session (it keeps the screen awake).
- Notifications only appear while the app is running. True background alerts need a push server, which would not be free or offline.
- Data lives in the browser's local storage on one device. Use Export backup to move or protect it. Clearing Safari website data deletes it.
- The clock is the device clock; changing it can bend stats and XP (unavoidable for an offline app).
