"""Curated fund universe for the goal planner.

Each entry represents a real Indian mutual fund category with long-run
assumptions used by the planning + Monte Carlo engine:

    expected_return : annualised expected return (CAGR), as a decimal
    volatility      : annualised standard deviation of returns, as a decimal
    risk            : coarse risk bucket used for allocation
    asset_class     : equity | debt | hybrid | gold

These are planning assumptions, not guarantees. They are intentionally
conservative-to-moderate and broadly consistent with long-term category
averages for Indian mutual funds. Values live here as a fallback and can be
overridden by a `funds` table in Supabase (see schema.sql / seed_funds()).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Fund:
    code: str
    name: str
    category: str
    asset_class: str  # equity | debt | hybrid | gold
    risk: str  # low | moderate | high
    expected_return: float  # annualised, decimal
    volatility: float  # annualised, decimal
    expense_ratio: float  # decimal
    description: str

    def to_dict(self) -> dict:
        return asdict(self)


# --- Equity ---------------------------------------------------------------
FUND_UNIVERSE: list[Fund] = [
    Fund(
        code="EQ_INDEX_NIFTY50",
        name="Nifty 50 Index Fund",
        category="Large Cap Index",
        asset_class="equity",
        risk="high",
        expected_return=0.115,
        volatility=0.16,
        expense_ratio=0.002,
        description="Low-cost passive exposure to India's 50 largest companies. Core equity holding.",
    ),
    Fund(
        code="EQ_FLEXICAP",
        name="Flexi Cap Fund",
        category="Flexi Cap",
        asset_class="equity",
        risk="high",
        expected_return=0.125,
        volatility=0.18,
        expense_ratio=0.009,
        description="Actively managed across large, mid and small caps. Diversified growth engine.",
    ),
    Fund(
        code="EQ_MIDCAP",
        name="Mid Cap Fund",
        category="Mid Cap",
        asset_class="equity",
        risk="high",
        expected_return=0.135,
        volatility=0.22,
        expense_ratio=0.010,
        description="Higher growth potential from mid-sized companies, with higher swings.",
    ),
    Fund(
        code="EQ_ELSS",
        name="ELSS Tax Saver Fund",
        category="ELSS (Tax Saving)",
        asset_class="equity",
        risk="high",
        expected_return=0.125,
        volatility=0.18,
        expense_ratio=0.009,
        description="Equity fund with a 3-year lock-in and 80C tax benefit.",
    ),
    Fund(
        code="EQ_INTL",
        name="Global / US Equity Fund",
        category="International Equity",
        asset_class="equity",
        risk="high",
        expected_return=0.120,
        volatility=0.19,
        expense_ratio=0.011,
        description="Geographic diversification into developed-market equities.",
    ),
    # --- Hybrid -----------------------------------------------------------
    Fund(
        code="HY_BALANCED",
        name="Balanced Advantage Fund",
        category="Dynamic Asset Allocation",
        asset_class="hybrid",
        risk="moderate",
        expected_return=0.100,
        volatility=0.10,
        expense_ratio=0.008,
        description="Dynamically shifts between equity and debt to cushion volatility.",
    ),
    Fund(
        code="HY_AGGRESSIVE",
        name="Aggressive Hybrid Fund",
        category="Aggressive Hybrid",
        asset_class="hybrid",
        risk="moderate",
        expected_return=0.108,
        volatility=0.12,
        expense_ratio=0.009,
        description="~65-80% equity with a debt buffer. Growth with lower drawdowns than pure equity.",
    ),
    # --- Debt -------------------------------------------------------------
    Fund(
        code="DEBT_CORP_BOND",
        name="Corporate Bond Fund",
        category="Corporate Bond",
        asset_class="debt",
        risk="low",
        expected_return=0.072,
        volatility=0.03,
        expense_ratio=0.004,
        description="High-quality corporate debt. Stable returns, low volatility.",
    ),
    Fund(
        code="DEBT_SHORT",
        name="Short Duration Debt Fund",
        category="Short Duration",
        asset_class="debt",
        risk="low",
        expected_return=0.068,
        volatility=0.02,
        expense_ratio=0.003,
        description="Short-maturity bonds. Good for near-term goals and capital preservation.",
    ),
    Fund(
        code="DEBT_LIQUID",
        name="Liquid Fund",
        category="Liquid",
        asset_class="debt",
        risk="low",
        expected_return=0.062,
        volatility=0.008,
        expense_ratio=0.002,
        description="Cash-like, very low risk. For very short horizons and emergency buffers.",
    ),
    # --- Gold -------------------------------------------------------------
    Fund(
        code="GOLD_ETF",
        name="Gold Fund",
        category="Gold",
        asset_class="gold",
        risk="moderate",
        expected_return=0.085,
        volatility=0.14,
        expense_ratio=0.005,
        description="Inflation hedge and diversifier, low correlation with equity.",
    ),
]

FUND_BY_CODE: dict[str, Fund] = {f.code: f for f in FUND_UNIVERSE}
