"""
NumberLand Local DB Server
Run:  python server.py
Deps: pip install flask flask-cors

Data is saved to numberland.db (SQLite) next to this file.
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3, json, os
from datetime import datetime

app  = Flask(__name__)
CORS(app)

DB_PATH = os.path.join(os.path.dirname(__file__), 'numberland.db')

# ── helpers ───────────────────────────────────────────────────────
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def now_ms():
    return int(datetime.now().timestamp() * 1000)

def jdump(v):
    return json.dumps(v, ensure_ascii=False)

def jload(s):
    try:    return json.loads(s)
    except: return s

# ── init schema ───────────────────────────────────────────────────
def init_db():
    conn = db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            mobile       TEXT UNIQUE,
            email        TEXT,
            company      TEXT,
            source       TEXT,
            registered_at TEXT,
            created_at   INTEGER
        );

        CREATE TABLE IF NOT EXISTS requests (
            id         TEXT PRIMARY KEY,
            product    TEXT,
            email      TEXT,
            quantity   INTEGER,
            status     TEXT DEFAULT "PENDING",
            date       TEXT,
            saved_at   INTEGER,
            updated_at INTEGER,
            data       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_req_status   ON requests(status);
        CREATE INDEX IF NOT EXISTS idx_req_saved_at ON requests(saved_at);

        CREATE TABLE IF NOT EXISTS products (
            ckey       TEXT PRIMARY KEY,
            category   TEXT,
            cached_at  INTEGER,
            data       TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT,
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS activity (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            action    TEXT,
            data      TEXT,
            timestamp INTEGER,
            date      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_act_ts ON activity(timestamp);
    ''')
    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════════
@app.route('/api/users', methods=['GET'])
def list_users():
    conn = db()
    rows = conn.execute('SELECT * FROM users ORDER BY created_at DESC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/users', methods=['POST'])
def add_user():
    d = request.json or {}
    conn = db()
    try:
        conn.execute(
            'INSERT OR IGNORE INTO users (mobile,email,company,source,registered_at,created_at) VALUES (?,?,?,?,?,?)',
            (d.get('mobile'), d.get('email'), d.get('company'),
             d.get('source'), d.get('registered_at'), now_ms())
        )
        conn.commit()
        row = conn.execute('SELECT id FROM users WHERE mobile=?', (d.get('mobile'),)).fetchone()
        conn.close()
        return jsonify({'id': row['id'] if row else None})
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 400


# ══════════════════════════════════════════════════════════════════
# REQUESTS
# ══════════════════════════════════════════════════════════════════
@app.route('/api/requests', methods=['GET'])
def list_requests():
    status = request.args.get('status')
    search = (request.args.get('search') or '').lower()
    conn = db()
    rows = conn.execute('SELECT data FROM requests ORDER BY saved_at DESC').fetchall()
    conn.close()
    items = [jload(r['data']) for r in rows]
    if status: items = [r for r in items if r.get('status') == status]
    if search:
        items = [r for r in items if
                 search in (r.get('id') or '').lower() or
                 search in (r.get('product') or '').lower() or
                 search in (r.get('email') or '').lower()]
    return jsonify(items)

@app.route('/api/requests', methods=['POST'])
def add_request():
    d = request.json or {}
    conn = db()
    conn.execute(
        '''INSERT OR REPLACE INTO requests
           (id, product, email, quantity, status, date, saved_at, data)
           VALUES (?,?,?,?,?,?,?,?)''',
        (d.get('id'), d.get('product'), d.get('email'), d.get('quantity'),
         d.get('status','PENDING'), d.get('date'), now_ms(), jdump(d))
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/requests/<req_id>', methods=['PATCH'])
def update_request(req_id):
    updates = request.json or {}
    conn = db()
    row = conn.execute('SELECT data FROM requests WHERE id=?', (req_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'not found'}), 404
    rec = jload(row['data'])
    rec.update(updates)
    rec['updated_at'] = now_ms()
    conn.execute(
        'UPDATE requests SET status=?, updated_at=?, data=? WHERE id=?',
        (rec.get('status'), rec['updated_at'], jdump(rec), req_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ══════════════════════════════════════════════════════════════════
# PRODUCTS CACHE
# ══════════════════════════════════════════════════════════════════
@app.route('/api/products/cache', methods=['POST'])
def cache_products():
    cats = request.json or {}
    conn = db()
    ts = now_ms()
    for cat, items in cats.items():
        for p in items:
            ckey = f"{cat}:{p.get('id')}"
            conn.execute(
                'INSERT OR REPLACE INTO products (ckey, category, cached_at, data) VALUES (?,?,?,?)',
                (ckey, cat, ts, jdump(p))
            )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/products/cache', methods=['GET'])
def get_product_cache():
    max_age = int(request.args.get('maxAge', 30 * 60 * 1000))
    cutoff  = now_ms() - max_age
    conn    = db()
    rows    = conn.execute('SELECT * FROM products WHERE cached_at > ?', (cutoff,)).fetchall()
    conn.close()
    if not rows:
        return jsonify(None)
    result = {}
    for r in rows:
        cat = r['category']
        if cat not in result: result[cat] = []
        result[cat].append(jload(r['data']))
    return jsonify(result)


# ══════════════════════════════════════════════════════════════════
# SETTINGS
# ══════════════════════════════════════════════════════════════════
@app.route('/api/settings/<key>', methods=['GET'])
def get_setting(key):
    conn = db()
    row  = conn.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    conn.close()
    return jsonify(jload(row['value']) if row else None)

@app.route('/api/settings', methods=['POST'])
def set_setting():
    d = request.json or {}
    conn = db()
    conn.execute(
        'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,?)',
        (d.get('key'), jdump(d.get('value')), now_ms())
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ══════════════════════════════════════════════════════════════════
# ACTIVITY LOG
# ══════════════════════════════════════════════════════════════════
@app.route('/api/activity', methods=['GET'])
def list_activity():
    limit = int(request.args.get('limit', 100))
    conn  = db()
    rows  = conn.execute('SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?', (limit,)).fetchall()
    conn.close()
    return jsonify([{**dict(r), 'data': jload(r['data'])} for r in rows])

@app.route('/api/activity', methods=['POST'])
def add_activity():
    d = request.json or {}
    conn = db()
    conn.execute(
        'INSERT INTO activity (action, data, timestamp, date) VALUES (?,?,?,?)',
        (d.get('action'), jdump(d.get('data', {})), now_ms(),
         datetime.now().strftime('%Y-%m-%d'))
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ── start ─────────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    print('=' * 48)
    print('  NumberLand DB Server')
    print('  http://localhost:5055')
    print(f'  Database: {DB_PATH}')
    print('=' * 48)
    app.run(host='127.0.0.1', port=5055, debug=False)
