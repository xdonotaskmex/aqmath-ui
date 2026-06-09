"""Data validation rules for crypto price data."""
import logging
from datetime import date, timedelta
from typing import Optional

from config import GAP_FLAG_THRESHOLD, MIN_DATA_DAYS

logger = logging.getLogger(__name__)


class ValidationResult:
    """Result of validating a symbol's price data."""

    def __init__(self, symbol: str):
        self.symbol = symbol
        self.is_valid = True
        self.warnings: list[str] = []
        self.errors: list[str] = []
        self.days_count = 0
        self.has_sufficient_history = True
        self.gaps: list[tuple[date, date]] = []

    def add_warning(self, msg: str):
        self.warnings.append(msg)

    def add_error(self, msg: str):
        self.errors.append(msg)
        self.is_valid = False

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "is_valid": self.is_valid,
            "has_sufficient_history": self.has_sufficient_history,
            "days_count": self.days_count,
            "gaps": [(str(g[0]), str(g[1])) for g in self.gaps],
            "warnings": self.warnings,
            "errors": self.errors,
        }


def validate_prices(symbol: str, prices: list[dict]) -> ValidationResult:
    """Validate a list of price records for a symbol.

    Each price dict should have: date, close_price, open_price, volume, source.

    Returns a ValidationResult with any issues found.
    """
    result = ValidationResult(symbol)

    if not prices:
        result.add_error("No price data available")
        return result

    result.days_count = len(prices)

    # Check data sufficiency (180 days minimum, matching AQMath)
    if result.days_count < MIN_DATA_DAYS:
        result.has_sufficient_history = False
        result.add_warning(
            f"Only {result.days_count} days of data (minimum {MIN_DATA_DAYS} required). "
            f"Quantum Engine results may be unreliable."
        )

    # Check for date gaps
    sorted_prices = sorted(prices, key=lambda x: x["date"])
    for i in range(1, len(sorted_prices)):
        prev_date = sorted_prices[i - 1]["date"]
        curr_date = sorted_prices[i]["date"]
        gap_days = (curr_date - prev_date).days

        if gap_days > GAP_FLAG_THRESHOLD:
            gap_start = prev_date + timedelta(days=1)
            gap_end = curr_date - timedelta(days=1)
            result.gaps.append((gap_start, gap_end))
            result.add_warning(
                f"Gap of {gap_days - 1} days: {gap_start} to {gap_end}"
            )

    # Check for zero or negative prices
    for p in prices:
        if p["close_price"] <= 0:
            result.add_error(f"Non-positive close price on {p['date']}: {p['close_price']}")
        if p.get("open_price") is not None and p["open_price"] <= 0:
            result.add_warning(f"Non-positive open price on {p['date']}: {p['open_price']}")

    # Check for duplicate dates
    seen_dates = set()
    for p in prices:
        d = p["date"]
        if d in seen_dates:
            result.add_warning(f"Duplicate date entry: {d}")
        seen_dates.add(d)

    # Check for extreme price jumps (>50% daily change)
    for i in range(1, len(sorted_prices)):
        prev_price = sorted_prices[i - 1]["close_price"]
        curr_price = sorted_prices[i]["close_price"]
        if prev_price > 0:
            change_pct = abs(curr_price - prev_price) / prev_price
            if change_pct > 0.5:
                result.add_warning(
                    f"Extreme price change on {sorted_prices[i]['date']}: "
                    f"{change_pct:.1%} (${prev_price:.4f} -> ${curr_price:.4f})"
                )

    return result


def validate_raw_record(record: dict) -> tuple[bool, Optional[str]]:
    """Validate a single raw record from any collector.

    Returns (is_valid, error_message).
    """
    if not record.get("symbol"):
        return False, "Missing symbol"
    if not record.get("timestamp"):
        return False, "Missing timestamp"
    if record.get("price") is None or record["price"] <= 0:
        return False, f"Invalid price: {record.get('price')}"
    return True, None
