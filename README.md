# TempMail Telegram Bot (Cloudflare Workers)

A Telegram bot that creates temporary and permanent email addresses and forwards
every incoming email straight into a Telegram chat. Runs entirely on Cloudflare's
free tier: Email Routing + Workers + KV.

```
sender -> Cloudflare Email Routing (catch-all) -> Email Worker -> Telegram Bot API -> you
```

## Features

- Temporary addresses with automatic expiry (KV TTL)
- Permanent custom addresses with a per-user quota
- Inbox of the last 30 days, message viewer, attachments up to 20MB
- Gift codes and referral links that grant extra permanent slots
- Per-user settings (notifications on/off)

## Project layout

| File | Purpose |
| --- | --- |
| `src/index.js` | Worker entry: Telegram webhook + `email()` handler + `/init` setup route |
| `src/bot.js` | Commands, menus, inline buttons |
| `src/email.js` | Parses incoming mail and pushes it to Telegram |
| `src/store.js` | All KV reads/writes |
| `src/telegram.js` | Bot API client and keyboards |

## 1. Create the bot

1. Talk to `@BotFather`, run `/newbot`, copy the token.
2. Note your bot username (used for invite links).

## 2. Create the KV namespace

```bash
npm install
npx wrangler login
npx wrangler kv namespace create MAILBOX
```

Paste the returned `id` into `wrangler.toml` under `[[kv_namespaces]]`, and set
`MAIL_DOMAIN` and `BOT_USERNAME` in the `[vars]` block. Commit the change.

## 3. Add the secrets

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET   # any random string
npx wrangler secret put SETUP_TOKEN      # any random string
npx wrangler secret put ADMIN_ID         # your numeric Telegram id
```

If you deploy from GitHub instead of your laptop, add the same four values in the
Cloudflare dashboard: Workers and Pages -> your worker -> Settings -> Variables
and Secrets -> Add (type: Secret).

## 4. Deploy directly from GitHub (Workers Builds)

Cloudflare can build and deploy this repo on every push, no GitHub Actions needed:

1. Cloudflare dashboard -> Workers and Pages -> Create -> Workers -> Import a repository.
2. Authorize the Cloudflare GitHub app and pick this repository.
3. Build settings:
   - Build command: `npm install`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
4. Save and deploy. Every later `git push` to `main` triggers a new deployment.

Already deployed once from your laptop? Then open the existing worker ->
Settings -> Build -> Connect to Git and select the repo instead.

Manual deploy stays available with `npm run deploy`.

## 5. Register the Telegram webhook

Open this once in a browser (replace both placeholders):

```
https://tempmail-bot.<your-subdomain>.workers.dev/init?token=YOUR_SETUP_TOKEN
```

You should get JSON with `"ok": true`. The bot now answers `/start`.

## 6. Turn on Email Routing for your domain

1. Add your domain to Cloudflare and let it use Cloudflare nameservers.
2. Domain -> Email -> Email Routing -> Enable (this adds the MX and SPF records).
3. Routing rules -> Catch-all address -> Action: `Send to a Worker` -> pick `tempmail-bot`.
4. Set `MAIL_DOMAIN` in `wrangler.toml` to that domain and push again.

Catch-all is what makes unlimited addresses possible: any local part is accepted
and the Worker decides who owns it.

## Notes and limits

- Free Workers plan: 100k requests/day; KV free tier: 1k writes/day, 100k reads/day.
- Incoming email only. Cloudflare Email Workers cannot send arbitrary outbound
  mail; add MailChannels, Resend or Postmark if you need replies.
- Messages older than 30 days are removed automatically (`MSG_TTL` in `store.js`).
- Unknown or expired addresses are rejected with a bounce, so no junk is stored.
- Debug with `npx wrangler tail`.

## License

MIT
