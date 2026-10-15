/**
 * Orbit Push Worker — free Cloudflare Worker + KV
 *
 * POST /subscribe   { endpoint, keys: { p256dh, auth } }
 * POST /unsubscribe { endpoint }
 * POST /notify      Authorization: Bearer <PUSH_SECRET>
 *                   { title?, body?, tag?, url?, endpoint? }  // endpoint = one sub; omit = all
 * GET  /health
 */
import webpush from 'web-push';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function configureVapid(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID keys not configured');
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || 'mailto:orbit@example.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
}

function subKey(endpoint) {
  // KV key from endpoint — stable & unique
  let h = 0;
  const s = String(endpoint);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 'sub:' + Math.abs(h).toString(36) + ':' + s.slice(-24).replace(/\W/g, '');
}

async function listSubs(env) {
  const listed = await env.SUBSCRIPTIONS.list({ prefix: 'sub:' });
  const out = [];
  for (const key of listed.keys) {
    const raw = await env.SUBSCRIPTIONS.get(key.name);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch (_) { /* skip */ }
  }
  // Handle pagination lightly
  let cursor = listed.list_complete ? null : listed.cursor;
  while (cursor) {
    const page = await env.SUBSCRIPTIONS.list({ prefix: 'sub:', cursor });
    for (const key of page.keys) {
      const raw = await env.SUBSCRIPTIONS.get(key.name);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch (_) { /* skip */ }
    }
    cursor = page.list_complete ? null : page.cursor;
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      return json({ ok: true, app: 'orbit-push', pushConfigured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) });
    }

    if (request.method === 'POST' && path === '/subscribe') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON' }, 400); }
      if (!body || !body.endpoint || !body.keys || !body.keys.p256dh || !body.keys.auth) {
        return json({ error: 'Invalid subscription' }, 400);
      }
      const key = subKey(body.endpoint);
      await env.SUBSCRIPTIONS.put(key, JSON.stringify({
        endpoint: body.endpoint,
        keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
        updatedAt: new Date().toISOString(),
      }));
      return json({ ok: true });
    }

    if (request.method === 'POST' && path === '/unsubscribe') {
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON' }, 400); }
      if (!body || !body.endpoint) return json({ error: 'endpoint required' }, 400);
      await env.SUBSCRIPTIONS.delete(subKey(body.endpoint));
      return json({ ok: true });
    }

    if (request.method === 'POST' && path === '/notify') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!env.PUSH_SECRET || token !== env.PUSH_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }
      let body;
      try { body = await request.json(); } catch (_) { body = {}; }

      try { configureVapid(env); } catch (e) {
        return json({ error: e.message }, 500);
      }

      const payload = JSON.stringify({
        title: body.title || 'Orbit',
        body: body.body || 'Time for your habits.',
        tag: body.tag || 'orbit-push',
        url: body.url || '/',
      });

      let targets;
      if (body.endpoint) {
        const raw = await env.SUBSCRIPTIONS.get(subKey(body.endpoint));
        targets = raw ? [JSON.parse(raw)] : [];
      } else {
        targets = await listSubs(env);
      }

      let sent = 0;
      const errors = [];
      for (const sub of targets) {
        try {
          await webpush.sendNotification(sub, payload);
          sent += 1;
        } catch (err) {
          const status = err.statusCode || err.status;
          if (status === 404 || status === 410) {
            await env.SUBSCRIPTIONS.delete(subKey(sub.endpoint));
          }
          errors.push({ endpoint: sub.endpoint, status, message: String(err.message || err) });
        }
      }
      return json({ ok: true, sent, failed: errors.length, errors: errors.slice(0, 10) });
    }

    return json({ error: 'Not found' }, 404);
  },
};
