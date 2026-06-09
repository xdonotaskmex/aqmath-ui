"""Configuration for Coinbase Collector.

Coinbase Exchange PUBLIC API limits:
- 10 requests/sec for public endpoints
- 30 candles/candle requests per second
We use jittered delays and daily budget to stay safe.
"""
import os

COINBASE_BASE_URL = "https://api.exchange.coinbase.com"
DATA_PIPELINE_URL = os.getenv("DATA_PIPELINE_URL", "http://localhost:8004")  # data-pipeline service

# --- Rate limiting (human-like, NOT fixed) ---
DELAY_MIN = 2.5          # min seconds between requests
DELAY_MAX = 6.0          # max seconds between requests (random jitter)
MAX_RETRIES = 5          # more retries with aggressive backoff
AGGRESSIVE_BASE = 30.0   # base wait on 429 (seconds)
AGGRESSIVE_MAX = 180.0   # max wait on 429 (3 minutes)
AGGRESSIVE_MULTIPLIER = 2.0  # exponential multiplier per consecutive 429
COOLDOWN_RESET_MIN = 10  # minutes without 429 before resetting aggressive mode

# --- Daily API budget ---
DAILY_BUDGET = 2500      # max API calls per day
BUDGET_CHECK_INTERVAL = 100  # log usage every N requests

# --- Bulk pacing ---
BULK_PAUSE_EVERY = 10    # pause extra every N symbols during bulk
BULK_PAUSE_MIN = 15.0    # extra pause min (seconds)
BULK_PAUSE_MAX = 30.0    # extra pause max (seconds)

BULK_DAYS = 365   # YTD bulk collection
DAILY_DAYS = 1    # daily delta collection
GRANULARITY = 86400  # daily candles in seconds

# Symbol -> Coinbase product ID mapping
SYMBOL_TO_COINBASE_PAIR = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "SOL": "SOL-USD",
    "ADA": "ADA-USD",
    "DOT": "DOT-USD",
    "LINK": "LINK-USD",
    "AVAX": "AVAX-USD",
    "MATIC": "MATIC-USD",
    "UNI": "UNI-USD",
    "ATOM": "ATOM-USD",
    "XRP": "XRP-USD",
    "LTC": "LTC-USD",
    "BCH": "BCH-USD",
    "ALGO": "ALGO-USD",
    "XTZ": "XTZ-USD",
    "FIL": "FIL-USD",
    "AAVE": "AAVE-USD",
    "SNX": "SNX-USD",
    "COMP": "COMP-USD",
    "MKR": "MKR-USD",
    "YFI": "YFI-USD",
    "CRV": "CRV-USD",
    "SUSHI": "SUSHI-USD",
    "MANA": "MANA-USD",
    "SAND": "SAND-USD",
    "AXS": "AXS-USD",
    "NEAR": "NEAR-USD",
    "FTM": "FTM-USD",
    "ICP": "ICP-USD",
    "DOGE": "DOGE-USD",
    "SHIB": "SHIB-USD",
    "PEPE": "PEPE-USD",
    "ARB": "ARB-USD",
    "OP": "OP-USD",
    "APT": "APT-USD",
    "SUI": "SUI-USD",
    "SEI": "SEI-USD",
    "TIA": "TIA-USD",
    "INJ": "INJ-USD",
    "RENDER": "RENDER-USD",
    "FET": "FET-USD",
    "OCEAN": "OCEAN-USD",
    "HBAR": "HBAR-USD",
    "VET": "VET-USD",
    "GRT": "GRT-USD",
    "ENS": "ENS-USD",
    "LDO": "LDO-USD",
    "STX": "STX-USD",
    "IMX": "IMX-USD",
    "BONK": "BONK-USD",
    "WLD": "WLD-USD",
    "JTO": "JTO-USD",
    "PYTH": "PYTH-USD",
}

# Coinbase returns max 300 candles per request
COINBASE_MAX_CANDLES = 300

PORT = int(os.getenv("PORT", 8003))
