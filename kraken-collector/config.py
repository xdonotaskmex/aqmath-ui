"""Configuration for Kraken Collector.

Kraken PUBLIC API limits:
- ~15 calls per 45 seconds for call rate counter
- Public endpoints are lighter but still rate limited
We use jittered delays and daily budget to stay safe.
"""
import os

KRAKEN_BASE_URL = "https://api.kraken.com/0/public"
DATA_PIPELINE_URL = os.getenv("DATA_PIPELINE_URL", "http://localhost:8004")  # data-pipeline service

# --- Rate limiting (human-like, NOT fixed) ---
DELAY_MIN = 2.0          # min seconds between requests
DELAY_MAX = 5.0          # max seconds between requests (random jitter)
MAX_RETRIES = 5          # more retries with aggressive backoff
AGGRESSIVE_BASE = 30.0   # base wait on 429 (seconds)
AGGRESSIVE_MAX = 180.0   # max wait on 429 (3 minutes)
AGGRESSIVE_MULTIPLIER = 2.0  # exponential multiplier per consecutive 429
COOLDOWN_RESET_MIN = 10  # minutes without 429 before resetting aggressive mode

# --- Daily API budget ---
DAILY_BUDGET = 2000      # max API calls per day
BUDGET_CHECK_INTERVAL = 100  # log usage every N requests

# --- Bulk pacing ---
BULK_PAUSE_EVERY = 10    # pause extra every N symbols during bulk
BULK_PAUSE_MIN = 15.0    # extra pause min (seconds)
BULK_PAUSE_MAX = 30.0    # extra pause max (seconds)

BULK_DAYS = 365  # YTD bulk collection
DAILY_DAYS = 1   # daily delta collection

# Symbol -> Kraken pair mapping
# Kraken uses XBT instead of BTC, and some pairs differ
SYMBOL_TO_KRAKEN_PAIR = {
    "BTC": "XBTUSD",
    "ETH": "ETHUSD",
    "SOL": "SOLUSD",
    "ADA": "ADAUSD",
    "DOT": "DOTUSD",
    "LINK": "LINKUSD",
    "AVAX": "AVAXUSD",
    "MATIC": "MATICUSD",
    "UNI": "UNIUSD",
    "ATOM": "ATOMUSD",
    "XRP": "XRPUSD",
    "LTC": "LTCUSD",
    "BCH": "BCHUSD",
    "ALGO": "ALGOUSD",
    "XTZ": "XTZUSD",
    "FIL": "FILUSD",
    "AAVE": "AAVEUSD",
    "SNX": "SNXUSD",
    "COMP": "COMPUSD",
    "MKR": "MKRUSD",
    "YFI": "YFIUSD",
    "CRV": "CRVUSD",
    "SUSHI": "SUSHIUSD",
    "MANA": "MANAUSD",
    "SAND": "SANDUSD",
    "AXS": "AXSUSD",
    "NEAR": "NEARUSD",
    "FTM": "FTMUSD",
    "ICP": "ICPUSD",
    "DOGE": "DOGEUSD",
    "SHIB": "SHIBUSD",
    "PEPE": "PEPEUSD",
    "ARB": "ARBUSD",
    "OP": "OPUSD",
    "APT": "APTUSD",
    "SUI": "SUIUSD",
    "SEI": "SEIUSD",
    "TIA": "TIAUSD",
    "INJ": "INJUSD",
    "RENDER": "RENDERUSD",
    "FET": "FETUSD",
    "OCEAN": "OCEANUSD",
}

# Kraken interval values (in minutes): 1, 5, 15, 30, 60, 240, 1440, 10080, 21600
KRAKEN_INTERVAL_DAILY = 1440

PORT = int(os.getenv("PORT", 8002))
