"""DCA (Dollar Cost Averaging) Distribution Engine.

EXACT port of distribuirajDca() from AQMath.html.
Iterative proportional allocation with risk-adjusted delta weighting.
Removes tokens that reach target each round, redistributes remainder.

NO direct DB access - gets historical prices from data-pipeline via HTTP.
"""
import logging
import traceback
from typing import Optional

import httpx

from config import DCA_MAX_ITER, DATA_PIPELINE_URL, SMALL_DCA_THRESHOLD
from volatility import calculate_safety_factor, is_above_average

logger = logging.getLogger(__name__)


def _r2(n: float, d: int = 2) -> float:
    """Round to d decimal places."""
    factor = 10 ** d
    return round(n * factor) / factor


async def get_historical_prices(symbol: str, days: int = 180) -> Optional[list[float]]:
    """Fetch historical close prices from data-pipeline via HTTP. NO direct DB access."""
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


def calc_token_stats(token: dict, port_val: float) -> dict:
    """Calculate stats for a single token position.

    EXACT port of calcToken() from AQMath.html lines 749-771.
    """
    sym = token.get("symbol", "UNKNOWN")
    try:
        cur_val = token["amount"] * token["price"]
    except (KeyError, TypeError) as e:
        logger.error("[CALC] Bad token data for %s: missing amount or price. Token: %s", sym, token)
        raise

    if not isinstance(token.get("price"), (int, float)) or token["price"] <= 0:
        logger.warning("[CALC] Invalid price for %s: %s (using 0)", sym, token.get("price"))

    if not isinstance(token.get("target"), (int, float)):
        logger.warning("[CALC] Missing target%% for %s, defaulting to 0", sym)

    cur_pct = _r2((cur_val / port_val) * 100, 2) if port_val > 0 else 0
    tgt_val = (token["target"] / 100.0) * port_val
    drift = _r2(cur_pct - token["target"], 2)
    delta = tgt_val - cur_val

    action = "BUY" if (drift < -0.5 and delta > 0.01) else "HOLD"

    pnl = None
    if token.get("entry") and token["entry"] > 0 and token["price"] > 0:
        pnl = _r2(((token["price"] - token["entry"]) / token["entry"]) * 100, 2)

    avg_price = None
    avg_type = None
    cost_basis = token.get("costBasis", 0)
    total_tokens = token.get("totalTokens", 0)
    if cost_basis > 0 and total_tokens > 0:
        avg_price = cost_basis / total_tokens
        avg_type = "up" if token["price"] > avg_price else ("down" if token["price"] < avg_price else "flat")
    elif token.get("entry"):
        avg_price = token["entry"]
        avg_type = "up" if token["price"] >= token["entry"] else "down"

    apy = token.get("apy", 0) or 0
    yield_gap = apy - 10.0
    self_sustaining = apy >= 10.0

    return {
        "curVal": cur_val,
        "curPct": cur_pct,
        "drift": drift,
        "action": action,
        "pnl": pnl,
        "avgPrice": avg_price,
        "avgType": avg_type,
        "yieldGap": yield_gap,
        "selfSustaining": self_sustaining,
        "delta": delta,
    }


async def distribute_dca(
    positions: list[dict],
    dca_amount: float,
) -> dict:
    """Distribute DCA budget across underweight positions.

    EXACT port of distribuirajDca() from AQMath.html.
    Iterative while-loop: allocates proportionally per round,
    removes tokens that reach target, redistributes leftover.

    Args:
        positions: list of {symbol, amount, price, entry, apy, target, costBasis, totalTokens, frozen}
        dca_amount: total USD to distribute

    Returns:
        {"buy_summary": [...], "warnings": [...], "updated_positions": [...],
         "total_allocated": float, "remaining": float}
    """
    # Validate input
    if not positions:
        logger.error("[DCA] Empty positions list received")
        return {"buy_summary": [], "warnings": ["No positions provided."], "updated_positions": positions,
                "total_allocated": 0.0, "remaining": dca_amount}

    if dca_amount <= 0:
        logger.error("[DCA] Invalid dca_amount: %s", dca_amount)
        return {"buy_summary": [], "warnings": ["DCA amount must be > 0."], "updated_positions": positions,
                "total_allocated": 0.0, "remaining": dca_amount}

    logger.info("[DCA] Starting distribution: $%.2f across %d positions", dca_amount, len(positions))

    active = [p for p in positions if not p.get("frozen", False)]
    if not active:
        logger.warning("[DCA] All %d tokens are frozen, nothing to distribute to", len(positions))
        return {"buy_summary": [], "warnings": ["No active tokens."], "updated_positions": positions,
                "total_allocated": 0.0, "remaining": dca_amount}

    port_val = sum(p["amount"] * p["price"] for p in positions)
    if port_val <= 0:
        logger.error("[DCA] Portfolio value is zero or negative: $%.2f", port_val)
        return {"buy_summary": [], "warnings": ["Portfolio value is zero."], "updated_positions": positions,
                "total_allocated": 0.0, "remaining": dca_amount}

    logger.info("[DCA] Portfolio value: $%.2f, active tokens: %d", port_val, len(active))

    # Fetch historical prices from DB for risk calculations
    price_history = {}
    fetch_errors = []
    for t in active:
        sym = t.get("symbol", "")
        if sym:
            prices = await get_historical_prices(sym, days=180)
            if prices:
                price_history[sym] = prices
            else:
                fetch_errors.append(sym)
                logger.warning("[DCA] No history for %s, will use default safety_factor=1.0", sym)

    if fetch_errors:
        logger.warning("[DCA] Missing price history for %d tokens: %s", len(fetch_errors), fetch_errors)
    logger.info("[DCA] Price history loaded for %d/%d tokens", len(price_history), len(active))

    # Build eligible list with safety factors and trend filter
    # EXACT from JS: eligible = active.map(t => { ... }).filter(...)
    eligible = []
    for t in active:
        stats = calc_token_stats(t, port_val)
        prices = price_history.get(t.get("symbol", ""), [])
        safety_factor = 1.0
        skip_due_to_trend = False

        if prices and len(prices) >= 50:
            safety_factor = calculate_safety_factor(prices)
            if is_above_average(prices, 50):
                skip_due_to_trend = True

        if not stats["selfSustaining"] and stats["delta"] > 0.01 and not skip_due_to_trend:
            eligible.append({
                "token": t,
                "delta": stats["delta"],
                "safetyFactor": safety_factor,
                "skipDueToTrend": skip_due_to_trend,
                "selfSustaining": stats["selfSustaining"],
            })

    if not eligible:
        logger.info("[DCA] No eligible tokens after filtering (all self-sustaining/at target/above trend)")
        return {
            "buy_summary": [],
            "warnings": ["All positions are self-sustaining or above their average price. DCA not needed."],
            "updated_positions": positions,
            "total_allocated": 0.0,
            "remaining": dca_amount,
        }

    logger.info("[DCA] %d eligible tokens after filtering: %s",
                len(eligible), [e["token"].get("symbol", "?") for e in eligible])

    # Initialize remainingDelta for each token (how much more deficit it can absorb)
    # EXACT from JS: eligible.forEach(item => item.remainingDelta = item.delta)
    for item in eligible:
        item["remainingDelta"] = item["delta"]

    buy_summary = []
    warnings = []
    total_allocated = 0.0

    # ---- Small DCA: single-token allocation to avoid fee waste ----
    # When budget is below threshold, put everything into the best
    # (most underweight by adjusted delta) token only.
    if dca_amount < SMALL_DCA_THRESHOLD:
        logger.info("[DCA] Small amount $%.2f < $%.0f threshold, single-token allocation", dca_amount, SMALL_DCA_THRESHOLD)
        eligible.sort(
            key=lambda e: e["remainingDelta"] * e["safetyFactor"], reverse=True
        )
        best = eligible[0]
        cur = best["token"]
        price = cur.get("price", 0) or 0

        if price <= 0:
            return {
                "buy_summary": [],
                "warnings": [f"Price for {cur['symbol']} not available."],
                "updated_positions": positions,
                "total_allocated": 0.0,
                "remaining": dca_amount,
            }

        tokens_to_buy = dca_amount / price
        old_amount = cur["amount"]
        cur["amount"] += tokens_to_buy

        cost_basis = cur.get("costBasis", 0) or 0
        total_tokens = cur.get("totalTokens", 0) or 0
        entry = cur.get("entry", 0) or 0

        if cost_basis > 0 and total_tokens > 0:
            cur["costBasis"] += dca_amount
            cur["totalTokens"] += tokens_to_buy
        elif entry > 0:
            cur["costBasis"] = (old_amount * entry) + dca_amount
            cur["totalTokens"] = cur["amount"]

        best_sym = cur.get("symbol", "?")
        buy_summary.append(
            f"{cur['symbol']}: +${dca_amount:.2f} (single-token, below ${SMALL_DCA_THRESHOLD:.0f} threshold)"
        )
        logger.info("[DCA] Small DCA: $%.2f -> %s @ $%.6f", dca_amount, best_sym, price)
        total_allocated = dca_amount
        dca_amount = 0.0

        return {
            "buy_summary": buy_summary,
            "warnings": warnings,
            "updated_positions": positions,
            "total_allocated": total_allocated,
            "remaining": dca_amount,
        }

    # ---- Iterative allocation loop (for amounts >= threshold) ----
    logger.info("[DCA] Iterative allocation starting: $%.2f across %d tokens", dca_amount, len(eligible))
    iter_count = 0

    # EXACT from JS: while (dcaAmount > 0.01 && eligible.length > 0 && iter < MAX_ITER)
    while dca_amount > 0.01 and eligible and iter_count < DCA_MAX_ITER:
        # Total weighted deficit this round
        total_adjusted_delta = sum(
            e["remainingDelta"] * e["safetyFactor"] for e in eligible
        )
        if total_adjusted_delta <= 0:
            break

        allocated_this_round = 0.0
        for item in eligible:
            if dca_amount <= 0.01:
                break

            cur = item["token"]
            price = cur.get("price", 0) or 0
            if price <= 0:
                warnings.append(f"\u26a0\ufe0f {cur['symbol']}: price unavailable.")
                continue

            # Max this token can receive (capped by its remaining deficit and budget)
            max_for_token = min(item["remainingDelta"], dca_amount)
            if max_for_token <= 0:
                continue

            # Proportional share based on weighted delta
            proportional = dca_amount * (item["remainingDelta"] * item["safetyFactor"]) / total_adjusted_delta
            alloc = min(max_for_token, proportional)
            if alloc <= 0.001:
                continue

            # Buy tokens
            tokens_to_buy = alloc / price
            old_amount = cur["amount"]
            cur["amount"] += tokens_to_buy

            # Update costBasis / totalTokens
            cost_basis = cur.get("costBasis", 0) or 0
            total_tokens = cur.get("totalTokens", 0) or 0
            entry = cur.get("entry", 0) or 0

            if cost_basis > 0 and total_tokens > 0:
                cur["costBasis"] += alloc
                cur["totalTokens"] += tokens_to_buy
            elif entry > 0:
                cur["costBasis"] = (old_amount * entry) + alloc
                cur["totalTokens"] = cur["amount"]

            # Average cost warning
            new_avg_price = None
            cb = cur.get("costBasis", 0) or 0
            tt = cur.get("totalTokens", 0) or 0
            if cb > 0 and tt > 0:
                new_avg_price = cb / tt
            elif entry > 0:
                new_avg_price = entry

            if new_avg_price and new_avg_price > (cb / tt if cb > 0 and tt > 0 else entry):
                warnings.append(f"\u26a0\ufe0f {cur['symbol']}: DCA would raise average cost.")

            # Reduce remaining delta and budget
            item["remainingDelta"] -= alloc
            dca_amount -= alloc
            total_allocated += alloc
            allocated_this_round += alloc

            buy_summary.append(f"{cur['symbol']}: +${alloc:.2f} ({tokens_to_buy:.6f} tokens)")

        # Remove tokens that reached target (remainingDelta <= 0.01)
        before_count = len(eligible)
        eligible = [e for e in eligible if e["remainingDelta"] > 0.01]
        removed = before_count - len(eligible)
        if removed > 0:
            logger.debug("[DCA] Iter %d: removed %d fulfilled tokens, %d remaining, $%.2f left",
                         iter_count + 1, removed, len(eligible), dca_amount)

        iter_count += 1

    if iter_count >= DCA_MAX_ITER:
        logger.error("[DCA] Hit MAX_ITER (%d) with $%.2f still unallocated", DCA_MAX_ITER, dca_amount)
    else:
        logger.info("[DCA] Iterative loop finished in %d iterations, $%.2f allocated, $%.4f remaining",
                    iter_count, total_allocated, dca_amount)

    # ---- Remainder: leftover < 0.01 goes to best token ----
    # EXACT from JS: if (dcaAmount > 0.001 && eligible.length > 0)
    if dca_amount > 0.001 and eligible:
        eligible.sort(key=lambda e: e["remainingDelta"], reverse=True)
        best = eligible[0]
        cur = best["token"]
        price = cur.get("price", 0) or 0
        if price > 0:
            tokens_to_buy = dca_amount / price
            cur["amount"] += tokens_to_buy

            cost_basis = cur.get("costBasis", 0) or 0
            total_tokens = cur.get("totalTokens", 0) or 0
            entry = cur.get("entry", 0) or 0

            if cost_basis > 0 and total_tokens > 0:
                cur["costBasis"] += dca_amount
                cur["totalTokens"] += tokens_to_buy
            elif entry > 0:
                cur["costBasis"] = (cur["amount"] * entry) + dca_amount
                cur["totalTokens"] = cur["amount"]

            buy_summary.append(f"{cur['symbol']}: +${dca_amount:.2f} (remainder)")
            total_allocated += dca_amount
            dca_amount = 0.0

    logger.info("[DCA] Distribution complete: $%.2f allocated, $%.4f remaining, %d buys",
                total_allocated, dca_amount, len(buy_summary))

    return {
        "buy_summary": buy_summary,
        "warnings": warnings,
        "updated_positions": positions,
        "total_allocated": total_allocated,
        "remaining": dca_amount,
    }
