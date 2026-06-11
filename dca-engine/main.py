"""DCA Engine - FastAPI application.

Serves the DCA (Dollar Cost Averaging) distribution logic via REST API.
Gets historical data from data-pipeline via HTTP (NO direct DB access).
"""
import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import PORT
from dca import distribute_dca

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    logger.info("DCA Engine started. No DB access - uses data-pipeline for price history.")
    yield


app = FastAPI(
    title="DCA Engine",
    description="DCA distribution API with risk-adjusted delta weighting. Gets prices from data-pipeline.",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow CORS from any origin (for local HTML UI)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DcaRequest(BaseModel):
    positions: list[dict]  # {symbol, amount, price, entry, apy, target, costBasis, totalTokens, frozen}
    dca_amount: float


@app.get("/")
async def root():
    return {"service": "dca-engine", "status": "running", "data_source": "data-pipeline"}


@app.post("/dca")
async def dca(req: DcaRequest):
    """Distribute DCA budget across underweight positions.

    Takes current positions + budget, reads risk data from DB, distributes optimally.
    Uses safety factors and 50-day trend filter (EXACT from AQMath.html).
    """
    logger.info("[API] POST /dca: %d positions, $%.2f budget", len(req.positions), req.dca_amount)

    if req.dca_amount <= 0:
        logger.warning("[API] Rejected DCA request: amount $%.2f <= 0", req.dca_amount)
        return {"error": "DCA amount must be > 0."}

    if not req.positions:
        logger.warning("[API] Rejected DCA request: empty positions list")
        return {"error": "No positions provided."}

    try:
        result = await distribute_dca(req.positions, req.dca_amount)
        total = result.get("total_allocated", 0)
        remaining = result.get("remaining", 0)
        buys = len(result.get("buy_summary", []))
        warns = len(result.get("warnings", []))
        logger.info("[API] DCA complete: $%.2f allocated, $%.4f remaining, %d buys, %d warnings",
                    total, remaining, buys, warns)
        return result
    except Exception as e:
        logger.error("[API] DCA distribution failed: %s\n%s", e, traceback.format_exc())
        return {"error": f"Internal error during DCA distribution: {str(e)}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
