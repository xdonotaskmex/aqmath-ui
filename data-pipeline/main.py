"""Data Pipeline - FastAPI application.

Cleans raw crypto data from CoinGecko, Kraken, and Coinbase collectors,
validates, merges, and stores clean data in the crypto_prices table.
"""
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cleaner import DataCleaner
from config import PORT

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

cleaner = DataCleaner()
scheduler = AsyncIOScheduler()


async def scheduled_clean():
    """Scheduled cleaning job: clean all symbols."""
    try:
        logger.info("Scheduled cleaning started...")
        results = await cleaner.clean_all()
        cleaned = sum(1 for r in results if r["status"] == "cleaned")
        failed = sum(1 for r in results if r["status"] != "cleaned")
        logger.info("Scheduled cleaning done: %d cleaned, %d failed/skipped", cleaned, failed)
    except Exception as e:
        logger.error("Scheduled cleaning crashed: %s", e, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    await cleaner.init_db()

    # Schedule cleaning at 01:00 UTC (after all collectors finish)
    scheduler.add_job(scheduled_clean, "cron", hour=1, minute=0, timezone="UTC")
    scheduler.start()
    logger.info("Scheduler started. Daily cleaning at 01:00 UTC.")

    yield

    scheduler.shutdown()
    await cleaner.close()


app = FastAPI(
    title="Data Pipeline",
    description="Cleans and merges raw crypto data from multiple sources into clean prices.",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow CORS for collector services
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CleanRequest(BaseModel):
    symbols: list[str] | None = None  # None = clean all


@app.get("/")
async def root():
    return {"service": "data-pipeline", "status": "running"}


@app.post("/api/raw")
async def ingest_raw(records: list[dict]):
    """Ingest raw data from collectors.

    Flat array format: each record has its own source field.
    [{"symbol": "BTC", "timestamp": "...", "price": 67210.34, "volume": 123.45, "source": "coingecko"}, ...]
    """
    result = await cleaner.ingest_raw(records)
    return result


@app.get("/api/symbols")
async def api_symbols():
    """Get all tracked symbols with metadata. Used by collectors for daily cron."""
    try:
        async with cleaner.pool.acquire() as conn:
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
    except Exception as e:
        logger.error("[API] /api/symbols DB error: %s", e)
        return {"symbols": [], "error": str(e)}


@app.get("/stats")
async def stats():
    """Get pipeline statistics."""
    return await cleaner.get_stats()


@app.post("/clean")
async def clean(req: CleanRequest):
    """Clean data for specific symbols or all symbols."""
    if req.symbols:
        results = []
        for sym in req.symbols:
            result = await cleaner.clean_symbol(sym)
            results.append(result)
        return {"results": results}
    else:
        results = await cleaner.clean_all()
        return {"results": results}


@app.get("/api/prices")
async def get_prices(symbol: str = Query(...), days: int = Query(180)):
    """Get historical clean prices for a symbol.

    Returns just a list of close prices (numbers). Used by dca-engine and other services.
    """
    prices = await cleaner.get_prices(symbol, days)
    if not prices:
        logger.warning("[API] /api/prices: No clean data for %s (days=%d)", symbol, days)
    return {"symbol": symbol.upper(), "prices": prices}


@app.get("/symbols")
async def list_symbols():
    """List all symbols with clean data (legacy endpoint, use /api/symbols)."""
    return await api_symbols()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
