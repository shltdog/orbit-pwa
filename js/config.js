/**
 * Orbit client config — fill after deploying the free Cloudflare Worker.
 * Leave empty to hide push UI (local reminders still work).
 */
(function (global) {
  'use strict';
  global.OrbitConfig = {
    /** e.g. "https://orbit-push.your-subdomain.workers.dev" */
    PUSH_WORKER_URL: '',
    /** VAPID public key (URL-safe base64) from `npx web-push generate-vapid-keys` */
    VAPID_PUBLIC_KEY: ''
  };
})(typeof window !== 'undefined' ? window : globalThis);
