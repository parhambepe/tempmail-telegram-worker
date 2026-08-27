# Web UI

The same worker now serves a small single-page web app from `public/`.
The bot and the web app share one account and one dataset (KV), so an address
created in Telegram appears instantly on the web and vice versa.

## How login works

1. In the bot send `/web`.
2. The bot replies with a 6-digit code (valid 5 minutes, single use).
3. Open the worker URL (e.g. `https://tempmail-bot.<subdomain>.workers.dev`) and
   type the code.
4. The worker returns a session token (30 days) stored in `localStorage` and
   sent as `Authorization: Bearer <token>` on every API request.

KV keys used: `code:<code>` (300s TTL) and `session:<token>` (30d TTL).

## Files

| File | Purpose |
| --- | --- |
| `public/index.html` | App shell (login view, inbox, addresses, settings, message sheet) |
| `public/app.css` | Styles, light + dark, mobile first, RTL |
| `public/app.js` | Client logic, polls the inbox every 20s. `?demo=1` shows mock data |
| `public/manifest.webmanifest` | PWA manifest (installable on Android/iOS) |
| `public/sw.js` | Caches the app shell only; API is always live |
| `src/api.js` | JSON API under `/api/*` |
| `src/webAuth.js` | Login codes and session tokens |

## API

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/session` | `{ code }` -> `{ token }` |
| POST | `/api/logout` | Invalidates the current token |
| GET | `/api/me` | Addresses, settings, domain, limits |
| POST | `/api/addresses` | `{ type: "temp" \| "perm", local? }` |
| DELETE | `/api/addresses/<address>` | Deletes one address |
| GET | `/api/messages?limit=20` | Inbox list (max 50) |
| GET | `/api/messages/get?key=...` | Full message, scoped to the session |
| POST | `/api/settings` | `{ notify?, showLinks? }` |

All routes except `/api/session` require the bearer token.

## Optional: PNG icons

Add `public/icon-192.png` and `public/icon-512.png` for a nicer install icon.
The app works without them (an inline SVG favicon is used).

## Android app: three options

1. **PWA ("Add to home screen")** - no build at all. Chrome on Android installs
   the site as a standalone app using `manifest.webmanifest`. Already working.
2. **TWA / Bubblewrap APK** - a real `.apk`/`.aab` that renders this exact web
   app full screen with the Chrome engine. Requires a custom domain and
   `/.well-known/assetlinks.json` served from it, plus a signing keystore.
   Can be produced by GitHub Actions on every tag.
3. **WebView wrapper APK** - ~50 lines of Kotlin around a `WebView`. Works on
   any domain including `*.workers.dev`, no verification files, but no PWA
   niceties (no offline shell, no push).

Recommended: use option 1 today; add option 2 once the custom domain is live.
