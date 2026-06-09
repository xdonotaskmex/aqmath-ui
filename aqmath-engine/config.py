"""Configuration for AQMath Quantum Engine."""
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/crypto")

# Quantum Engine parameters (EXACT from original AQMath.html)
VOLATILITY_DAYS = 30
TREND_FILTER_DAYS = 50
MIN_HISTORY_DAYS = 120  # below this = insufficient history warning
OPTIMIZATION_MAX_ITER = 200
OPTIMIZATION_LEARNING_RATE = 0.05
KKT_PROJECTION_MAX_ITER = 30
MAX_ALLOC_CAP = 40.0  # percent
MIN_ALLOC_CAP = 10.0  # percent

# Cooldown: 6 hours between optimizations (in seconds)
OPTIMIZATION_COOLDOWN = 21600

PORT = int(os.getenv("PORT", 8005))
