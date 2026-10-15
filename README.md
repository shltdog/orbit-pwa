# Orbit

Offline-first Progressive Web App for personal habits, tasks, and progression tracking.  
No accounts. No paid backend. Core data stays in each visitor’s browser (IndexedDB) and works offline after first load.

**Live:** https://shltdog.github.io/orbit-pwa/

## Features

- **Today** — quick-add tasks / habits, one-tap complete, haptics + completion pulse
- **Habit schedules** — daily, weekdays, or custom days of week (Today only shows what’s due)
- **Reminders** — optional per-habit `HH:MM` local notifications (permission requested from Settings only)
- **Presets** — Morning / Evening check-in packs
- **Progress** — XP, levels, streak + freeze, today %, last 7 days
- **Weekly review** — avg completion, best day, most-missed habits, XP this week
- **Share** — send the app URL; friends get their own blank Orbit (their data never mixes with yours)
- **Casual PIN lock** — optional 4–6 digit PIN hashed on-device (not strong encryption)
- **Backup** — JSON export / import (validated Orbit backups only)
- **Optional Web Push** — free Cloudflare Worker scaffold in `push-worker/` (off until you configure it)
- Core functions always available (nothing locked behind levels)

## Sharing (how it stays free & private)

Anyone who opens your GitHub Pages link gets a **fresh empty app** with data only in **their** IndexedDB. Sharing the URL shares the *app*, not your habits. Use Export/Import JSON to move *your* data between devices.

## Run locally

```bash
cd orbit-pwa
python3 -m http.server 8765
```

Open `http://localhost:8765` (service workers need HTTP(S)).

## Host for free

Already on GitHub Pages from this repo (`master` → Pages).  
Or Cloudflare Pages: no build command, output `/`.

## Install on iPhone

1. Open the HTTPS URL in **Safari**.
2. Share → **Add to Home Screen**.
3. Launch from the icon for standalone mode.

### iOS notifications (honest limits)

| Capability | Reality on iPhone |
|------------|-------------------|
| Add to Home Screen PWA | Required for the best experience |
| Local notifications | Best-effort: work when permission is granted and the app/SW can run a check. Not as reliable as native apps when the PWA is fully killed. |
| Web Push | Supported for Home Screen PWAs on **iOS 16.4+**. Needs the optional Worker + VAPID config. Still requires user permission. |
| Permission prompt | Orbit only asks when you tap **Enable** in Settings — never on first load. |

Android / desktop Chromium generally have stronger background notification support.

## Optional: free Web Push (Cloudflare Worker)

See **[`push-worker/README.md`](push-worker/README.md)** for the full checklist.

Short version:

1. `cd push-worker && npm install`
2. `npx web-push generate-vapid-keys`
3. Create KV namespace, set secrets (`VAPID_*`, `PUSH_SECRET`), `npx wrangler deploy`
4. Put Worker URL + **public** VAPID key into `js/config.js`
5. Push to GitHub Pages and enable push in Orbit Settings

Until `PUSH_WORKER_URL` and `VAPID_PUBLIC_KEY` are set, the push UI stays hidden. Local reminders still work.

## Gamification

| Action | XP |
|--------|-----|
| Complete habit | +10 |
| Complete task | +15 |

- Levels: level *N* starts at `100 × (N−1)×N / 2` XP.
- Streak: consecutive active days; **one freeze** can cover a single miss.
- Features are never gated by level.

## Project layout

```
orbit-pwa/
  index.html
  css/styles.css
  js/config.js          # push placeholders
  js/db.js              # IndexedDB + schedules + PIN
  js/gamification.js
  js/reminders.js       # local + push client
  js/app.js
  sw.js                 # cache orbit-v3 + notifications
  manifest.webmanifest
  icons/
  push-worker/          # optional Cloudflare Worker
  README.md
```

## Data & backups

- IndexedDB database: `orbit-db` (schema v2 — habits gain `schedule`, `daysOfWeek`, `reminderTime`).
- **Progress → Export / Import JSON**. Imports must be Orbit backups (`app: "Orbit"`); bad files do not wipe data.
- Clearing site data or **Reset all data** wipes Orbit on that device only.

## License

Personal use. Built as a private LifeOS / Orbit tracker MVP.
