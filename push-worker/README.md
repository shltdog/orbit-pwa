# Orbit Push Worker (optional, free)

Cloudflare Worker + KV that stores Web Push subscriptions and sends notifications.
The Orbit PWA works fully without this — local reminders do not need a Worker.

## One-time setup (Cloudflare free tier)

1. Install deps:
   ```bash
   cd push-worker
   npm install
   ```

2. Generate VAPID keys:
   ```bash
   npx web-push generate-vapid-keys
   ```
   Copy the **public** and **private** keys.

3. Create a KV namespace:
   ```bash
   npx wrangler kv namespace create SUBSCRIPTIONS
   npx wrangler kv namespace create SUBSCRIPTIONS --preview
   ```
   Paste the ids into `wrangler.toml`.

4. Login & set secrets:
   ```bash
   npx wrangler login
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT   # e.g. mailto:you@example.com
   npx wrangler secret put PUSH_SECRET     # long random string for /notify
   ```

5. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Note the `*.workers.dev` URL.

6. Wire the client — edit `../js/config.js`:
   ```js
   PUSH_WORKER_URL: 'https://orbit-push.<you>.workers.dev',
   VAPID_PUBLIC_KEY: '<public key from step 2>',
   ```
   Commit and push so GitHub Pages picks it up.

7. In Orbit → **Settings** → **Enable push reminders** (after enabling local notification permission).

## Send a test notify

```bash
curl -X POST "$WORKER_URL/notify" \
  -H "Authorization: Bearer $PUSH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"Orbit","body":"Hello from push"}'
```

## Cost

Cloudflare Workers free tier + KV free tier are enough for personal / small-friend use.
No user accounts; only push endpoints are stored.
