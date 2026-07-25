/**
 * NumberLand DB client
 * Talks to server.py running on localhost:5055.
 * Same async API as the IndexedDB version — nothing else in the app changes.
 *
 * To run the server:
 *   pip install flask flask-cors
 *   python server.py
 */
const NB_DB = (() => {
    const BASE = 'http://127.0.0.1:5055/api';
    let _ready = false;

    async function req(path, opts = {}) {
        const res = await fetch(BASE + path, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            ...opts
        });
        if (!res.ok) throw new Error(`[NB_DB] ${opts.method || 'GET'} ${path} → ${res.status}`);
        return res.json();
    }

    const GET    = path         => req(path);
    const POST   = (path, body) => req(path, { method: 'POST',  body: JSON.stringify(body) });
    const PATCH  = (path, body) => req(path, { method: 'PATCH', body: JSON.stringify(body) });

    return {
        // ── init ───────────────────────────────────────────────
        init: async () => {
            if (_ready) return;
            try {
                await GET('/settings/db_ready');
                _ready = true;
                console.log('[NB_DB] Connected to local server ✓');
            } catch {
                console.error(
                    '[NB_DB] ⚠ Cannot reach local server at localhost:5055.\n' +
                    '  Run:  pip install flask flask-cors && python server.py'
                );
            }
        },

        // ── Users ──────────────────────────────────────────────
        saveUser:    async (user)  => POST('/users', user),
        getAllUsers: async ()       => GET('/users'),

        // ── Requests ───────────────────────────────────────────
        addRequest:   async (r, _silent) => POST('/requests', r),
        getRequests:  async ({ status, search } = {}) => {
            const p = new URLSearchParams();
            if (status) p.set('status', status);
            if (search) p.set('search', search);
            const qs = p.toString();
            return GET('/requests' + (qs ? '?' + qs : ''));
        },
        updateRequest: async (id, updates) => PATCH(`/requests/${id}`, updates),
        countRequests: async () => (await GET('/requests')).length,
        countRequestsByStatus: async (status) =>
            (await GET(`/requests?status=${status}`)).length,

        // ── Products cache ─────────────────────────────────────
        cacheProducts:    async (cats)        => POST('/products/cache', cats),
        getCachedProducts: async (maxAgeMs = 30 * 60 * 1000) =>
            GET(`/products/cache?maxAge=${maxAgeMs}`),

        // ── Settings ───────────────────────────────────────────
        getSetting: async (key)        => GET(`/settings/${key}`),
        setSetting: async (key, value) => POST('/settings', { key, value }),

        // ── Activity log ───────────────────────────────────────
        logActivity:    async (action, data = {}) => POST('/activity', { action, data }),
        getActivityLog: async (limit = 100)        => GET(`/activity?limit=${limit}`)
    };
})();
