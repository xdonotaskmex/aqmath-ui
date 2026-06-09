"""Core CoinGecko data collector logic.

Fetches historical crypto prices from CoinGecko API (FREE tier).
Pattern: YTD bulk (365 days) on first run, then daily delta (+1 day).

NO database access — fetches from API, forwards raw JSON to data-pipeline.

Human-like behavior to avoid detection:
- Random jittered delays between requests (not fixed)
- Browser-like User-Agent headers
- Aggressive exponential backoff on 429 (up to 5 min)
- Daily API budget tracking (pause when near limit)
- Randomized symbol collection order
- Longer pauses every N symbols during bulk
"""
import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Optional

import httpx

from config import (
    AGGRESSIVE_BASE,
    AGGRESSIVE_MAX,
    AGGRESSIVE_MULTIPLIER,
    BULK_DAYS,
    BULK_PAUSE_EVERY,
    BULK_PAUSE_MAX,
    BULK_PAUSE_MIN,
    BUDGET_CHECK_INTERVAL,
    COINGECKO_BASE_URL,
    COOLDOWN_RESET_MIN,
    CUSTOM_COIN_MAP,
    DAILY_BUDGET,
    DAILY_DAYS,
    DATA_PIPELINE_URL,
    DELAY_MAX,
    DELAY_MIN,
    MAX_RETRIES,
)

logger = logging.getLogger(__name__)

# Browser-like headers to look human
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


class CoinGeckoCollector:
    """Collects historical crypto prices from CoinGecko (free tier).

    No DB access — all data is forwarded to data-pipeline via HTTP.
    """

    def __init__(self):
        self.coin_id_map: dict[str, str] = {}
        self.coin_name_map: dict[str, str] = {}
        self._client: Optional[httpx.AsyncClient] = None
        # Rate limit state
        self._consecutive_429 = 0
        self._last_429_time: Optional[datetime] = None
        self._daily_calls = 0
        self._daily_reset_date: Optional[datetime] = None

    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0, headers=BROWSER_HEADERS)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ---- Human-like rate limiting ----

    def _reset_daily_if_needed(self):
        """Reset daily counter at midnight UTC."""
        today = datetime.now(timezone.utc).date()
        if self._daily_reset_date != today:
            if self._daily_reset_date:
                logger.info(f"Daily budget reset. Used {self._daily_calls} calls yesterday.")
            self._daily_calls = 0
            self._daily_reset_date = today

    def _is_budget_exhausted(self) -> bool:
        """Check if daily API budget is exhausted."""
        self._reset_daily_if_needed()
        return self._daily_calls >= DAILY_BUDGET

    def _is_aggressive_mode(self) -> bool:
        """Check if we're in aggressive backoff mode."""
        if self._consecutive_429 == 0 or not self._last_429_time:
            return False
        elapsed = (datetime.now(timezone.utc) - self._last_429_time).total_seconds()
        # Reset after COOLDOWN_RESET_MIN minutes without 429
        if elapsed > COOLDOWN_RESET_MIN * 60:
            self._consecutive_429 = 0
            self._last_429_time = None
            logger.info("Aggressive mode reset after cooldown period.")
            return False
        return True

    async def _human_delay(self):
        """Wait a random human-like delay between requests."""
        if self._is_aggressive_mode():
            # Aggressive: much longer delays
            wait = min(AGGRESSIVE_MAX, AGGRESSIVE_BASE * (AGGRESSIVE_MULTIPLIER ** self._consecutive_429))
            jitter = random.uniform(0, wait * 0.3)
            total = wait + jitter
            logger.info(f"Aggressive mode: waiting {total:.1f}s (429 streak: {self._consecutive_429})")
        else:
            # Normal: random jitter between DELAY_MIN and DELAY_MAX
            total = random.uniform(DELAY_MIN, DELAY_MAX)
        await asyncio.sleep(total)

    # ---- Core API methods ----

    async def load_coin_id_map(self):
        """Load CoinGecko coin list and build symbol -> id map."""
        client = await self.get_client()
        try:
            resp = await client.get(f"{COINGECKO_BASE_URL}/coins/list")
            self._daily_calls += 1
            resp.raise_for_status()
            coin_list = resp.json()
            if isinstance(coin_list, list):
                for c in coin_list:
                    sym = c.get("symbol", "").upper()
                    cid = c.get("id", "")
                    name = c.get("name", "").lower()
                    if sym and cid:
                        self.coin_id_map[sym] = cid
                    if name and cid:
                        self.coin_name_map[name] = cid
                logger.info(f"Loaded {len(coin_list)} coins from CoinGecko.")
        except Exception as e:
            logger.warning(f"Failed to load coin list: {e}")

    def resolve_coin_id(self, symbol: str) -> str:
        """Resolve a ticker symbol to a CoinGecko coin ID."""
        sym_key = symbol.upper()
        name_key = symbol.lower()
        if sym_key in CUSTOM_COIN_MAP:
            return CUSTOM_COIN_MAP[sym_key]
        if sym_key in self.coin_id_map:
            return self.coin_id_map[sym_key]
        if name_key in self.coin_name_map:
            return self.coin_name_map[name_key]
        return symbol.lower().replace(" ", "-")

    async def fetch_with_retry(self, url: str, params: dict) -> Optional[dict]:
        """Fetch URL with retries and aggressive exponential backoff.

        Tracks daily budget and consecutive 429s for adaptive pacing.
        """
        self._reset_daily_if_needed()

        if self._is_budget_exhausted():
            logger.warning(f"Daily budget exhausted ({self._daily_calls}/{DAILY_BUDGET}). Skipping request.")
            return None

        client = await self.get_client()
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.get(url, params=params)
                self._daily_calls += 1

                # Log usage periodically
                if self._daily_calls % BUDGET_CHECK_INTERVAL == 0:
                    logger.info(f"API usage: {self._daily_calls}/{DAILY_BUDGET} today")

                if resp.status_code == 200:
                    # Reset 429 streak on success
                    if self._consecutive_429 > 0:
                        logger.info(f"429 streak reset after {self._consecutive_429} consecutive rate limits.")
                        self._consecutive_429 = 0
                        self._last_429_time = None
                    return resp.json()

                if resp.status_code == 429:
                    self._consecutive_429 += 1
                    self._last_429_time = datetime.now(timezone.utc)
                    wait = min(
                        AGGRESSIVE_MAX,
                        AGGRESSIVE_BASE * (AGGRESSIVE_MULTIPLIER ** (attempt + self._consecutive_429)),
                    )
                    jitter = random.uniform(0, wait * 0.3)
                    total_wait = wait + jitter
                    logger.warning(
                        f"Rate limited (429)! Streak: {self._consecutive_429}, "
                        f"attempt {attempt+1}/{MAX_RETRIES}, waiting {total_wait:.1f}s..."
                    )
                    await asyncio.sleep(total_wait)
                    continue

                logger.warning(f"HTTP {resp.status_code} for {url}")
                if attempt < MAX_RETRIES - 1:
                    wait = random.uniform(2, 5) * (attempt + 1)  # jittered retry delay
                    await asyncio.sleep(wait)

            except Exception as e:
                logger.error(f"Fetch error (attempt {attempt+1}): {e}")
                if attempt < MAX_RETRIES - 1:
                    wait = random.uniform(2, 5) * (attempt + 1)
                    await asyncio.sleep(wait)

        logger.error(f"All {MAX_RETRIES} retries exhausted for {url}")
        return None

    async def fetch_market_chart(self, symbol: str, days: int) -> list[dict]:
        """Fetch market chart data from CoinGecko.

        Returns list of records: {"timestamp": ISO-str, "price": float, "volume": float|null, "market_cap": float|null}
        """
        coin_id = self.resolve_coin_id(symbol)
        url = f"{COINGECKO_BASE_URL}/coins/{coin_id}/market_chart"
        params = {"vs_currency": "usd", "days": days}
        data = await self.fetch_with_retry(url, params)

        if not data:
            logger.warning("[PARSE] %s: No data returned from CoinGecko API (coin_id=%s, days=%d)", symbol, coin_id, days)
            return []

        prices = data.get("prices", [])
        if not prices:
            logger.warning("[PARSE] %s: Response missing 'prices' field or empty (coin_id=%s)", symbol, coin_id)
            return []

        volumes = data.get("total_volumes", [])
        market_caps = data.get("market_caps", [])

        vol_map = {int(v[0]): v[1] for v in volumes}
        mcap_map = {int(m[0]): m[1] for m in market_caps}

        records = []
        skipped = 0
        for p in prices:
            try:
                if len(p) < 2:
                    skipped += 1
                    continue
                ts_ms = int(p[0])
                price_val = p[1]
                if price_val is None or price_val <= 0:
                    skipped += 1
                    continue
                ts_iso = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).isoformat()
                records.append({
                    "timestamp": ts_iso,
                    "price": price_val,
                    "volume": vol_map.get(ts_ms),
                    "market_cap": mcap_map.get(ts_ms),
                })
            except (ValueError, TypeError, IndexError) as e:
                skipped += 1
                logger.debug("[PARSE] %s: Skipped malformed price entry: %s", symbol, e)

        if skipped > 0:
            logger.warning("[PARSE] %s: Skipped %d/%d malformed price entries", symbol, skipped, len(prices))
        logger.info("[PARSE] %s: Parsed %d valid records from CoinGecko", symbol, len(records))
        return records

    async def forward_to_pipeline(self, symbol: str, coin_id: str, records: list[dict]) -> dict:
        """Forward raw records to data-pipeline /api/raw endpoint."""
        if not records:
            return {"symbol": symbol, "ingested": 0, "total": 0}

        # Convert to flat array format with source field in each record
        flat_records = []
        for rec in records:
            flat_records.append({
                "symbol": symbol.upper(),
                "coin_id": coin_id,
                "timestamp": rec["timestamp"],
                "price": rec["price"],
                "volume": rec.get("volume"),
                "market_cap": rec.get("market_cap"),
                "source": "coingecko",
            })

        client = await self.get_client()
        try:
            resp = await client.post(f"{DATA_PIPELINE_URL}/api/raw", json=flat_records, timeout=30.0)
            if resp.status_code != 200:
                logger.error(
                    "[PIPELINE] %s: POST /api/raw returned HTTP %d (%d records attempted, body: %s)",
                    symbol, resp.status_code, len(flat_records), resp.text[:500],
                )
            resp.raise_for_status()
            result = resp.json()
            ingested = result.get("coingecko", {}).get("ingested", 0)
            total = result.get("coingecko", {}).get("total", 0)
            logger.info("[PIPELINE] %s: POST /api/raw -> %d/%d records ingested", symbol, ingested, total)
            return {"symbol": symbol, "ingested": ingested, "total": total}
        except httpx.HTTPStatusError as e:
            logger.error(
                "[PIPELINE] %s: POST /api/raw HTTP %d (%d records attempted)",
                symbol, e.response.status_code, len(flat_records),
            )
            return {"symbol": symbol, "ingested": 0, "total": len(flat_records), "error": str(e)}
        except httpx.TimeoutException as e:
            logger.error("[PIPELINE] %s: POST /api/raw timed out (%d records attempted)", symbol, len(flat_records))
            return {"symbol": symbol, "ingested": 0, "total": len(flat_records), "error": str(e)}
        except Exception as e:
            logger.error("[PIPELINE] %s: POST /api/raw failed: %s (%d records attempted)", symbol, e, len(flat_records))
            return {"symbol": symbol, "ingested": 0, "total": len(flat_records), "error": str(e)}

    async def collect_symbol(self, symbol: str, force_bulk: bool = False) -> dict:
        """Collect data for a single symbol and forward to pipeline."""
        coin_id = self.resolve_coin_id(symbol)

        # Always do bulk on first run; daily cron passes force_bulk=False and uses DAILY_DAYS
        days = BULK_DAYS if force_bulk else DAILY_DAYS
        logger.info(f"Collecting {symbol} ({coin_id}): {days} days")

        records = await self.fetch_market_chart(symbol, days)
        result = await self.forward_to_pipeline(symbol, coin_id, records)

        return {
            "symbol": symbol.upper(),
            "coin_id": coin_id,
            "days": days,
            "ingested": result.get("ingested", 0),
            "total_fetched": len(records),
        }

    async def collect_bulk(self, symbols: list[str], force: bool = False) -> list[dict]:
        """Collect data for multiple symbols with human-like pacing.

        Features:
        - Randomizes symbol order (not alphabetical)
        - Random jitter between requests
        - Extra long pause every N symbols during bulk
        - Respects daily API budget
        """
        # Shuffle order to look human
        shuffled = symbols[:]
        random.shuffle(shuffled)

        results = []
        for i, sym in enumerate(shuffled):
            # Check budget before each request
            if self._is_budget_exhausted():
                logger.warning(
                    f"Budget exhausted at symbol {i+1}/{len(shuffled)}. "
                    f"Used {self._daily_calls}/{DAILY_BUDGET} calls. Pausing."
                )
                break

            result = await self.collect_symbol(sym, force_bulk=force)
            results.append(result)

            if i < len(shuffled) - 1:
                # Extra long pause every BULK_PAUSE_EVERY symbols
                if (i + 1) % BULK_PAUSE_EVERY == 0:
                    pause = random.uniform(BULK_PAUSE_MIN, BULK_PAUSE_MAX)
                    logger.info(f"Bulk pacing: symbol {i+1}, resting {pause:.0f}s...")
                    await asyncio.sleep(pause)
                else:
                    await self._human_delay()

        return results

    async def get_status(self) -> dict:
        """Get collector status (no DB, just rate-limit state)."""
        self._reset_daily_if_needed()
        return {
            "source": "coingecko",
            "daily_calls": self._daily_calls,
            "daily_budget": DAILY_BUDGET,
            "aggressive_mode": self._is_aggressive_mode(),
            "consecutive_429": self._consecutive_429,
            "coin_id_map_size": len(self.coin_id_map),
        }
