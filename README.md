# Solo Leveling

A premium focus timer for your iPhone that levels you up. Installable as a Progressive Web App (PWA), no App Store needed.

## Features

- **Focus / short break / long break** with a glowing progress ring
- **Level & rank system**: every focused minute earns XP (+10 bonus per completed session). Ranks go E → D → C → B → A → S
- **Statistics** built from real elapsed time: today, week, daily average, day streak, best streak, total focus, completion rate, best day, 7-day chart, 28-day heatmap. They update live while a session runs
- **Sound effects** (synthesized, no files): start, pause, final 3-second countdown, session complete, break end, level up. Adjustable volume and on/off
- **Auto-update**: the app checks for a new version on launch, when you come back to it, and every 30 minutes, then reloads itself as soon as the timer isn't running
- Works offline after the first load; keeps the screen awake while a session runs
- Timer uses timestamps, so it stays accurate if the app is backgrounded

## How stats are counted

- A session that runs to the end is logged as **completed** at its full length.
- Leaving a focus session early (reset, skip, switching mode) logs the time actually focused as **interrupted** if it was at least 1 minute. Shorter attempts are not counted.
- Skipping a focus session does not count toward your round count or the streak.
- Streak = consecutive days with at least one completed focus session.

## Install on iPhone

1. Open the app URL in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.

## Releasing an update

Edit the files and push to `main`. Installed copies pick it up automatically. For tidy cache handling also bump `VERSION` in `sw.js` and `APP_VERSION` in `index.html`.

## Notes

- iOS suspends web apps when the screen locks or the app is closed, so the end-of-session sound plays when you return. Keep the app open during a session.
- `make_icons.py` regenerates the icons in `icons/` (needs Pillow).
