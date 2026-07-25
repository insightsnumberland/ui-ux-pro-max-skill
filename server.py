"""
NumberLand B2B Panel — API Server
Built on nlbone infrastructure: FastAPI + PostgreSQL + SQLAlchemy async

Run:
    uvicorn server:app --host 127.0.0.1 --port 5055 --reload

Config (create .env next to this file):
    POSTGRES_DB_DSN=postgresql+asyncpg://user:pass@localhost:5432/numberland
    REDIS_URL=redis://localhost:6379/0          # optional, for product cache
    FERNET_KEY=your-secret-key                 # optional, encrypts mobile/email at rest
    SNOWFLAKE_WORKER_ID=1
    SNOWFLAKE_DATACENTER_ID=1
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import BigInteger, Column, Integer, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession

# ── nlbone: no duplicate implementations ────────────────────────────
from nlbone.adapters.db.postgres.base import Base
from nlbone.adapters.db.postgres.engine import async_session, init_async_engine
from nlbone.adapters.db.postgres.schema import init_db_async
from nlbone.adapters.snowflake import SNOWFLAKE
from nlbone.config.settings import get_settings
from nlbone.interfaces.api.exception_handlers import install_exception_handlers
from nlbone.utils.normalize_mobile import normalize_mobile

settings = get_settings()

# ── Optional Fernet encryption via nlbone.utils.crypto ──────────────
try:
    from nlbone.utils.crypto import decrypt_text as _dec_raw, encrypt_text as _enc_raw
    _enc = _enc_raw
    _dec = _dec_raw
except Exception:
    _enc = lambda x: x or ""   # noqa: E731
    _dec = lambda x: x or ""   # noqa: E731


# ══════════════════════════════════════════════════════════════════
# SQLAlchemy models  (extend nlbone's Base — same metadata/engine)
# ══════════════════════════════════════════════════════════════════
class User(Base):
    __tablename__ = "nb_panel_users"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    mobile        = Column(String(64),  unique=True, index=True)
    email         = Column(String(256))
    company       = Column(String(256))
    source        = Column(String(64))
    registered_at = Column(String(32))
    created_at    = Column(BigInteger)


class Request(Base):
    __tablename__ = "nb_panel_requests"
    id         = Column(String(32), primary_key=True)
    product    = Column(Text)
    email      = Column(String(256))
    quantity   = Column(Integer)
    status     = Column(String(32), default="PENDING", index=True)
    date       = Column(String(32))
    saved_at   = Column(BigInteger, index=True)
    updated_at = Column(BigInteger)
    data       = Column(Text)  # full JSON blob


class Setting(Base):
    __tablename__ = "nb_panel_settings"
    key        = Column(String(128), primary_key=True)
    value      = Column(Text)
    updated_at = Column(BigInteger)


class Activity(Base):
    __tablename__ = "nb_panel_activity"
    id        = Column(Integer, primary_key=True, autoincrement=True)
    action    = Column(String(128))
    data      = Column(Text)
    timestamp = Column(BigInteger, index=True)
    date      = Column(String(16))


class ProductCache(Base):
    __tablename__ = "nb_panel_products_cache"
    ckey      = Column(String(128), primary_key=True)
    category  = Column(String(64))
    cached_at = Column(BigInteger)
    data      = Column(Text)


# ══════════════════════════════════════════════════════════════════
# App  (lifespan creates schema via nlbone's init_db_async)
# ══════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_async_engine()
    await init_db_async()  # creates tables from nlbone's Base.metadata
    yield


app = FastAPI(title="NumberLand B2B Panel", lifespan=lifespan)
install_exception_handlers(app)  # nlbone's standard error responses
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── helpers ──────────────────────────────────────────────────────────
def now_ms() -> int:
    return int(datetime.now().timestamp() * 1000)

def jdump(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)

def jload(s: str | None) -> Any:
    try:    return json.loads(s) if s else None
    except: return s


# ══════════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════════
@app.get("/api/users")
async def list_users():
    async with async_session() as s:
        rows = (await s.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return [
        {**{c: getattr(r, c) for c in User.__table__.columns.keys()},
         "mobile": _dec(r.mobile), "email": _dec(r.email)}
        for r in rows
    ]


@app.post("/api/users")
async def add_user(body: dict):
    # nlbone: normalize_mobile cleans Iranian numbers (strips +, 0098, spaces)
    mobile = normalize_mobile(body.get("mobile", ""), strip_zero=False, add_country_code=False)
    email  = body.get("email", "")
    async with async_session() as s:
        existing = (await s.execute(select(User).where(User.mobile == _enc(mobile)))).scalar_one_or_none()
        if not existing:
            s.add(User(
                mobile=_enc(mobile), email=_enc(email),
                company=body.get("company"), source=body.get("source"),
                registered_at=body.get("registered_at"), created_at=now_ms(),
            ))
            await s.commit()
            result = (await s.execute(select(User).where(User.mobile == _enc(mobile)))).scalar_one_or_none()
            return {"id": result.id if result else None, "mobile": mobile}
        return {"id": existing.id, "mobile": mobile}


# ══════════════════════════════════════════════════════════════════
# REQUESTS
# ══════════════════════════════════════════════════════════════════
@app.get("/api/requests")
async def list_requests(
    status: str | None = Query(None),
    search: str | None = Query(None),
):
    async with async_session() as s:
        rows = (await s.execute(select(Request).order_by(Request.saved_at.desc()))).scalars().all()
    items = [jload(r.data) for r in rows]
    if status: items = [r for r in items if r and r.get("status") == status]
    if search:
        q = search.lower()
        items = [r for r in items if r and (
            q in (r.get("id") or "").lower() or
            q in (r.get("product") or "").lower() or
            q in (r.get("email") or "").lower()
        )]
    return items


@app.post("/api/requests")
async def add_request(body: dict):
    # nlbone SNOWFLAKE: distributed unique ID (no client-side REQ-timestamp)
    req_id = str(SNOWFLAKE.next_id())
    body["id"] = req_id
    ts = now_ms()
    async with async_session() as s:
        s.add(Request(
            id=req_id,
            product=body.get("product"),
            email=body.get("email"),
            quantity=body.get("quantity"),
            status=body.get("status", "PENDING"),
            date=body.get("date"),
            saved_at=ts,
            data=jdump(body),
        ))
        await s.commit()
    return {"ok": True, "id": req_id}


@app.patch("/api/requests/{req_id}")
async def update_request(req_id: str, body: dict):
    async with async_session() as s:
        req = (await s.execute(select(Request).where(Request.id == req_id))).scalar_one_or_none()
        if not req:
            raise HTTPException(404, "not found")
        rec = jload(req.data) or {}
        rec.update(body)
        rec["updated_at"] = now_ms()
        req.status     = rec.get("status")
        req.updated_at = rec["updated_at"]
        req.data       = jdump(rec)
        await s.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════
# PRODUCTS CACHE
# ══════════════════════════════════════════════════════════════════
@app.post("/api/products/cache")
async def cache_products(body: dict):
    ts = now_ms()
    async with async_session() as s:
        for cat, items in body.items():
            for p in items:
                ckey = f"{cat}:{p.get('id')}"
                row = (await s.execute(select(ProductCache).where(ProductCache.ckey == ckey))).scalar_one_or_none()
                if row:
                    row.cached_at = ts
                    row.data      = jdump(p)
                else:
                    s.add(ProductCache(ckey=ckey, category=cat, cached_at=ts, data=jdump(p)))
        await s.commit()
    return {"ok": True}


@app.get("/api/products/cache")
async def get_product_cache(maxAge: int = Query(30 * 60 * 1000)):
    cutoff = now_ms() - maxAge
    async with async_session() as s:
        rows = (await s.execute(
            select(ProductCache).where(ProductCache.cached_at > cutoff)
        )).scalars().all()
    if not rows:
        return None
    out: dict[str, list] = {}
    for r in rows:
        out.setdefault(r.category, []).append(jload(r.data))
    return out


# ══════════════════════════════════════════════════════════════════
# SETTINGS
# ══════════════════════════════════════════════════════════════════
@app.get("/api/settings/{key}")
async def get_setting(key: str):
    async with async_session() as s:
        row = (await s.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    return jload(row.value) if row else None


@app.post("/api/settings")
async def set_setting(body: dict):
    async with async_session() as s:
        row = (await s.execute(select(Setting).where(Setting.key == body.get("key")))).scalar_one_or_none()
        if row:
            row.value      = jdump(body.get("value"))
            row.updated_at = now_ms()
        else:
            s.add(Setting(key=body.get("key"), value=jdump(body.get("value")), updated_at=now_ms()))
        await s.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════
# ACTIVITY LOG
# ══════════════════════════════════════════════════════════════════
@app.get("/api/activity")
async def list_activity(limit: int = Query(100)):
    async with async_session() as s:
        rows = (await s.execute(
            select(Activity).order_by(Activity.timestamp.desc()).limit(limit)
        )).scalars().all()
    return [
        {**{c: getattr(r, c) for c in Activity.__table__.columns.keys()},
         "data": jload(r.data)}
        for r in rows
    ]


@app.post("/api/activity")
async def add_activity(body: dict):
    async with async_session() as s:
        s.add(Activity(
            action=body.get("action"),
            data=jdump(body.get("data", {})),
            timestamp=now_ms(),
            date=datetime.now().strftime("%Y-%m-%d"),
        ))
        await s.commit()
    return {"ok": True}


# ── entry point ───────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("=" * 56)
    print("  NumberLand B2B Panel  (nlbone stack)")
    print("  http://127.0.0.1:5055")
    print(f"  DB : {settings.POSTGRES_DB_DSN[:55]}")
    print(f"  ENV: {settings.ENV}")
    print("=" * 56)
    uvicorn.run("server:app", host="127.0.0.1", port=5055, reload=False)
