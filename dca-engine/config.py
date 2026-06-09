"""Configuration for DCA Engine."""
import os

DATA_PIPELINE_URL = os.getenv("DATA_PIPELINE_URL", "http://localhost:8004")

# DCA parameters (EXACT from original AQMath.html)
VOLATILITY_DAYS = 30
TREND_FILTER_DAYS = 50
SAFETY_FACTOR_MIN = 0.2
DCA_MAX_ITER = 1000  # max iterations for iterative DCA loop
SMALL_DCA_THRESHOLD = 50.0  # USD - below this, allocate to single best token (avoid fees)

PORT = int(os.getenv("PORT", 8006))
