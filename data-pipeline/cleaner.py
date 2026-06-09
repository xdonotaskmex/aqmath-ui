"""Core data cleaning logic for the pipeline.

Reads raw data from raw_coingecko, raw_kraken, raw_coinbase tables,
cleans, validates, merges, and writes to crypto_prices table.
"""
import logging
import math
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

import asyncpg

from config import (
    DATABASE_URL,
    MAX_GAP_FILL_DAYS,
    OUTLIER_STD_THRESHOLD,
    ROLLING_WINDOW_DAYS,
)
from validator import validate_prices

logger = logging.getLogger(__name__)

CREATE_CLEAN_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS crypto_prices (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    open_price NUMERIC NOT NULL,
    close_price NUMERIC NOT NULL,
    high_price NUMERIC,
    low_price NUMERIC,
    volume NUMERIC,
    source VARCHAR(20) NOT NULL DEFAULT 'merged',
    data_points INTEGER DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, date)
);
"""

CREATE_RAW_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS raw_coingecko (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    coin_id VARCHAR(100),
    timestamp TIMESTAMPTZ NOT NULL,
    price NUMERIC NOT NULL,
    volume NUMERIC,
    market_cap NUMERIC,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, timestamp)
);

CREATE TABLE IF NOT EXISTS raw_kraken (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    coin_id VARCHAR(100),
    timestamp TIMESTAMPTZ NOT NULL,
    price NUMERIC NOT NULL,
    volume NUMERIC,
    market_cap NUMERIC,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, timestamp)
);

CREATE TABLE IF NOT EXISTS raw_coinbase (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    coin_id VARCHAR(100),
    timestamp TIMESTAMPTZ NOT NULL,
    price NUMERIC NOT NULL,
    volume NUMERIC,
    market_cap NUMERIC,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, timestamp)
);
"""

UPSERT_CLEAN_SQL = """
INSERT INTO crypto_prices (symbol, date, open_price, close_price, high_price, low_price, volume, source, data_points)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (symbol, date) DO UPDATE
SET open_price = EXCLUDED.open_price,
    close_price = EXCLUDED.close_price,
    high_price = EXCLUDED.high_price,
    low_price = EXCLUDED.low_price,
    volume = EXCLUDED.volume,
    source = EXCLUDED.source,
    data_points = EXCLUDED.data_points,
    updated_at = NOW();
"""

# Queries to fetch raw data from each source
FETCH_RAW_COINGECKO = """
SELECT DISTINCT ON (DATE(timestamp))
    DATE(timestamp) as date,
    price,
    volume
FROM raw_coingecko
WHERE symbol = $1
ORDER BY DATE(timestamp), timestamp DESC;
"""

FETCH_RAW_KRAKEN = """
SELECT DISTINCT ON (DATE(timestamp))
    DATE(timestamp) as date,
    price,
    volume
FROM raw_kraken
WHERE symbol = $1
ORDER BY DATE(timestamp), timestamp DESC;
"""

FETCH_RAW_COINBASE = """
SELECT DISTINCT ON (DATE(timestamp))
    DATE(timestamp) as date,
    price,
    volume
FROM raw_coinbase
WHERE symbol = $1
ORDER BY DATE(timestamp), timestamp DESC;
"""


# Raw table insert SQL per source
RAW_INSERT_SQL = {
    "coingecko": """
        INSERT INTO raw_coingecko (symbol, coin_id, timestamp, price, volume, market_cap)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (symbol, timestamp) DO UPDATE
        SET price = EXCLUDED.price, volume = EXCLUDED.volume,
            market_cap = EXCLUDED.market_cap, collected_at = NOW();
    """,
    "kraken": """
        INSERT INTO raw_kraken (symbol, coin_id, timestamp, price, volume, market_cap)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (symbol, timestamp) DO UPDATE
        SET price = EXCLUDED.price, volume = EXCLUDED.volume, collected_at = NOW();
    """,
    "coinbase": """
        INSERT INTO raw_coinbase (symbol, coin_id, timestamp, price, volume, market_cap)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (symbol, timestamp) DO UPDATE
        SET price = EXCLUDED.price, volume = EXCLUDED.volume, collected_at = NOW();
    """,
}


class DataCleaner:
    """Cleans and merges raw crypto price data from multiple sources."""

    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None

    async def init_db(self):
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            async with self.pool.acquire() as conn:
                await conn.execute(CREATE_CLEAN_TABLE_SQL)
                await conn.execute(CREATE_RAW_TABLES_SQL)
            logger.info("Database tables initialized (crypto_prices + raw tables).")
        except Exception as e:
            logger.error("Failed to initialize database pool: %s", e)
            raise

    async def close(self):
        if self.pool:
            await self.pool.close()

    async def ingest_raw(self, records: list[dict]) -> dict:
        """Ingest raw records from collectors into the appropriate raw_X tables.

        Flat array format: each record has its own source field.
        [{"symbol": "BTC", "timestamp": "...", "price": 67210.34, "volume": 123.45, "source": "coingecko"}, ...]

        Returns dict with counts per source.
        """
        # Group records by source
        by_source: dict[str, list[dict]] = {}
        for rec in records:
            source = rec.get("source", "").lower()
            if source not in RAW_INSERT_SQL:
                logger.warning(f"Skipping record with unknown source: {source}")
                continue
            if source not in by_source:
                by_source[source] = []
            by_source[source].append(rec)

        results = {}
        try:
            async with self.pool.acquire() as conn:
                for source, src_records in by_source.items():
                    sql = RAW_INSERT_SQL[source]
                    count = 0
                    for rec in src_records:
                        try:
                            ts = datetime.fromisoformat(rec["timestamp"])
                            if ts.tzinfo is None:
                                ts = ts.replace(tzinfo=timezone.utc)
                            symbol = rec["symbol"].upper()
                            coin_id = rec.get("coin_id", symbol)
                            await conn.execute(
                                sql,
                                symbol,
                                coin_id,
                                ts,
                                rec["price"],
                                rec.get("volume"),
                                rec.get("market_cap"),
                            )
                            count += 1
                        except Exception as e:
                            logger.warning(
                                "[INGEST] %s @ %s: %s",
                                rec.get("symbol", "?"), rec.get("timestamp", "?"), e,
                            )
                    results[source] = {"ingested": count, "total": len(src_records)}
                    logger.info("Ingested %d/%d raw records from %s", count, len(src_records), source)
        except Exception as e:
            logger.error("[INGEST] Database connection error during raw ingest: %s", e)

        return results

    async def get_prices(self, symbol: str, days: int = 180) -> list[float]:
        """Get historical close prices for a symbol from clean data.

        Returns just a list of floats (close prices), ordered by date ascending.
        Used by dca-engine and other services that need price history.
        """
        if not self.pool:
            logger.error("DB pool not initialized")
            return []
        try:
            async with self.pool.acquire() as conn:
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
                logger.warning("[PRICES] No clean data found for %s", symbol)
        except asyncpg.exceptions.PostgresError as e:
            logger.error("[PRICES] DB error fetching %s: %s", symbol, e)
        except Exception as e:
            logger.error("[PRICES] Unexpected error fetching %s: %s", symbol, e)
        return []

    async def get_raw_symbols(self) -> dict:
        """Get symbols with raw data per source, including last collected date."""
        result = {}
        async with self.pool.acquire() as conn:
            for source, table in [("coingecko", "raw_coingecko"), ("kraken", "raw_kraken"), ("coinbase", "raw_coinbase")]:
                rows = await conn.fetch(f"""
                    SELECT symbol, MAX(timestamp) as last_ts, COUNT(*) as records
                    FROM {table}
                    GROUP BY symbol
                    ORDER BY symbol
                """)
                result[source] = [
                    {"symbol": r["symbol"], "last_date": str(r["last_ts"]) if r["last_ts"] else None, "records": r["records"]}
                    for r in rows
                ]
        return result

    async def fetch_raw_data(self, symbol: str) -> dict[str, list[dict]]:
        """Fetch raw data from all three sources for a symbol.

        Returns dict with source names as keys and lists of {date, price, volume} as values.
        """
        sources = {}

        async with self.pool.acquire() as conn:
            for source_name, query in [
                ("coingecko", FETCH_RAW_COINGECKO),
                ("kraken", FETCH_RAW_KRAKEN),
                ("coinbase", FETCH_RAW_COINBASE),
            ]:
                rows = await conn.fetch(query, symbol.upper())
                if rows:
                    sources[source_name] = [
                        {
                            "date": r["date"],
                            "price": float(r["price"]),
                            "volume": float(r["volume"]) if r["volume"] else 0.0,
                        }
                        for r in rows
                    ]

        return sources

    def deduplicate(self, data: list[dict]) -> list[dict]:
        """Remove duplicate dates, keeping the last entry per date."""
        seen = {}
        for record in data:
            d = record["date"]
            seen[d] = record  # last write wins
        return sorted(seen.values(), key=lambda x: x["date"])

    def remove_outliers(self, data: list[dict]) -> list[dict]:
        """Remove prices deviating more than N std devs from rolling mean.

        Uses a 7-day rolling window to compute local mean and std.
        """
        if len(data) < ROLLING_WINDOW_DAYS + 1:
            return data

        cleaned = []
        for i, record in enumerate(data):
            # Compute rolling window around current point
            start = max(0, i - ROLLING_WINDOW_DAYS)
            end = min(len(data), i + ROLLING_WINDOW_DAYS + 1)
            window = [d["price"] for d in data[start:end]]

            if len(window) < 3:
                cleaned.append(record)
                continue

            mean = sum(window) / len(window)
            variance = sum((x - mean) ** 2 for x in window) / len(window)
            std = math.sqrt(variance)

            if std > 0 and abs(record["price"] - mean) > OUTLIER_STD_THRESHOLD * std:
                logger.debug(
                    f"Outlier removed: {record['date']} price={record['price']:.4f} "
                    f"mean={mean:.4f} std={std:.4f}"
                )
                continue

            cleaned.append(record)

        return cleaned

    def fill_gaps(self, data: list[dict]) -> list[dict]:
        """Fill small gaps (1-2 days) with linear interpolation."""
        if len(data) < 2:
            return data

        filled = [data[0]]
        for i in range(1, len(data)):
            prev = data[i - 1]
            curr = data[i]
            gap_days = (curr["date"] - prev["date"]).days

            if 1 < gap_days <= MAX_GAP_FILL_DAYS + 1:
                # Interpolate missing days
                for day_offset in range(1, gap_days):
                    interp_date = prev["date"] + timedelta(days=day_offset)
                    ratio = day_offset / gap_days
                    interp_price = prev["price"] + (curr["price"] - prev["price"]) * ratio
                    interp_volume = prev["volume"] + (curr["volume"] - prev["volume"]) * ratio
                    filled.append({
                        "date": interp_date,
                        "price": interp_price,
                        "volume": interp_volume,
                        "interpolated": True,
                    })

            filled.append(curr)

        return filled

    def merge_sources(self, sources: dict[str, list[dict]]) -> list[dict]:
        """Merge data from multiple sources using median price.

        For each date, takes the median price across available sources.
        """
        # Build date -> list of prices/volumes from all sources
        date_map: dict[date, list[dict]] = {}

        for source_name, records in sources.items():
            for record in records:
                d = record["date"]
                if d not in date_map:
                    date_map[d] = []
                date_map[d].append({
                    "price": record["price"],
                    "volume": record["volume"],
                    "source": source_name,
                })

        merged = []
        for d in sorted(date_map.keys()):
            entries = date_map[d]
            data_points = len(entries)

            # Sort by price and take median
            sorted_entries = sorted(entries, key=lambda x: x["price"])
            mid = len(sorted_entries) // 2
            median_entry = sorted_entries[mid]

            # Average volumes
            avg_volume = sum(e["volume"] for e in entries) / len(entries)

            source_label = "merged" if data_points > 1 else entries[0]["source"]

            merged.append({
                "date": d,
                "close_price": median_entry["price"],
                "open_price": median_entry["price"],  # Use close as open when only close available
                "volume": avg_volume,
                "source": source_label,
                "data_points": data_points,
            })

        return merged

    async def clean_symbol(self, symbol: str) -> dict:
        """Full cleaning pipeline for a single symbol.

        Steps:
        1. Fetch raw data from all sources
        2. Deduplicate each source
        3. Remove outliers from each source
        4. Merge sources (median price)
        5. Fill small gaps with interpolation
        6. Validate result
        7. Store to clean table
        """
        import time as _time
        _t0 = _time.monotonic()
        logger.info("[CLEAN] %s: Starting...", symbol)

        # Step 1: Fetch raw data
        sources = await self.fetch_raw_data(symbol)
        if not sources:
            logger.warning(f"No raw data found for {symbol}")
            return {
                "symbol": symbol,
                "status": "no_data",
                "records_written": 0,
            }

        raw_counts = {k: len(v) for k, v in sources.items()}
        logger.info(f"Raw data for {symbol}: {raw_counts}")

        # Step 2 & 3: Deduplicate and remove outliers per source
        cleaned_sources = {}
        for source_name, records in sources.items():
            deduped = self.deduplicate(records)
            no_outliers = self.remove_outliers(deduped)
            cleaned_sources[source_name] = no_outliers

        # Step 4: Merge sources
        merged = self.merge_sources(cleaned_sources)

        # Step 5: Fill gaps
        filled = self.fill_gaps(merged)

        # Step 6: Validate
        validation = validate_prices(symbol, filled)
        logger.info(
            f"Validation for {symbol}: {validation.days_count} days, "
            f"sufficient={validation.has_sufficient_history}, "
            f"warnings={len(validation.warnings)}, errors={len(validation.errors)}"
        )

        if not validation.is_valid:
            logger.error(f"Validation failed for {symbol}: {validation.errors}")
            return {
                "symbol": symbol,
                "status": "validation_failed",
                "errors": validation.errors,
                "records_written": 0,
            }

        # Step 7: Store clean data
        count = 0
        async with self.pool.acquire() as conn:
            for record in filled:
                try:
                    await conn.execute(
                        UPSERT_CLEAN_SQL,
                        symbol.upper(),
                        record["date"],
                        record["open_price"],
                        record["close_price"],
                        None,  # high_price
                        None,  # low_price
                        record["volume"],
                        record["source"],
                        record["data_points"],
                    )
                    count += 1
                except Exception as e:
                    logger.warning("[CLEAN] %s: Upsert skip @ %s: %s", symbol, record["date"], e)

        elapsed = _time.monotonic() - _t0
        logger.info("[CLEAN] %s: Wrote %d clean records in %.1fs", symbol, count, elapsed)
        return {
            "symbol": symbol,
            "status": "cleaned",
            "records_written": count,
            "has_sufficient_history": validation.has_sufficient_history,
            "warnings": validation.warnings,
            "gaps": [(str(g[0]), str(g[1])) for g in validation.gaps],
            "raw_counts": raw_counts,
        }

    async def clean_all(self) -> list[dict]:
        """Clean data for all symbols that have raw data."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT DISTINCT symbol FROM (
                    SELECT symbol FROM raw_coingecko
                    UNION
                    SELECT symbol FROM raw_kraken
                    UNION
                    SELECT symbol FROM raw_coinbase
                ) AS all_symbols
            """)
            symbols = [r["symbol"] for r in rows]

        logger.info(f"Cleaning {len(symbols)} symbols: {symbols}")
        results = []
        for sym in symbols:
            result = await self.clean_symbol(sym)
            results.append(result)

        return results

    async def get_stats(self) -> dict:
        """Get pipeline statistics."""
        async with self.pool.acquire() as conn:
            clean_row = await conn.fetchrow(
                "SELECT COUNT(DISTINCT symbol), COUNT(*), MAX(updated_at) FROM crypto_prices"
            )
            raw_cg = await conn.fetchrow("SELECT COUNT(DISTINCT symbol), COUNT(*) FROM raw_coingecko")
            raw_kr = await conn.fetchrow("SELECT COUNT(DISTINCT symbol), COUNT(*) FROM raw_kraken")
            raw_cb = await conn.fetchrow("SELECT COUNT(DISTINCT symbol), COUNT(*) FROM raw_coinbase")

            # Symbols with insufficient history
            insufficient = await conn.fetch("""
                SELECT symbol, COUNT(*) as days
                FROM crypto_prices
                GROUP BY symbol
                HAVING COUNT(*) < 180
            """)

            return {
                "clean": {
                    "symbols": clean_row[0] if clean_row else 0,
                    "records": clean_row[1] if clean_row else 0,
                    "last_updated": str(clean_row[2]) if clean_row and clean_row[2] else None,
                },
                "raw": {
                    "coingecko": {"symbols": raw_cg[0] or 0, "records": raw_cg[1] or 0},
                    "kraken": {"symbols": raw_kr[0] or 0, "records": raw_kr[1] or 0},
                    "coinbase": {"symbols": raw_cb[0] or 0, "records": raw_cb[1] or 0},
                },
                "insufficient_history": [
                    {"symbol": r["symbol"], "days": r["days"]} for r in insufficient
                ],
            }
