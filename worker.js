/**
 * B0R1S-OS Storage Worker
 * ========================
 * Cloudflare Worker that exposes a simple REST API over KV storage.
 *
 * Endpoints
 * ---------
 *   GET    /kv/:key          → { value } | 404
 *   POST   /kv               → body: { batch: { key: value, … } }  → 200 OK
 *   DELETE /kv/:key          → 200 OK
 *
 * KV Binding
 * ----------
 * Bind a KV namespace called  BORIS_STORE  in your wrangler.toml (see README).
 *
 * CORS
 * ----
 * Replace ALLOWED_ORIGIN with the URL where your index.html is served,
 * e.g. "https://boris-os.pages.dev"  or "*" for open access.
 */

const ALLOWED_ORIGIN = '*'; // ← change to your site URL for security

function cors(req) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function ok(req, body = null, status = 200) {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  return new Response(body ? JSON.stringify(body) : '{}', { status, headers });
}

function err(req, msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const { BORIS_STORE } = env;
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Pre-flight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    const path = url.pathname; // e.g. /kv/hos_username  or  /kv

    // ── GET /kv/:key ──────────────────────────────────────────────────
    if (method === 'GET' && path.startsWith('/kv/')) {
      const key = decodeURIComponent(path.slice(4)); // strip "/kv/"
      const value = await BORIS_STORE.get(key, { type: 'json' });
      if (value === null) return new Response('{"error":"not found"}', { status: 404, headers: cors(request) });
      return ok(request, { value });
    }

    // ── POST /kv  (batch write) ────────────────────────────────────────
    if (method === 'POST' && path === '/kv') {
      let body;
      try { body = await request.json(); } catch { return err(request, 'Invalid JSON'); }
      const { batch } = body || {};
      if (!batch || typeof batch !== 'object') return err(request, 'Missing batch object');

      // KV allows up to ~1 MB per value; large base64 images approach this.
      // We write each key sequentially to avoid rate-limit bursts.
      await Promise.all(
        Object.entries(batch).map(([k, v]) =>
          BORIS_STORE.put(k, JSON.stringify(v))
        )
      );
      return ok(request, { saved: Object.keys(batch).length });
    }

    // ── DELETE /kv/:key ───────────────────────────────────────────────
    if (method === 'DELETE' && path.startsWith('/kv/')) {
      const key = decodeURIComponent(path.slice(4));
      await BORIS_STORE.delete(key);
      return ok(request, { deleted: key });
    }

    return err(request, 'Not found', 404);
  },
};
