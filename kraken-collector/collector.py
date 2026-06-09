"""Core Kraken data collector logic.

Fetches historical crypto prices from Kraken API.
Pattern: YTD bulk (365 days) on first run, then daily delta (+1 day).

NO database access — fetches from API, forwards raw JSON to data-pipeline.

Human-like behavior to avoid detection:
- Random jittered delays between requests (not fixed)
- Browser-like User-Agent headers
- Aggressive exponential backoff on 429 (up to 3 min)
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
    COOLDOWN_RESET_MIN,
    DAILY_BUDGET,
    DAILY_DAYS,
    DATA_PIPELINE_URL,
    DELAY_MAX,
    DELAY_MIN,
    KRAKEN_BASE_URL,
    KRAKEN_INTERVAL_DAILY,
    MAX_RETRIES,
    SYMBOL_TO_KRAKEN_PAIR,
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


class KrakenCollector:
    """Collects historical crypto prices from Kraken OHLC endpoint.

    No DB access — all data is forwarded to data-pipeline via HTTP.
    """

    def __init__(self):
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
        if elapsed > COOLDOWN_RESET_MIN * 60:
            self._consecutive_429 = 0
            self._last_429_time = None
            logger.info("Aggressive mode reset after cooldown period.")
            return False
        return True

    async def _human_delay(self):
        """Wait a random human-like delay between requests."""
        if self._is_aggressive_mode():
            wait = min(AGGRESSIVE_MAX, AGGRESSIVE_BASE * (AGGRESSIVE_MULTIPLIER ** self._consecutive_429))
            jitter = random.uniform(0, wait * 0.3)
            total = wait + jitter
            logger.info(f"Aggressive mode: waiting {total:.1f}s (429 streak: {self._consecutive_429})")
        else:
            total = random.uniform(DELAY_MIN, DELAY_MAX)
        await asyncio.sleep(total)

    # ---- Core API methods ----

    def resolve_pair(self, symbol: str) -> str:
        """Resolve ticker symbol to Kraken trading pair."""
        sym = symbol.upper()
        if sym in SYMBOL_TO_KRAKEN_PAIR:
            return SYMBOL_TO_KRAKEN_PAIR[sym]
        return f"{sym}USD"

    async def fetch_with_retry(self, url: str, params: dict) -> Optional[dict]:
        """Fetch URL with retries and aggressive exponential backoff."""
        self._reset_daily_if_needed()

        if self._is_budget_exhausted():
            logger.warning(f"Daily budget exhausted ({self._daily_calls}/{DAILY_BUDGET}). Skipping request.")
            return None

        client = await self.get_client()
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.get(url, params=params)
                self._daily_calls += 1

                if self._daily_calls % BUDGET_CHECK_INTERVAL == 0:
                    logger.info(f"API usage: {self._daily_calls}/{DAILY_BUDGET} today")

                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("error") and len(data["error"]) > 0:
                        logger.warning(f"Kraken API error: {data['error']}")
                        if "Unknown asset pair" in str(data["error"]):
                            return None
                    if self._consecutive_429 > 0:
                        logger.info(f"429 streak reset after {self._consecutive_429} consecutive rate limits.")
                        self._consecutive_429 = 0
                        self._last_429_time = None
                    return data

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
                    wait = random.uniform(2, 5) * (attempt + 1)
                    await asyncio.sleep(wait)

            except Exception as e:
                logger.error(f"Fetch error (attempt {attempt+1}): {e}")
                if attempt < MAX_RETRIES - 1:
                    wait = random.uniform(2, 5) * (attempt + 1)
                    await asyncio.sleep(wait)

        logger.error(f"All {MAX_RETRIES} retries exhausted for {url}")
        return None

    async def fetch_ohlc(self, symbol: str, since: Optional[int] = None) -> list[dict]:
        """Fetch OHLC data from Kraken.

        Returns list of records: {"timestamp": ISO-str, "price": float, "volume": float, "market_cap": null}
        """
        pair = self.resolve_pair(symbol)
        url = f"{KRAKEN_BASE_URL}/OHLC"
        params = {"pair": pair, "interval": KRAKEN_INTERVAL_DAILY}

        if since:
            params["since"] = since

        data = await self.fetch_with_retry(url, params)
        if not data:
            logger.warning("[PARSE] %s: No data returned from Kraken API (pair=%s)", symbol, pair)
            return []
        if "result" not in data:
            logger.warning("[PARSE] %s: Response missing 'result' key (pair=%s)", symbol, pair)
            return []

        result = data["result"]
        ohlc_data = None
        for key, value in result.items():
            if key != "last" and isinstance(value, list):
                ohlc_data = value
                break

        if not ohlc_data:
            logger.warning("[PARSE] %s: No OHLC array in result (pair=%s)", symbol, pair)
            return []

        records = []
        skipped = 0
        for candle in ohlc_data:
            try:
                if len(candle) < 7:
                    skipped += 1
                    continue
                ts = int(candle[0])
                close_price = float(candle[4])
                volume = float(candle[6])
                if close_price <= 0:
                    skipped += 1
                    continue
                ts_iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                records.append({
                    "timestamp": ts_iso,
                    "price": close_price,
                    "volume": volume,
                    "market_cap": None,
                })
            except (ValueError, TypeError, IndexError) as e:
                skipped += 1
                logger.debug("[PARSE] %s: Skipped malformed candle entry: %s", symbol, e)

        if skipped > 0:
            logger.warning("[PARSE] %s: Skipped %d/%d malformed candle entries", symbol, skipped, len(ohlc_data))
        logger.info("[PARSE] %s: Parsed %d valid records from Kraken", symbol, len(records))
        return records

    async def fetch_history_bulk(self, symbol: str, days: int) -> list[dict]:
        """Fetch multiple pages of OHLC data for bulk collection.

        Kraken returns max 720 candles per request for daily interval.
        """
        all_records = []
        since = None

        requests_needed = (days + 719) // 720

        for _ in range(min(requests_needed, 5)):
            records = await self.fetch_ohlc(symbol, since=since)
            if not records:
                break

            all_records = records + all_records

            if len(records) < 720:
                break

            # Get oldest timestamp from records to paginate backwards
            oldest_ts_str = min(r["timestamp"] for r in records)
            oldest_ts = datetime.fromisoformat(oldest_ts_str).timestamp()
            since = int(oldest_ts) - 86400

            # Human-like pause between pagination requests
            await asyncio.sleep(random.uniform(1.0, 3.0))

        if all_records:
            cutoff_ms = int((datetime.now(timezone.utc).timestamp() - days * 86400) * 1000)
            all_records = [
                r for r in all_records
                if int(datetime.fromisoformat(r["timestamp"]).timestamp() * 1000) >= cutoff_ms
            ]

        return all_records

    async def forward_to_pipeline(self, symbol: str, pair: str, records: list[dict]) -> dict:
        """Forward raw records to data-pipeline /api/raw endpoint."""
        if not records:
            return {"symbol": symbol, "ingested": 0, "total": 0}

        # Convert to flat array format with source field in each record
        flat_records = []
        for rec in records:
            flat_records.append({
                "symbol": symbol.upper(),
                "coin_id": pair,
                "timestamp": rec["timestamp"],
                "price": rec["price"],
                "volume": rec.get("volume"),
                "market_cap": rec.get("market_cap"),
                "source": "kraken",
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
            ingested = result.get("kraken", {}).get("ingested", 0)
            total = result.get("kraken", {}).get("total", 0)
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
        pair = self.resolve_pair(symbol)

        if force_bulk:
            days = BULK_DAYS
            logger.info(f"Bulk collecting {symbol} ({pair}): {days} days")
            records = await self.fetch_history_bulk(symbol, days)
        else:
            days = DAILY_DAYS
            logger.info(f"Daily collecting {symbol} ({pair}): {days} day")
            records = await self.fetch_ohlc(symbol)

        result = await self.forward_to_pipeline(symbol, pair, records)

        return {
            "symbol": symbol.upper(),
            "pair": pair,
            "days": days,
            "ingested": result.get("ingested", 0),
            "total_fetched": len(records),
        }

    async def collect_bulk(self, symbols: list[str], force: bool = False) -> list[dict]:
        """Collect data for multiple symbols with human-like pacing."""
        shuffled = symbols[:]
        random.shuffle(shuffled)

        results = []
        for i, sym in enumerate(shuffled):
            if self._is_budget_exhausted():
                logger.warning(
                    f"Budget exhausted at symbol {i+1}/{len(shuffled)}. "
                    f"Used {self._daily_calls}/{DAILY_BUDGET} calls. Pausing."
                )
                break

            result = await self.collect_symbol(sym, force_bulk=force)
            results.append(result)

            if i < len(shuffled) - 1:
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
            "source": "kraken",
            "daily_calls": self._daily_calls,
            "daily_budget": DAILY_BUDGET,
            "aggressive_mode": self._is_aggressive_mode(),
            "consecutive_429": self._consecutive_429,
        }
