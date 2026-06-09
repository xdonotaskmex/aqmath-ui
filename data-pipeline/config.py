"""Configuration for Data Pipeline."""
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/crypto")

# Cleaning parameters
OUTLIER_STD_THRESHOLD = 3.0  # standard deviations for outlier detection
ROLLING_WINDOW_DAYS = 7  # window for rolling mean/std
MAX_GAP_FILL_DAYS = 2  # max consecutive days to fill with interpolation
MIN_DATA_DAYS = 180  # minimum days for sufficient history (matches AQMath)
GAP_FLAG_THRESHOLD = 2  # flag gaps larger than this many days

PORT = int(os.getenv("PORT", 8004))
