/**
 * NumberLand Local Database — IndexedDB layer
 *
 * To switch to server sync later, replace each method body with a fetch()
 * call keeping the same async signature — the rest of the app won't change.
 *
 * Stores:
 *   users     — registration info
 *   requests  — orders
 *   products  — API products cache
 *   settings  — user prefs (discount model, token, …)
 *   activity  — audit log
 */
const NB_DB = (() => {
    const DB_NAME    = 'NumberlandDB';
    const DB_VERSION = 1;
    let _db = null;

    // ── open / upgrade ────────────────────────────────────────────
    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = e => {
                const db = e.target.result;

                if (!db.objectStoreNames.contains('users')) {
                    const s = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('mobile', 'mobile', { unique: true });
                    s.createIndex('email',  'email',  { unique: false });
                }

                if (!db.objectStoreNames.contains('requests')) {
                    const s = db.createObjectStore('requests', { keyPath: 'id' });
                    s.createIndex('status',     'status');
                    s.createIndex('date',       'date');
                    s.createIndex('product_id', 'product_id');
                    s.createIndex('saved_at',   'saved_at');
                }

                if (!db.objectStoreNames.contains('products')) {
                    const s = db.createObjectStore('products', { keyPath: '_ckey' });
                    s.createIndex('category',  'category');
                    s.createIndex('cached_at', 'cached_at');
                }

                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                if (!db.objectStoreNames.contains('activity')) {
                    const s = db.createObjectStore('activity', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('timestamp', 'timestamp');
                    s.createIndex('action',    'action');
                }
            };

            req.onsuccess = e => { _db = e.target.result; resolve(_db); };
            req.onerror   = e => reject(e.target.error);
        });
    }

    // ── helpers ───────────────────────────────────────────────────
    const tx   = (store, mode = 'readonly') => _db.transaction(store, mode).objectStore(store);
    const wrap = req => new Promise((res, rej) => {
        req.onsuccess = e => res(e.target.result);
        req.onerror   = e => rej(e.target.error);
    });
    const all  = req => new Promise((res, rej) => {
        const items = [];
        req.onsuccess = e => {
            const cur = e.target.result;
            if (cur) { items.push(cur.value); cur.continue(); } else res(items);
        };
        req.onerror = e => rej(e.target.error);
    });

    // ── public API ────────────────────────────────────────────────
    const api = {

        /** Must be called once before any other method */
        init: async () => {
            await open();
            await api._migrateFromLocalStorage();
        },

        /** Migrate legacy localStorage data on first run */
        _migrateFromLocalStorage: async () => {
            const done = await api.getSetting('ls_migrated');
            if (done) return;

            const raw = localStorage.getItem('nb_reqs');
            if (raw) {
                try {
                    const reqs = JSON.parse(raw);
                    for (const r of reqs) {
                        await api.addRequest(r, true); // silent = skip activity log
                    }
                    console.log(`[NB_DB] Migrated ${reqs.length} requests from localStorage`);
                    localStorage.removeItem('nb_reqs');
                } catch (_) {}
            }

            await api.setSetting('ls_migrated', true);
        },

        // ── Users ─────────────────────────────────────────────────
        saveUser: async (user) => {
            await open();
            const id = await wrap(tx('users', 'readwrite').add({
                ...user,
                created_at: Date.now()
            }));
            await api.logActivity('register', { mobile: user.mobile, company: user.company });
            return id;
        },

        getAllUsers: async () => {
            await open();
            const items = await all(tx('users').openCursor());
            return items.sort((a, b) => b.created_at - a.created_at);
        },

        // ── Requests ──────────────────────────────────────────────
        addRequest: async (req, silent = false) => {
            await open();
            await wrap(tx('requests', 'readwrite').put({
                ...req,
                saved_at: req.saved_at || Date.now()
            }));
            if (!silent) await api.logActivity('new_request', { id: req.id, product: req.product, amount: req.amount });
        },

        getRequests: async ({ status, search } = {}) => {
            await open();
            let items = await all(tx('requests').openCursor());
            items.sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0));
            if (status) items = items.filter(r => r.status === status);
            if (search) {
                const s = search.toLowerCase();
                items = items.filter(r =>
                    r.id?.toLowerCase().includes(s) ||
                    r.product?.toLowerCase().includes(s) ||
                    r.email?.toLowerCase().includes(s)
                );
            }
            return items;
        },

        updateRequest: async (id, updates) => {
            await open();
            const store    = tx('requests', 'readwrite');
            const existing = await wrap(store.get(id));
            if (!existing) throw new Error('Request not found: ' + id);
            await wrap(store.put({ ...existing, ...updates, updated_at: Date.now() }));
            await api.logActivity('update_request', { id, ...updates });
        },

        countRequests: async () => {
            await open();
            return wrap(tx('requests').count());
        },

        countRequestsByStatus: async (status) => {
            await open();
            return wrap(tx('requests').index('status').count(IDBKeyRange.only(status)));
        },

        // ── Products cache ─────────────────────────────────────────
        cacheProducts: async (categories) => {
            await open();
            const store     = tx('products', 'readwrite');
            const cached_at = Date.now();
            for (const [cat, items] of Object.entries(categories)) {
                for (const p of items) {
                    await wrap(store.put({ ...p, _ckey: `${cat}:${p.id}`, category: cat, cached_at }));
                }
            }
        },

        getCachedProducts: async (maxAgeMs = 30 * 60 * 1000) => {
            await open();
            const items  = await all(tx('products').openCursor());
            const cutoff = Date.now() - maxAgeMs;
            const fresh  = items.filter(p => p.cached_at > cutoff);
            if (!fresh.length) return null;
            return fresh.reduce((acc, p) => {
                if (!acc[p.category]) acc[p.category] = [];
                acc[p.category].push(p);
                return acc;
            }, {});
        },

        clearProductCache: async () => {
            await open();
            return wrap(tx('products', 'readwrite').clear());
        },

        // ── Settings ──────────────────────────────────────────────
        getSetting: async (key) => {
            await open();
            const r = await wrap(tx('settings').get(key));
            return r?.value ?? null;
        },

        setSetting: async (key, value) => {
            await open();
            return wrap(tx('settings', 'readwrite').put({ key, value, updated_at: Date.now() }));
        },

        // ── Activity log ──────────────────────────────────────────
        logActivity: async (action, data = {}) => {
            await open();
            return wrap(tx('activity', 'readwrite').add({
                action,
                data,
                timestamp: Date.now(),
                date: new Date().toLocaleDateString('fa-IR')
            }));
        },

        getActivityLog: async (limit = 100) => {
            await open();
            const items = await all(tx('activity').openCursor());
            return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
        }
    };

    return api;
})();
