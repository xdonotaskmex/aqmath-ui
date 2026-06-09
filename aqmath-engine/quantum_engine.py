"""AQMath Quantum Engine - Portfolio optimization orchestrator.

EXACT port of the optimizePortfolio() function from AQMath.html lines 1285-1484.
This module orchestrates the full optimization pipeline:
1. Read historical data from DB (cleaned by data-pipeline)
2. Check data sufficiency
3. Run KKT Risk Parity optimization
4. Return optimized allocation weights

NO external API calls - reads ONLY from the database.
"""
import logging
import time
from typing import Optional

import asyncpg

from config import DATABASE_URL, MIN_HISTORY_DAYS, OPTIMIZATION_COOLDOWN
from risk_parity import risk_parity_optimize

logger = logging.getLogger(__name__)

# Shared DB pool (set by main.py lifespan)
_pool: Optional[asyncpg.Pool] = None

# Cooldown tracking (in-memory; for production use Redis)
_last_optimization_time: Optional[float] = None


def _r2(n: float, d: int = 2) -> float:
    """Round to d decimal places. EXACT port of: const r2 = (n, d = 2) => Math.round(n * 10**d) / 10**d;"""
    factor = 10 ** d
    return round(n * factor) / factor


def set_pool(db_pool: asyncpg.Pool):
    """Set the shared DB pool (called from main.py on startup)."""
    global _pool
    _pool = db_pool


async def get_latest_price(symbol: str) -> Optional[float]:
    """Get the latest (most recent) close price from the clean DB.

    NO API calls - reads only from crypto_prices table.
    """
    if not _pool:
        logger.error("DB pool not initialized")
        return None
    try:
        async with _pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT close_price FROM crypto_prices
                   WHERE symbol = $1
                   ORDER BY date DESC
                   LIMIT 1""",
                symbol.upper(),
            )
            if row:
                return float(row["close_price"])
            logger.warning("[DB] No price data found for %s", symbol)
    except Exception as e:
        logger.error("[DB] Price fetch failed for %s: %s", symbol, e)
    return None


async def get_historical_prices(symbol: str, days: int = 365) -> Optional[list[float]]:
    """Get historical close prices from the clean DB.

    NO API calls - reads only from crypto_prices table.
    Returns up to `days` most recent prices, ordered ascending by date.
    """
    if not _pool:
        logger.error("DB pool not initialized")
        return None
    try:
        async with _pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT close_price FROM crypto_prices
                   WHERE symbol = $1
                   ORDER BY date ASC""",
                symbol.upper(),
            )
            if rows:
                prices = [float(r["close_price"]) for r in rows]
                if len(prices) > days:
                    prices = prices[-days:]
                return prices
            logger.warning("[DB] No historical data found for %s", symbol)
    except Exception as e:
        logger.error("[DB] History fetch failed for %s: %s", symbol, e)
    return None


def check_cooldown() -> Optional[int]:
    """Check if optimization cooldown is active. Returns remaining seconds or None."""
    global _last_optimization_time
    if _last_optimization_time is None:
        return None
    elapsed = time.time() - _last_optimization_time
    if elapsed < OPTIMIZATION_COOLDOWN:
        return int(OPTIMIZATION_COOLDOWN - elapsed)
    return None


def reset_cooldown():
    """Record that optimization was just performed."""
    global _last_optimization_time
    _last_optimization_time = time.time()


async def optimize_portfolio(
    tickers: list[str],
    frozen_targets: Optional[dict[str, float]] = None,
) -> dict:
    """Run the full Quantum Engine optimization.

    EXACT port of optimizePortfolio() from AQMath.html lines 1285-1484.
    Reads ALL data from the database - no external API calls.

    Args:
        tickers: list of active (unfrozen) ticker symbols
        frozen_targets: dict of frozen symbol -> target% (to subtract from 100%)

    Returns:
        {
            "allocations": {symbol: target%},
            "warnings": [...],
            "young_tokens": [...],
            "skipped_tokens": [...],
        }
    """
    if frozen_targets is None:
        frozen_targets = {}

    frozen_target_sum = sum(frozen_targets.values())
    initial_remaining_alloc = _r2(100.0 - frozen_target_sum, 4)

    if initial_remaining_alloc <= 0:
        return {"allocations": {}, "warnings": ["Frozen tokens already occupy 100% allocation."]}

    # ---- Read historical data from DB for each ticker ----
    data_map = {}
    missing = []
    for sym in tickers:
        prices = await get_historical_prices(sym, days=365)
        if not prices or len(prices) == 0:
            missing.append(sym)
        else:
            data_map[sym] = prices

    if missing:
        return {
            "allocations": {},
            "warnings": [f"Missing historical data for: {', '.join(missing)}. Ensure collectors and pipeline have run."],
            "missing": missing,
        }

    # ---- Check data sufficiency ----
    # EXACT from lines 1324-1335
    young_tokens = []
    historical_data = []
    for sym in tickers:
        if sym not in data_map:
            continue
        prices = data_map[sym]
        if len(prices) < MIN_HISTORY_DAYS:
            young_tokens.append(sym)
        historical_data.append({"symbol": sym, "prices": prices})

    if len(historical_data) < 2:
        return {"allocations": {}, "warnings": ["Not enough valid data for optimization."]}

    # ---- Compute effective remaining allocation ----
    success_symbols = {item["symbol"] for item in historical_data}
    skipped_tokens = [s for s in tickers if s not in success_symbols]
    skipped_target_sum = sum(frozen_targets.get(s, 0) for s in skipped_tokens)
    effective_remaining_alloc = _r2(initial_remaining_alloc - skipped_target_sum, 4)

    if effective_remaining_alloc <= 0:
        return {
            "allocations": {},
            "warnings": ["All available allocation consumed by skipped tokens."],
        }

    # ---- Run KKT Risk Parity ----
    try:
        result = risk_parity_optimize(historical_data, effective_remaining_alloc)
    except (ValueError, ZeroDivisionError, OverflowError) as e:
        logger.error("[OPTIMIZE] Risk Parity failed: %s", e, exc_info=True)
        return {"allocations": {}, "warnings": [f"Optimization failed: {e}"], "error": str(e)}

    allocations = result.get("weights", {})
    warnings = result.get("warnings", [])

    if young_tokens:
        warnings.append(f"Tokens with <{MIN_HISTORY_DAYS} days: {', '.join(young_tokens)}")
    if skipped_tokens:
        warnings.append(f"Skipped tokens: {', '.join(skipped_tokens)}")

    return {
        "allocations": allocations,
        "warnings": warnings,
        "young_tokens": young_tokens,
        "skipped_tokens": skipped_tokens,
    }
