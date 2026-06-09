"""KKT Risk Parity Optimization via Projected Gradient Descent.

EXACT port of the Advanced KKT Risk Parity optimization from AQMath.html
lines 1353-1465 (the optimizePortfolio function's core math).

The algorithm:
1. Compute log returns for each asset
2. Build covariance matrix
3. Projected gradient descent to equalize risk contributions
4. KKT projection to enforce allocation sum and per-asset caps
"""
import math
import logging

logger = logging.getLogger(__name__)

from config import (
    KKT_PROJECTION_MAX_ITER,
    MAX_ALLOC_CAP,
    MIN_ALLOC_CAP,
    OPTIMIZATION_LEARNING_RATE,
    OPTIMIZATION_MAX_ITER,
)
from volatility import calculate_max_target, calculate_volatility


def compute_log_returns(prices: list[float]) -> list[float]:
    """Compute log returns from price series.

    EXACT port of the returns calculation from AQMath.html lines 1353-1360:
        const returns = historicalData.map(item => {
            const p = item.prices;
            const logReturns = [];
            for (let i = 1; i < p.length; i++) {
                if (p[i] > 0 && p[i-1] > 0) logReturns.push(Math.log(p[i] / p[i-1]));
            }
            return { token: item.token, returns: logReturns };
        }).filter(r => r.returns.length > 0);
    """
    returns = []
    for i in range(1, len(prices)):
        if prices[i] > 0 and prices[i - 1] > 0:
            returns.append(math.log(prices[i] / prices[i - 1]))
    return returns


def compute_covariance_matrix(all_returns: list[list[float]]) -> list[list[float]]:
    """Compute sample covariance matrix from aligned returns.

    EXACT port from AQMath.html lines 1380-1391:
        const cov = Array(n).fill().map(() => Array(n).fill(0));
        const meanReturns = returns.map(r => r.returns.reduce((a,b)=>a+b,0) / T);
        for (let i = 0; i < n; i++) {
            for (let j = i; j < n; j++) {
                let sum = 0;
                for (let t = 0; t < T; t++) {
                    sum += (returns[i].returns[t] - meanReturns[i])
                         * (returns[j].returns[t] - meanReturns[j]);
                }
                cov[i][j] = sum / (T - 1);
                cov[j][i] = cov[i][j];
            }
        }
    """
    n = len(all_returns)
    T = len(all_returns[0])

    if T < 2:
        logger.warning("[RISK] Covariance: only %d data points, division by (T-1) will be unstable", T)

    mean_returns = [sum(r) / T for r in all_returns]

    cov = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i, n):
            s = 0.0
            for t in range(T):
                s += (all_returns[i][t] - mean_returns[i]) * (all_returns[j][t] - mean_returns[j])
            cov[i][j] = s / (T - 1)
            cov[j][i] = cov[i][j]

    return cov


def risk_parity_optimize(
    price_data: list[dict],
    effective_remaining_alloc: float,
) -> dict:
    """Run the full KKT Risk Parity optimization.

    Args:
        price_data: list of {"symbol": str, "prices": list[float]}
        effective_remaining_alloc: total allocation % available for optimization

    Returns:
        dict with "weights" (list of % per symbol), "warnings" (list of str)

    EXACT port from AQMath.html lines 1393-1484.
    """
    n = len(price_data)
    warnings = []

    # ---- Step 1: Compute log returns ----
    returns_data = []
    for item in price_data:
        log_rets = compute_log_returns(item["prices"])
        if log_rets:
            returns_data.append({"symbol": item["symbol"], "returns": log_rets})

    if len(returns_data) < 2:
        return {"weights": [], "warnings": ["Insufficient data for covariance calculation."]}

    # ---- Step 2: Align returns to same length ----
    min_len = min(len(r["returns"]) for r in returns_data)
    if min_len < 2:
        return {"weights": [], "warnings": ["Insufficient overlapping data points."]}

    for r in returns_data:
        r["returns"] = r["returns"][-min_len:]  # keep last min_len

    T = min_len
    n = len(returns_data)
    aligned_returns = [r["returns"] for r in returns_data]

    # ---- Step 3: Covariance matrix ----
    try:
        cov = compute_covariance_matrix(aligned_returns)
    except (ZeroDivisionError, ValueError) as e:
        logger.error("[RISK] Covariance computation failed: %s", e)
        return {"weights": [], "warnings": [f"Covariance computation failed: {e}"]}

    # ---- Step 4: Dynamic volatility caps ----
    # EXACT from lines 1393-1404
    max_vol_in_portfolio = 0.0
    for item in price_data:
        if len(item["prices"]) >= 30:
            v = calculate_volatility(item["prices"], 30)
            if v > max_vol_in_portfolio:
                max_vol_in_portfolio = v

    # Match symbols to price_data
    symbol_prices = {item["symbol"]: item["prices"] for item in price_data}
    max_caps = []
    for r in returns_data:
        prices = symbol_prices.get(r["symbol"], [])
        if len(prices) >= 30:
            max_caps.append(calculate_max_target(prices, max_vol_in_portfolio))
        else:
            max_caps.append(25.0)

    # ---- Step 5: KKT Projected Gradient Descent ----
    # EXACT from lines 1406-1465
    target_total_alloc = effective_remaining_alloc / 100.0
    weights = [target_total_alloc / n] * n

    for iteration in range(OPTIMIZATION_MAX_ITER):
        # Portfolio variance
        port_var = 0.0
        for i in range(n):
            for j in range(n):
                port_var += weights[i] * weights[j] * cov[i][j]

        port_vol = math.sqrt(port_var) if port_var > 0 else 1e-10

        # Marginal risk contribution and risk contribution
        mrc = [0.0] * n
        rc = [0.0] * n
        for i in range(n):
            sum_cov = 0.0
            for j in range(n):
                sum_cov += weights[j] * cov[i][j]
            mrc[i] = sum_cov / port_vol
            rc[i] = weights[i] * mrc[i]

        target_rc = port_var / n

        # Gradient step
        next_weights = [
            weights[i] - (rc[i] - target_rc) * OPTIMIZATION_LEARNING_RATE
            for i in range(n)
        ]

        # KKT projection (lines 1434-1463)
        alloc_converged = False
        p_iter = 0
        while not alloc_converged and p_iter < KKT_PROJECTION_MAX_ITER:
            alloc_converged = True
            total_current = sum(next_weights)
            diff = target_total_alloc - total_current

            free_indices = []
            for i in range(n):
                cap = max_caps[i] / 100.0
                if next_weights[i] > 0 and next_weights[i] < cap:
                    free_indices.append(i)

            if abs(diff) > 1e-6 and free_indices:
                adjustment = diff / len(free_indices)
                for idx in free_indices:
                    next_weights[idx] += adjustment

            for i in range(n):
                cap = max_caps[i] / 100.0
                if next_weights[i] < 0:
                    next_weights[i] = 0.0
                    alloc_converged = False
                elif next_weights[i] > cap:
                    next_weights[i] = cap
                    alloc_converged = False

            p_iter += 1

        weights = list(next_weights)

    # Convert to percentages (EXACT: r2(w * 100, 2))
    final_weights = [round(w * 100 * 100) / 100.0 for w in weights]

    total_alloc = sum(max(0.0, w) for w in final_weights)
    logger.info("[RISK] Optimization result: %d assets, total allocation=%.2f%%", n, total_alloc * 100)

    result = {}
    for i, r in enumerate(returns_data):
        result[r["symbol"]] = max(0.0, final_weights[i])

    return {
        "weights": result,
        "max_caps": {r["symbol"]: max_caps[i] for i, r in enumerate(returns_data)},
        "warnings": warnings,
    }
