"""Volatility and trend helpers for DCA Engine.

EXACT port of AQMath.html lines 1011-1042:
- calculateVolatility (lines 1011-1022)
- isAboveAverage (lines 1032-1037)
- calculateSafetyFactor (lines 1039-1042)
"""
import logging
import math

from config import SAFETY_FACTOR_MIN, VOLATILITY_DAYS

logger = logging.getLogger(__name__)


def calculate_volatility(prices: list[float], days: int = VOLATILITY_DAYS) -> float:
    """Calculate volatility as std dev of log returns.

    EXACT port of calculateVolatility() from AQMath.html lines 1011-1022.
    """
    if not prices:
        logger.warning("[VOL] Empty price list, returning 0.0 volatility")
        return 0.0

    subset = prices[-days:] if len(prices) > days else prices[:]
    if len(subset) < 2:
        logger.warning("[VOL] Only %d price point(s), cannot compute volatility", len(subset))
        return 0.0

    returns = []
    for i in range(1, len(subset)):
        if subset[i] > 0 and subset[i - 1] > 0:
            returns.append(math.log(subset[i] / subset[i - 1]))

    if not returns:
        return 0.0

    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / len(returns)
    return math.sqrt(variance)


def is_above_average(prices: list[float], days: int = 50) -> bool:
    """Check if latest price is above its N-day moving average.

    EXACT port of isAboveAverage() from AQMath.html lines 1032-1037.
    """
    if not prices or len(prices) < 2:
        logger.debug("[TREND] Insufficient price data (%d points) for trend check", len(prices) if prices else 0)
        return False

    subset = prices[-days:] if len(prices) > days else prices[:]
    avg = sum(subset) / len(subset)
    return prices[-1] > avg


def calculate_safety_factor(prices: list[float]) -> float:
    """Calculate risk safety factor based on 30-day volatility.

    EXACT port of calculateSafetyFactor() from AQMath.html lines 1039-1042.
    """
    vol = calculate_volatility(prices, 30)
    factor = max(SAFETY_FACTOR_MIN, 1.0 - (vol * 5.0))
    if factor <= SAFETY_FACTOR_MIN:
        logger.debug("[VOL] Safety factor clamped to min %.2f (volatility=%.4f)", SAFETY_FACTOR_MIN, vol)
    return factor
