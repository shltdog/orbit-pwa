# Orbit

Offline-first Progressive Web App for personal habits, tasks, and progression tracking.  
No accounts. No backend. Data stays in your browser (IndexedDB) and works offline after first load.

**Working name:** Orbit — dark UI, red accents, XP / levels / streak with freeze recovery.

## Features (MVP)

- **Today** — quick-add tasks or habits, one-tap complete
- **Progress** — level, XP bar, streak + best, freeze remaining, today %, last 7 days
- **Backup** — JSON export / import
- **Installable PWA** — manifest + service worker + home-screen icons
- Core functions always available (nothing locked behind levels)

## Run locally

Serve the folder over HTTP (required for service workers):

```bash
cd orbit-pwa
python3 -m http.server 8765
```

Open `http://localhost:8765` in a browser.

Or any static server:

```bash
npx --yes serve -l 8765
```

## Host for free

### GitHub Pages

1. Create a repo (e.g. `orbit-pwa`) and push these files to the root (or `docs/`).
2. **Settings → Pages →** Deploy from branch `main` / root (or `/docs`).
3. Visit `https://<user>.github.io/<repo>/`.

### Cloudflare Pages

1. Connect the repo (or upload the folder / zip).
2. Build command: none. Output directory: `/` (project root).
3. Deploy. Use the `*.pages.dev` URL or a custom domain.

HTTPS is required for install / service worker on real devices.

## Install on iPhone

1. Open the hosted URL in **Safari** (not Chrome/in-app browsers).
2. Tap the **Share** button.
3. Tap **Add to Home Screen**.
4. Confirm name **Orbit** → **Add**.

Launch from the home screen for standalone mode. After the first visit, the app shell caches for offline use.

## Data & backups

- Everything is stored locally in IndexedDB (`orbit-db`).
- **Progress → Export JSON** downloads a backup.
- **Import JSON** replaces local data (confirm first).
- Clearing Safari site data / “Reset all data” in Settings wipes Orbit on that device.

## Gamification (MVP)

| Action | XP |
|--------|-----|
| Complete habit | +10 |
| Complete task | +15 |

- Levels use a simple cumulative curve: level *N* starts at `100 × (N−1)×N / 2` XP.
- Streak counts consecutive active days (any habit/task completion).
- **Freeze recovery:** one miss can be covered by a freeze so the streak does not reset; freezes soft-refill after sustained activity.

## Project layout

```
orbit-pwa/
  index.html
  css/styles.css
  js/db.js
  js/gamification.js
  js/app.js
  sw.js
  manifest.webmanifest
  icons/icon-192.png
  icons/icon-512.png
  icons/icon.svg
  README.md
```

## Known MVP limitations

- No push notifications or reminders
- No recurring task schedules beyond daily habits
- No multi-device sync (use JSON export/import)
- Undoing a completion subtracts XP but does not perfectly reverse historical streak edge cases
- Icons are simple geometric marks (not a full brand kit)
- Best installed via Safari on iOS; Add to Home Screen is Safari-only

## License

Personal use. Built as a private LifeOS / Orbit tracker MVP.
