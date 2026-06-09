"""AQMath Quantum Engine - FastAPI application.

Serves the Risk Parity + KKT optimization logic via REST API.
The UI (AQMath.html) calls these endpoints with ticker symbols.

NO external API calls - all data comes from the database (populated by collectors + pipeline).
"""
import logging
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import DATABASE_URL, PORT
from quantum_engine import (
    check_cooldown,
    get_historical_prices,
    get_latest_price,
    optimize_portfolio,
    reset_cooldown,
    set_pool,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

pool: Optional[asyncpg.Pool] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    set_pool(pool)  # Share pool with quantum_engine module
    logger.info("Database pool initialized.")
    yield
    if pool:
        await pool.close()


app = FastAPI(
    title="AQMath Quantum Engine",
    description="Risk Parity + KKT portfolio optimization API. DB-only, no API calls.",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow CORS from any origin (for local HTML UI)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Request/Response Models ----

class OptimizeRequest(BaseModel):
    tickers: list[str]
    frozen_targets: Optional[dict[str, float]] = None  # symbol -> target%


# ---- Endpoints ----

@app.get("/")
async def root():
    return {"service": "aqmath-quantum-engine", "status": "running", "data_source": "database-only"}


@app.post("/optimize")
async def optimize(req: OptimizeRequest):
    """Run Quantum Engine optimization on given tickers.

    Takes ticker symbols, reads historical data from DB, runs KKT Risk Parity.
    Returns optimized allocation weights per symbol.
    """
    try:
        cooldown = check_cooldown()
        if cooldown is not None:
            hours = (cooldown + 3599) // 3600
            return {
                "error": f"Quantum engine on cooldown. Available in ~{hours}h.",
                "cooldown_remaining": cooldown,
            }

        if len(req.tickers) < 2:
            return {"error": "Need at least 2 unfrozen tokens for optimization."}

        result = await optimize_portfolio(req.tickers, req.frozen_targets)

        if "error" not in result and result.get("allocations"):
            reset_cooldown()

        return result
    except Exception as e:
        logger.error("[API] /optimize unhandled exception: %s", e, exc_info=True)
        return {"error": f"Internal optimization error: {str(e)}"}


@app.get("/prices/batch")
async def get_batch_prices(symbols: str = Query(..., description="Comma-separated symbols, e.g. BTC,ETH,SOL")):
    """Get latest prices for multiple symbols from the DB.

    Returns dict of symbol -> price. Used by UI for portfolio sync.
    """
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        return {"prices": {}, "errors": ["No symbols provided"]}

    results = {}
    errors = []
    for sym in sym_list:
        price = await get_latest_price(sym)
        if price is not None:
            results[sym] = price
        else:
            errors.append(f"{sym}: not found in DB")

    return {"prices": results, "errors": errors}


@app.get("/prices/{symbol}")
async def get_price(symbol: str):
    """Get latest price for a symbol from the DB."""
    price = await get_latest_price(symbol)
    if price is None:
        logger.warning("[API] /prices/%s: No price found in DB", symbol)
    return {
        "symbol": symbol.upper(),
        "price": price,
        "source": "database" if price else "unavailable",
    }


@app.get("/history/{symbol}")
async def get_history(symbol: str, days: int = 365):
    """Get historical prices for a symbol from the DB."""
    prices = await get_historical_prices(symbol, days=days)
    return {
        "symbol": symbol.upper(),
        "days": days,
        "points": len(prices) if prices else 0,
        "prices": prices,
    }


@app.get("/symbols")
async def list_symbols():
    """List all symbols available in the clean DB."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT symbol, COUNT(*) as days, MIN(date) as first_date, MAX(date) as last_date
            FROM crypto_prices
            GROUP BY symbol
            ORDER BY symbol
        """)
        return {
            "symbols": [
                {
                    "symbol": r["symbol"],
                    "days": r["days"],
                    "first_date": str(r["first_date"]),
                    "last_date": str(r["last_date"]),
                }
                for r in rows
            ]
        }


@app.get("/cooldown")
async def cooldown_status():
    """Check optimization cooldown status."""
    remaining = check_cooldown()
    return {
        "on_cooldown": remaining is not None,
        "remaining_seconds": remaining,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
