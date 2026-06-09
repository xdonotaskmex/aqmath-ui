# Add Error Logging Across All Services

CoinGecko collector already done (previous session). This plan covers the remaining 5 services with exact code.

## Task 1: Kraken Collector (`kraken-collector/collector.py`)

### 1a. `fetch_ohlc()` — Add parsing validation (lines 203-230)

Replace:
```python
        data = await self.fetch_with_retry(url, params)
        if not data or "result" not in data:
            return []

        result = data["result"]
        ohlc_data = None
        for key, value in result.items():
            if key != "last" and isinstance(value, list):
                ohlc_data = value
                break

        if not ohlc_data:
            return []

        records = []
        for candle in ohlc_data:
            ts = int(candle[0])
            close_price = float(candle[4])
            volume = float(candle[6])
            ts_iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            records.append({
                "timestamp": ts_iso,
                "price": close_price,
                "volume": volume,
                "market_cap": None,
            })

        return records
```
With:
```python
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
```

### 1b. `forward_to_pipeline()` — Specific exception handlers (lines 287-298)

Replace:
```python
        client = await self.get_client()
        try:
            resp = await client.post(f"{DATA_PIPELINE_URL}/api/raw", json=flat_records, timeout=30.0)
            resp.raise_for_status()
            result = resp.json()
            ingested = result.get("kraken", {}).get("ingested", 0)
            total = result.get("kraken", {}).get("total", 0)
            logger.info(f"Pipeline ingest: {symbol} -> {ingested}/{total} records")
            return {"symbol": symbol, "ingested": ingested, "total": total}
        except Exception as e:
            logger.error(f"Pipeline forward failed for {symbol}: {e}")
            return {"symbol": symbol, "ingested": 0, "total": len(records), "error": str(e)}
```
With:
```python
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
```

## Task 2: Coinbase Collector (`coinbase-collector/collector.py`)

### 2a. `fetch_candles()` — Add parsing validation (lines 218-232)

Replace:
```python
        records = []
        for candle in data:
            ts = int(candle[0])
            close_price = float(candle[4])
            volume = float(candle[5])
            ts_iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            records.append({
                "timestamp": ts_iso,
                "price": close_price,
                "volume": volume,
                "market_cap": None,
            })

        records.sort(key=lambda x: x["timestamp"])
        return records
```
With:
```python
        records = []
        skipped = 0
        for candle in data:
            try:
                if len(candle) < 6:
                    skipped += 1
                    continue
                ts = int(candle[0])
                close_price = float(candle[4])
                volume = float(candle[5])
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
            logger.warning("[PARSE] %s: Skipped %d/%d malformed candle entries", symbol, skipped, len(data))
        logger.info("[PARSE] %s: Parsed %d valid records from Coinbase", symbol, len(records))
        records.sort(key=lambda x: x["timestamp"])
        return records
```

### 2b. `forward_to_pipeline()` — Specific exception handlers (lines 295-306)

Replace:
```python
        client = await self.get_client()
        try:
            resp = await client.post(f"{DATA_PIPELINE_URL}/api/raw", json=flat_records, timeout=30.0)
            resp.raise_for_status()
            result = resp.json()
            ingested = result.get("coinbase", {}).get("ingested", 0)
            total = result.get("coinbase", {}).get("total", 0)
            logger.info(f"Pipeline ingest: {symbol} -> {ingested}/{total} records")
            return {"symbol": symbol, "ingested": ingested, "total": total}
        except Exception as e:
            logger.error(f"Pipeline forward failed for {symbol}: {e}")
            return {"symbol": symbol, "ingested": 0, "total": len(records), "error": str(e)}
```
With:
```python
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
            ingested = result.get("coinbase", {}).get("ingested", 0)
            total = result.get("coinbase", {}).get("total", 0)
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
```

## Task 3: Data Pipeline (`data-pipeline/cleaner.py` + `main.py`)

### 3a. `cleaner.py` — `init_db()` — Wrap pool creation (lines 117-121)

Replace:
```python
    async def init_db(self):
        self.pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        async with self.pool.acquire() as conn:
            await conn.execute(CREATE_CLEAN_TABLE_SQL)
        logger.info("Clean table initialized.")
```
With:
```python
    async def init_db(self):
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            async with self.pool.acquire() as conn:
                await conn.execute(CREATE_CLEAN_TABLE_SQL)
            logger.info("Clean table initialized.")
        except Exception as e:
            logger.error("Failed to initialize database pool: %s", e)
            raise
```

### 3b. `cleaner.py` — `ingest_raw()` — Better per-record logging + pool error (lines 146-173)

Replace:
```python
        results = {}
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
                        # Use symbol as coin_id fallback (collectors may not provide coin_id)
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
                        logger.debug(f"Ingest skip {rec.get('symbol')} @ {rec.get('timestamp')}: {e}")
                results[source] = {"ingested": count, "total": len(src_records)}
                logger.info(f"Ingested {count}/{len(src_records)} raw records from {source}")

        return results
```
With:
```python
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
```

### 3c. `cleaner.py` — `clean_symbol()` — Timing + upsert warning (lines 373 + 436-437)

Replace line 373:
```python
        logger.info(f"Cleaning {symbol}...")
```
With:
```python
        import time as _time
        _t0 = _time.monotonic()
        logger.info("[CLEAN] %s: Starting...", symbol)
```

Replace line 437:
```python
                    logger.debug(f"Upsert skip {symbol} @ {record['date']}: {e}")
```
With:
```python
                    logger.warning("[CLEAN] %s: Upsert skip @ %s: %s", symbol, record["date"], e)
```

Replace line 439:
```python
        logger.info(f"Wrote {count} clean records for {symbol}")
```
With:
```python
        elapsed = _time.monotonic() - _t0
        logger.info("[CLEAN] %s: Wrote %d clean records in %.1fs", symbol, count, elapsed)
```

### 3d. `cleaner.py` — `get_prices()` — Warn on empty result (after line 197)

Replace:
```python
                    if len(prices) > days:
                        prices = prices[-days:]
                    return prices
        except Exception as e:
            logger.error(f"Error fetching prices for {symbol}: {e}")
        return []
```
With:
```python
                    if len(prices) > days:
                        prices = prices[-days:]
                    return prices
                logger.warning("[PRICES] No clean data found for %s", symbol)
        except asyncpg.exceptions.PostgresError as e:
            logger.error("[PRICES] DB error fetching %s: %s", symbol, e)
        except Exception as e:
            logger.error("[PRICES] Unexpected error fetching %s: %s", symbol, e)
        return []
```

### 3e. `main.py` — `api_symbols()` — DB error handling (lines 90-107)

Replace:
```python
@app.get("/api/symbols")
async def api_symbols():
    """Get all tracked symbols with metadata. Used by collectors for daily cron."""
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
```
With:
```python
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
```

### 3f. `main.py` — `get_prices()` — Warn on empty (lines 130-137)

Replace:
```python
@app.get("/api/prices")
async def get_prices(symbol: str = Query(...), days: int = Query(180)):
    """Get historical clean prices for a symbol.

    Returns just a list of close prices (numbers). Used by dca-engine and other services.
    """
    prices = await cleaner.get_prices(symbol, days)
    return {"symbol": symbol.upper(), "prices": prices}
```
With:
```python
@app.get("/api/prices")
async def get_prices(symbol: str = Query(...), days: int = Query(180)):
    """Get historical clean prices for a symbol.

    Returns just a list of close prices (numbers). Used by dca-engine and other services.
    """
    prices = await cleaner.get_prices(symbol, days)
    if not prices:
        logger.warning("[API] /api/prices: No clean data for %s (days=%d)", symbol, days)
    return {"symbol": symbol.upper(), "prices": prices}
```

### 3g. `main.py` — `scheduled_clean()` — Top-level try/except (lines 25-31)

Replace:
```python
async def scheduled_clean():
    """Scheduled cleaning job: clean all symbols."""
    logger.info("Scheduled cleaning started...")
    results = await cleaner.clean_all()
    cleaned = sum(1 for r in results if r["status"] == "cleaned")
    failed = sum(1 for r in results if r["status"] != "cleaned")
    logger.info(f"Scheduled cleaning done: {cleaned} cleaned, {failed} failed/skipped")
```
With:
```python
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
```

## Task 4: AQMath Engine (`aqmath-engine/`)

### 4a. `quantum_engine.py` — `get_latest_price()` — Warn on no data (after line 59)

Replace:
```python
            if row:
                return float(row["close_price"])
    except Exception as e:
        logger.warning(f"DB price fetch failed for {symbol}: {e}")
    return None
```
With:
```python
            if row:
                return float(row["close_price"])
            logger.warning("[DB] No price data found for %s", symbol)
    except Exception as e:
        logger.error("[DB] Price fetch failed for %s: %s", symbol, e)
    return None
```

### 4b. `quantum_engine.py` — `get_historical_prices()` — Warn on no data (after line 83)

Replace:
```python
            if rows:
                prices = [float(r["close_price"]) for r in rows]
                # Trim to requested days (keep most recent)
                if len(prices) > days:
                    prices = prices[-days:]
                return prices
    except Exception as e:
        logger.warning(f"DB history fetch failed for {symbol}: {e}")
    return None
```
With:
```python
            if rows:
                prices = [float(r["close_price"]) for r in rows]
                if len(prices) > days:
                    prices = prices[-days:]
                return prices
            logger.warning("[DB] No historical data found for %s", symbol)
    except Exception as e:
        logger.error("[DB] History fetch failed for %s: %s", symbol, e)
    return None
```

### 4c. `quantum_engine.py` — `optimize_portfolio()` — Wrap risk_parity_optimize (lines 185-186)

Replace:
```python
    # ---- Run KKT Risk Parity ----
    result = risk_parity_optimize(historical_data, effective_remaining_alloc)
```
With:
```python
    # ---- Run KKT Risk Parity ----
    try:
        result = risk_parity_optimize(historical_data, effective_remaining_alloc)
    except (ValueError, ZeroDivisionError, OverflowError) as e:
        logger.error("[OPTIMIZE] Risk Parity failed: %s", e, exc_info=True)
        return {"allocations": {}, "warnings": [f"Optimization failed: {e}"], "error": str(e)}
```

### 4d. `risk_parity.py` — Add logger + guards

Add after line 12 (`import math`):
```python
import logging

logger = logging.getLogger(__name__)
```

In `compute_covariance_matrix()` (after line 63 `T = len(all_returns[0])`), add:
```python
    if T < 2:
        logger.warning("[RISK] Covariance: only %d data points, division by (T-1) will be unstable", T)
```

In `risk_parity_optimize()`, wrap the covariance call (line 120) in a guard:
```python
    # ---- Step 3: Covariance matrix ----
    try:
        cov = compute_covariance_matrix(aligned_returns)
    except (ZeroDivisionError, ValueError) as e:
        logger.error("[RISK] Covariance computation failed: %s", e)
        return {"weights": [], "warnings": [f"Covariance computation failed: {e}"]}
```

After the gradient descent loop (after line 206 `final_weights = [...]`), add:
```python
    total_alloc = sum(max(0.0, w) for w in final_weights)
    logger.info("[RISK] Optimization result: %d assets, total allocation=%.2f%%", n, total_alloc * 100)
```

### 4e. `main.py` — `optimize()` — Top-level try/except (lines 76-99)

Replace:
```python
@app.post("/optimize")
async def optimize(req: OptimizeRequest):
    """Run Quantum Engine optimization on given tickers.

    Takes ticker symbols, reads historical data from DB, runs KKT Risk Parity.
    Returns optimized allocation weights per symbol.
    """
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
```
With:
```python
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
```

### 4f. `main.py` — `get_price()` — Warn on None (lines 124-132)

Replace:
```python
@app.get("/prices/{symbol}")
async def get_price(symbol: str):
    """Get latest price for a symbol from the DB."""
    price = await get_latest_price(symbol)
    return {
        "symbol": symbol.upper(),
        "price": price,
        "source": "database" if price else "unavailable",
    }
```
With:
```python
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
```

## Task 5: DCA Engine (`dca-engine/`)

### 5a. `dca.py` — `get_historical_prices()` — Specific handlers + short-list warning (lines 29-45)

Replace:
```python
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{DATA_PIPELINE_URL}/api/prices",
                params={"symbol": symbol.upper(), "days": days},
            )
            resp.raise_for_status()
            data = resp.json()
            prices = data.get("prices", [])
            if prices:
                logger.debug("[HTTP] Fetched %d prices for %s from pipeline", len(prices), symbol)
                return prices
            else:
                logger.warning("[HTTP] No price history found for %s", symbol)
    except Exception as e:
        logger.error("[HTTP] Error fetching history for %s: %s\n%s", symbol, e, traceback.format_exc())
    return None
```
With:
```python
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{DATA_PIPELINE_URL}/api/prices",
                params={"symbol": symbol.upper(), "days": days},
            )
            if resp.status_code != 200:
                logger.error("[HTTP] %s: GET /api/prices returned HTTP %d (days=%d)", symbol, resp.status_code, days)
            resp.raise_for_status()
            data = resp.json()
            prices = data.get("prices", [])
            if prices:
                if len(prices) < days:
                    logger.warning("[HTTP] %s: Got %d prices but requested %d days", symbol, len(prices), days)
                logger.debug("[HTTP] Fetched %d prices for %s from pipeline", len(prices), symbol)
                return prices
            else:
                logger.warning("[HTTP] No price history found for %s (days=%d)", symbol, days)
    except httpx.HTTPStatusError as e:
        logger.error("[HTTP] %s: GET /api/prices HTTP %d (days=%d)", symbol, e.response.status_code, days)
    except httpx.TimeoutException:
        logger.error("[HTTP] %s: GET /api/prices timed out (days=%d)", symbol, days)
    except Exception as e:
        logger.error("[HTTP] %s: GET /api/prices failed: %s (days=%d)", symbol, e, days)
    return None
```

### 5b. `volatility.py` — `calculate_volatility()` — Upgrade debug to warning (lines 22-27)

Replace:
```python
    if not prices:
        logger.debug("[VOL] Empty price list, returning 0.0 volatility")
        return 0.0

    subset = prices[-days:] if len(prices) > days else prices[:]
    if len(subset) < 2:
        return 0.0
```
With:
```python
    if not prices:
        logger.warning("[VOL] Empty price list, returning 0.0 volatility")
        return 0.0

    subset = prices[-days:] if len(prices) > days else prices[:]
    if len(subset) < 2:
        logger.warning("[VOL] Only %d price point(s), cannot compute volatility", len(subset))
        return 0.0
```

## Task 6: Push All Repos

```powershell
$env:PATH = "C:\Users\user\AppData\Local\GitHubDesktop\app-3.5.12\resources\app\git\cmd;" + $env:PATH

# kraken-collector
cd "c:\Users\user\OneDrive\Dokumenty\GitHub\Telegram-Bot\kraken-collector"
git add -A; git commit -m "Add error logging: parsing validation + pipeline forwarding"
git push origin main

# coinbase-collector
cd "c:\Users\user\OneDrive\Dokumenty\GitHub\Telegram-Bot\coinbase-collector"
git add -A; git commit -m "Add error logging: parsing validation + pipeline forwarding"
git push origin main

# data-pipeline
cd "c:\Users\user\OneDrive\Dokumenty\GitHub\Telegram-Bot\data-pipeline"
git add -A; git commit -m "Add error logging: ingest, clean, prices, pool, endpoints"
git push origin main

# aqmath-engine
cd "c:\Users\user\OneDrive\Dokumenty\GitHub\Telegram-Bot\aqmath-engine"
git add -A; git commit -m "Add error logging: DB prices, optimization, risk parity, endpoints"
git push origin main

# dca-engine
cd "c:\Users\user\OneDrive\Dokumenty\GitHub\Telegram-Bot\dca-engine"
git add -A; git commit -m "Add error logging: HTTP prices, volatility, endpoint"
git push origin main
```
