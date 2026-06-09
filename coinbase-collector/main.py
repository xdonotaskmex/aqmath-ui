"""Coinbase Collector - FastAPI application.

Collects historical crypto prices from Coinbase Exchange API.
Forwards raw JSON to data-pipeline service (NO direct DB access).

On startup: runs YTD bulk collection (365 days).
Daily cron: collects previous day only.
"""
import asyncio
import logging
import random
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from pydantic import BaseModel

from collector import CoinbaseCollector
from config import DATA_PIPELINE_URL, PORT

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

collector = CoinbaseCollector()
scheduler = AsyncIOScheduler()


async def daily_collection():
    """Daily cron job: collect yesterday's data for all known symbols."""
    jitter = random.uniform(10, 90)
    logger.info(f"Daily collection scheduled. Jittering {jitter:.0f}s before start...")
    await asyncio.sleep(jitter)

    logger.info("Daily collection started...")
    # Ask data-pipeline which symbols are tracked
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{DATA_PIPELINE_URL}/api/symbols")
            resp.raise_for_status()
            data = resp.json()
            symbols = [s["symbol"] for s in data.get("symbols", [])]
    except Exception as e:
        logger.error(f"Failed to fetch symbols from pipeline: {e}")
        symbols = []

    if symbols:
        results = await collector.collect_bulk(symbols, force=False)
        logger.info(f"Daily collection done: {len(results)} symbols processed")
    else:
        logger.info("No symbols found in pipeline for daily collection.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    # Schedule daily collection at 00:15 UTC (offset from other collectors)
    scheduler.add_job(daily_collection, "cron", hour=0, minute=15, timezone="UTC")
    scheduler.start()
    logger.info("Scheduler started. Daily collection at 00:15 UTC.")

    yield

    scheduler.shutdown()
    await collector.close()


app = FastAPI(
    title="Coinbase Collector",
    description="Collects 365-day historical crypto prices from Coinbase Exchange API. Forwards raw JSON to data-pipeline.",
    version="1.0.0",
    lifespan=lifespan,
)


class CollectRequest(BaseModel):
    symbols: list[str]
    force_bulk: bool = False


@app.get("/")
async def root():
    return {"service": "coinbase-collector", "status": "running", "db_access": False}


@app.get("/status")
async def status():
    return await collector.get_status()


@app.post("/collect")
async def collect(req: CollectRequest):
    """Collect historical data for given symbols."""
    results = await collector.collect_bulk(req.symbols, force=req.force_bulk)
    return {"results": results}


@app.post("/collect/bulk")
async def collect_bulk(req: CollectRequest):
    """Force bulk YTD collection (365 days) for given symbols."""
    results = await collector.collect_bulk(req.symbols, force=True)
    return {"results": results}


@app.get("/pairs")
async def list_pairs():
    """Return supported symbol-to-pair mappings."""
    from config import SYMBOL_TO_COINBASE_PAIR
    return {
        "total": len(SYMBOL_TO_COINBASE_PAIR),
        "mappings": SYMBOL_TO_COINBASE_PAIR,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
