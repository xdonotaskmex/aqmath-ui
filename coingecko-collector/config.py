"""Configuration for CoinGecko Collector.

CoinGecko FREE tier limits:
- 10-30 calls/minute
- ~1000 calls/day (conservative)
We stay well under with jittered delays and daily budget.
"""
import os

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
DATA_PIPELINE_URL = os.getenv("DATA_PIPELINE_URL", "http://localhost:8004")  # data-pipeline service

# --- Rate limiting (human-like, NOT fixed) ---
DELAY_MIN = 8.0          # min seconds between requests (free tier is harsh)
DELAY_MAX = 15.0         # max seconds between requests (random jitter)
MAX_RETRIES = 5          # more retries with aggressive backoff
AGGRESSIVE_BASE = 60.0   # base wait on 429 (seconds)
AGGRESSIVE_MAX = 300.0   # max wait on 429 (5 minutes)
AGGRESSIVE_MULTIPLIER = 2.0  # exponential multiplier per consecutive 429
COOLDOWN_RESET_MIN = 15  # minutes without 429 before resetting aggressive mode

# --- Daily API budget ---
DAILY_BUDGET = 800       # max API calls per day (stay under 1000 free limit)
BUDGET_CHECK_INTERVAL = 50  # log usage every N requests

# --- Bulk pacing ---
BULK_PAUSE_EVERY = 5     # pause extra every N symbols during bulk
BULK_PAUSE_MIN = 30.0    # extra pause min (seconds)
BULK_PAUSE_MAX = 60.0    # extra pause max (seconds)

BULK_DAYS = 365  # YTD bulk collection
DAILY_DAYS = 1   # daily delta collection

# Custom symbol -> CoinGecko ID map (from original AQMath.html)
CUSTOM_COIN_MAP = {
    "DAG": "constellation-labs",
    "EWT": "energy-web-token",
    "PEAQ": "peaq-2",
    "TICS": "qubetics",
    "ATH": "aethir",
    "PYTH": "pyth-network",
}

PORT = int(os.getenv("PORT", 8001))
