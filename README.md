# Pomodoro

A simple, offline-capable Pomodoro timer built as a Progressive Web App (PWA), so you can install it on your iPhone home screen without the App Store.

## Features

- Focus, short break and long break modes
- Progress ring, round counter, skip and reset
- Custom durations, rounds before long break, auto-start, sound and vibration
- Timer is based on timestamps, so it stays accurate when the app is in the background
- Keeps the screen awake while running
- Works offline after the first load
- Remembers your settings and state

## Install on iPhone

1. Open the app URL in **Safari**.
2. Tap the **Share** button.
3. Tap **Add to Home Screen**, then **Add**.

Open it from the home screen icon and it runs full-screen like a native app.

## Hosting

This repo is served with GitHub Pages from the `main` branch root.

## Notes

- `make_icons.py` regenerates the icons in `icons/` (needs Pillow).
- iOS cannot play sounds or run timers while the app is fully closed, so keep the app open (screen stays on) during a session.
