"""Volatility and trend calculations for Risk Parity optimization.

EXACT port of the JavaScript math from AQMath.html:
- calculateVolatility (lines 1011-1022)
- calculateMaxTarget (lines 1024-1030)
"""
import math

from config import (
    MAX_ALLOC_CAP,
    MIN_ALLOC_CAP,
    VOLATILITY_DAYS,
)


def calculate_volatility(prices: list[float], days: int = VOLATILITY_DAYS) -> float:
    """Calculate volatility as the standard deviation of log returns.

    EXACT port of calculateVolatility() from AQMath.html lines 1011-1022:
        function calculateVolatility(prices, days = 30) {
            const subset = prices.slice(-days);
            if (subset.length < 2) return 0;
            const returns = [];
            for (let i = 1; i < subset.length; i++) {
                if (subset[i] > 0 && subset[i - 1] > 0)
                    returns.push(Math.log(subset[i] / subset[i - 1]));
            }
            if (returns.length === 0) return 0;
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
            return Math.sqrt(variance);
        }
    """
    subset = prices[-days:] if len(prices) > days else prices[:]

    if len(subset) < 2:
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


def calculate_max_target(
    prices: list[float],
    max_vol_in_portfolio: float,
    max_cap: float = MAX_ALLOC_CAP,
    min_cap: float = MIN_ALLOC_CAP,
) -> float:
    """Calculate dynamic volatility-adjusted allocation cap.

    EXACT port of calculateMaxTarget() from AQMath.html lines 1024-1030:
        function calculateMaxTarget(prices, maxVolInPortfolio, maxCap = 40, minCap = 10) {
            if (!prices || prices.length < 30) return (maxCap + minCap) / 2;
            const vol = calculateVolatility(prices, 30);
            if (maxVolInPortfolio === 0) return maxCap;
            const cap = maxCap - ((vol / maxVolInPortfolio) * (maxCap - minCap));
            return Math.max(minCap, Math.min(maxCap, Math.round(cap * 10) / 10));
        }
    """
    if not prices or len(prices) < 30:
        return (max_cap + min_cap) / 2.0

    vol = calculate_volatility(prices, 30)

    if max_vol_in_portfolio == 0:
        return max_cap

    cap = max_cap - ((vol / max_vol_in_portfolio) * (max_cap - min_cap))
    # Round to 1 decimal, clamp to [min_cap, max_cap]
    rounded = round(cap * 10) / 10.0
    return max(min_cap, min(max_cap, rounded))
