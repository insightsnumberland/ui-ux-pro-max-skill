"""
NumberLand Local DB Server
Run:  python server.py
Deps: pip install flask flask-cors nlbone

Data is saved to numberland.db (SQLite) next to this file.

nlbone features used:
  - nlbone.utils.normalize_mobile  — Iranian mobile number normalization
  - Snowflake ID generation        — distributed unique IDs for requests
  - Fernet encryption (optional)   — set FERNET_KEY env var to encrypt
                                     mobile/email at rest in SQLite
"""
import base64
import hashlib
import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

from flask import Flask, jsonify, request
from flask_cors import CORS

# ── nlbone: mobile normalization ───────────────────────────────────
try:
    from nlbone.utils.normalize_mobile import normalize_mobile as _normalize_mobile
    def normalize_mobile(mobile: str) -> str:
        return _normalize_mobile(mobile, strip_zero=False, add_country_code=False)
except ImportError:
    import re
    def normalize_mobile(mobile: str) -> str:
        if not mobile:
            return ""
        mobile = re.sub(r"\D", "", str(mobile))
        if mobile.startswith("0098"):
            mobile = mobile[4:]
        elif mobile.startswith("98") and len(mobile) > 10:
            mobile = mobile[2:]
        return mobile

# ── Snowflake ID generator ─────────────────────────────────────────
# Copied from nlbone.adapters.snowflake (no .env dependency needed here)
class _Snowflake:
    WORKER_ID_BITS     = 5
    DATACENTER_ID_BITS = 5
    SEQUENCE_BITS      = 12
    MAX_WORKER_ID      = (1 << WORKER_ID_BITS) - 1       # 31
    MAX_DATACENTER_ID  = (1 << DATACENTER_ID_BITS) - 1   # 31
    SEQUENCE_MASK      = (1 << SEQUENCE_BITS) - 1         # 4095
    WORKER_ID_SHIFT    = SEQUENCE_BITS
    DATACENTER_ID_SHIFT= SEQUENCE_BITS + WORKER_ID_BITS
    TIMESTAMP_SHIFT    = SEQUENCE_BITS + WORKER_ID_BITS + DATACENTER_ID_BITS
    EPOCH              = int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)

    def __init__(self, datacenter_id=1, worker_id=1):
        self.datacenter_id = max(0, min(datacenter_id, self.MAX_DATACENTER_ID))
        self.worker_id     = max(0, min(worker_id,     self.MAX_WORKER_ID))
        self.sequence      = 0
        self.last_ts       = -1
        self._lock         = threading.Lock()

    def _ts(self) -> int:
        return int(time.time() * 1000)

    def _wait(self, last: int) -> int:
        ts = self._ts()
        while ts <= last:
            ts = self._ts()
        return ts

    def next_id(self) -> str:
        with self._lock:
            ts = self._ts()
            if ts < self.last_ts:
                ts = self._wait(self.last_ts)
            if ts == self.last_ts:
                self.sequence = (self.sequence + 1) & self.SEQUENCE_MASK
                if self.sequence == 0:
                    ts = self._wait(self.last_ts)
            else:
                self.sequence = 0
            self.last_ts = ts
            sf = (
                ((ts - self.EPOCH) << self.TIMESTAMP_SHIFT)
                | (self.datacenter_id << self.DATACENTER_ID_SHIFT)
                | (self.worker_id     << self.WORKER_ID_SHIFT)
                | self.sequence
            )
            return str(sf)

_DC = int(os.environ.get("SNOWFLAKE_DATACENTER_ID", "1"))
_WK = int(os.environ.get("SNOWFLAKE_WORKER_ID", "1"))
SNOWFLAKE = _Snowflake(datacenter_id=_DC, worker_id=_WK)

# ── Fernet encryption (optional) ───────────────────────────────────
_fernet = None
_fernet_key = os.environ.get("FERNET_KEY", "").strip()
if _fernet_key:
    try:
        from cryptography.fernet import Fernet
        _key_bytes = base64.urlsafe_b64encode(hashlib.sha256(_fernet_key.encode()).digest())
        _fernet    = Fernet(_key_bytes)
        print("[nlbone] Fernet encryption enabled.")
    except ImportError:
        print("[nlbone] cryptography not installed — Fernet disabled.")

def _enc(text: str) -> str:
    if _fernet and text:
        return _fernet.encrypt(text.encode()).decode()
    return text or ""

def _dec(token: str) -> str:
    if _fernet and token:
        try:
            return _fernet.decrypt(token.encode()).decode()
        except Exception:
            return token
    return token or ""


# ── Flask app ──────────────────────────────────────────────────────
app     = Flask(__name__)
CORS(app)
DB_PATH = os.path.join(os.path.dirname(__file__), 'numberland.db')


# ── helpers ────────────────────────────────────────────────────────
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def now_ms() -> int:
    return int(datetime.now().timestamp() * 1000)

def jdump(v) -> str:
    return json.dumps(v, ensure_ascii=False)

def jload(s):
    try:    return json.loads(s)
    except: return s


# ── init schema ────────────────────────────────────────────────────
def init_db():
    conn = db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            mobile        TEXT UNIQUE,
            email         TEXT,
            company       TEXT,
            source        TEXT,
            registered_at TEXT,
            created_at    INTEGER
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
    result = []
    for r in rows:
        row = dict(r)
        row['mobile'] = _dec(row['mobile'])
        row['email']  = _dec(row['email'])
        result.append(row)
    return jsonify(result)


@app.route('/api/users', methods=['POST'])
def add_user():
    d      = request.json or {}
    raw_mobile = d.get('mobile', '')
    mobile = normalize_mobile(raw_mobile)   # nlbone: normalize Iranian number
    email  = d.get('email', '')
    conn   = db()
    try:
        conn.execute(
            'INSERT OR IGNORE INTO users '
            '(mobile, email, company, source, registered_at, created_at) '
            'VALUES (?,?,?,?,?,?)',
            (_enc(mobile), _enc(email),
             d.get('company'), d.get('source'),
             d.get('registered_at'), now_ms())
        )
        conn.commit()
        # look up by encrypted mobile
        row = conn.execute(
            'SELECT id FROM users WHERE mobile=?', (_enc(mobile),)
        ).fetchone()
        conn.close()
        return jsonify({'id': row['id'] if row else None, 'mobile': mobile})
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
    conn   = db()
    rows   = conn.execute('SELECT data FROM requests ORDER BY saved_at DESC').fetchall()
    conn.close()
    items = [jload(r['data']) for r in rows]
    if status: items = [r for r in items if r.get('status') == status]
    if search:
        items = [r for r in items if
                 search in (r.get('id')      or '').lower() or
                 search in (r.get('product') or '').lower() or
                 search in (r.get('email')   or '').lower()]
    return jsonify(items)


@app.route('/api/requests', methods=['POST'])
def add_request():
    d  = request.json or {}
    # ── Snowflake: server generates the canonical ID ──────────────
    req_id = SNOWFLAKE.next_id()
    d['id'] = req_id
    # ─────────────────────────────────────────────────────────────
    ts = now_ms()
    conn = db()
    conn.execute(
        '''INSERT OR REPLACE INTO requests
           (id, product, email, quantity, status, date, saved_at, data)
           VALUES (?,?,?,?,?,?,?,?)''',
        (req_id, d.get('product'), d.get('email'), d.get('quantity'),
         d.get('status', 'PENDING'), d.get('date'), ts, jdump(d))
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': req_id})


@app.route('/api/requests/<req_id>', methods=['PATCH'])
def update_request(req_id):
    updates = request.json or {}
    conn    = db()
    row     = conn.execute('SELECT data FROM requests WHERE id=?', (req_id,)).fetchone()
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
    ts   = now_ms()
    for cat, items in cats.items():
        for p in items:
            ckey = f"{cat}:{p.get('id')}"
            conn.execute(
                'INSERT OR REPLACE INTO products (ckey, category, cached_at, data) '
                'VALUES (?,?,?,?)',
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
    rows    = conn.execute(
        'SELECT * FROM products WHERE cached_at > ?', (cutoff,)
    ).fetchall()
    conn.close()
    if not rows:
        return jsonify(None)
    result = {}
    for r in rows:
        cat = r['category']
        if cat not in result:
            result[cat] = []
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
    rows  = conn.execute(
        'SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?', (limit,)
    ).fetchall()
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


# ── start ──────────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    enc_status = "on" if _fernet else "off (set FERNET_KEY to enable)"
    print('=' * 52)
    print('  NumberLand DB Server  (powered by nlbone)')
    print(f'  http://localhost:5055')
    print(f'  Database : {DB_PATH}')
    print(f'  Snowflake: DC={_DC} Worker={_WK}')
    print(f'  Encrypt  : {enc_status}')
    print('=' * 52)
    app.run(host='127.0.0.1', port=5055, debug=False)
