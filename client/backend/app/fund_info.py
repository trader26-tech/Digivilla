"""Beginner-friendly fund explainers + category-based composition.

We cannot show real per-fund stock holdings (those need a paid data license and
AMFI/mfapi don't provide them). Instead we describe, for each category, the
*typical composition* — asset-type split and market-cap / sector tilt — and a
plain-language explanation of what the fund does and who it suits. This is
labelled clearly in the UI as category-typical, not live holdings.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CompositionSlice(BaseModel):
    label: str
    weight: float  # 0..100
    kind: str  # equity | debt | cash | gold


class FundInfo(BaseModel):
    summary: str  # one-liner: what it is
    invests_in: str  # where the money goes
    who_for: str  # who it suits
    risk_label: str  # Very low | Low | Moderate | High | Very high
    composition: list[CompositionSlice]
    cap_tilt: Optional[list[CompositionSlice]] = None  # large/mid/small for equity


# Composition templates by bucket. Weights are indicative category averages.
_EQUITY = [CompositionSlice(label="Equity", weight=95, kind="equity"), CompositionSlice(label="Cash", weight=5, kind="cash")]


def _caps(large: float, mid: float, small: float) -> list[CompositionSlice]:
    return [
        CompositionSlice(label="Large cap", weight=large, kind="equity"),
        CompositionSlice(label="Mid cap", weight=mid, kind="equity"),
        CompositionSlice(label="Small cap", weight=small, kind="equity"),
    ]


_BUCKET_INFO: dict[str, dict] = {
    "Large Cap": {
        "summary": "Invests in India's biggest, most established companies.",
        "invests_in": "Blue-chip large-cap stocks — the top 100 companies by size (think market leaders across banking, IT, energy).",
        "who_for": "Beginners and anyone wanting steady equity growth with lower swings than mid/small caps.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(85, 12, 3),
    },
    "Large & Mid Cap": {
        "summary": "A blend of large stable companies and faster-growing mid-caps.",
        "invests_in": "A mandated mix of large-cap leaders and mid-cap growth companies.",
        "who_for": "Investors wanting more growth than pure large-cap, accepting a bit more volatility.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(55, 40, 5),
    },
    "Mid Cap": {
        "summary": "Invests in medium-sized companies with high growth potential.",
        "invests_in": "Mid-cap stocks (roughly the 101st–250th largest companies) that are scaling up.",
        "who_for": "Long-horizon investors comfortable with bigger ups and downs for higher potential.",
        "risk_label": "Very high",
        "composition": _EQUITY,
        "cap_tilt": _caps(15, 75, 10),
    },
    "Small Cap": {
        "summary": "Invests in small, emerging companies — highest growth, highest risk.",
        "invests_in": "Small-cap stocks (below the top 250) that can grow fast but fall hard.",
        "who_for": "Aggressive investors with a long horizon who can stomach sharp drawdowns.",
        "risk_label": "Very high",
        "composition": _EQUITY,
        "cap_tilt": _caps(5, 20, 75),
    },
    "Flexi Cap": {
        "summary": "Invests across large, mid and small companies — the manager decides the mix.",
        "invests_in": "A flexible blend of stocks of any size, shifted as opportunities change.",
        "who_for": "Investors who want one diversified equity fund and trust the manager to allocate.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(60, 25, 15),
    },
    "Multi Cap": {
        "summary": "Holds large, mid and small caps with a mandated minimum in each.",
        "invests_in": "At least 25% each in large, mid and small caps — diversified by rule.",
        "who_for": "Investors wanting guaranteed exposure across company sizes.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(45, 30, 25),
    },
    "Focused": {
        "summary": "Holds a concentrated set of high-conviction stocks (usually ≤30).",
        "invests_in": "A tight portfolio of the manager's best ideas across market caps.",
        "who_for": "Investors comfortable with concentration risk for potential outperformance.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(60, 25, 15),
    },
    "Value / Contra": {
        "summary": "Buys undervalued or out-of-favour stocks expecting them to recover.",
        "invests_in": "Cheap, beaten-down companies the market has overlooked.",
        "who_for": "Patient investors who believe in value investing over full cycles.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(65, 25, 10),
    },
    "ELSS": {
        "summary": "A tax-saving equity fund with a 3-year lock-in (Section 80C).",
        "invests_in": "A diversified equity portfolio, similar to a flexi/multi-cap fund.",
        "who_for": "Taxpayers wanting 80C deductions plus long-term equity growth.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(60, 25, 15),
    },
    "Sectoral / Thematic": {
        "summary": "Bets on a single sector or theme (e.g. banking, tech, infrastructure).",
        "invests_in": "Concentrated exposure to one industry or theme — no diversification across sectors.",
        "who_for": "Experienced investors with a specific view; not a core holding.",
        "risk_label": "Very high",
        "composition": _EQUITY,
        "cap_tilt": _caps(60, 30, 10),
    },
    "Index / ETF": {
        "summary": "Passively tracks an index (like the Nifty 50) at very low cost.",
        "invests_in": "The same stocks as its benchmark index, in the same proportions.",
        "who_for": "Cost-conscious investors who want market returns without manager risk.",
        "risk_label": "High",
        "composition": _EQUITY,
        "cap_tilt": _caps(80, 15, 5),
    },
    "Aggressive Hybrid": {
        "summary": "Mostly equity (65–80%) with a debt cushion to soften falls.",
        "invests_in": "A majority in stocks plus bonds for stability.",
        "who_for": "Investors wanting equity-like growth with lower drawdowns than pure equity.",
        "risk_label": "Moderate",
        "composition": [
            CompositionSlice(label="Equity", weight=72, kind="equity"),
            CompositionSlice(label="Debt", weight=25, kind="debt"),
            CompositionSlice(label="Cash", weight=3, kind="cash"),
        ],
    },
    "Balanced Advantage": {
        "summary": "Dynamically shifts between equity and debt based on market valuations.",
        "invests_in": "Equity when markets are cheap, more debt when expensive — automatically.",
        "who_for": "Conservative-to-moderate investors wanting a smoother ride.",
        "risk_label": "Moderate",
        "composition": [
            CompositionSlice(label="Equity", weight=55, kind="equity"),
            CompositionSlice(label="Debt", weight=42, kind="debt"),
            CompositionSlice(label="Cash", weight=3, kind="cash"),
        ],
    },
    "Conservative Hybrid": {
        "summary": "Mostly debt (75–90%) with a small equity kicker.",
        "invests_in": "Bonds for stability plus a slice of stocks for extra return.",
        "who_for": "Cautious investors and retirees wanting income with a little growth.",
        "risk_label": "Low",
        "composition": [
            CompositionSlice(label="Debt", weight=80, kind="debt"),
            CompositionSlice(label="Equity", weight=18, kind="equity"),
            CompositionSlice(label="Cash", weight=2, kind="cash"),
        ],
    },
    "Multi Asset": {
        "summary": "Spreads money across equity, debt and gold in one fund.",
        "invests_in": "A mix of stocks, bonds and gold for all-weather diversification.",
        "who_for": "Investors wanting built-in diversification across asset classes.",
        "risk_label": "Moderate",
        "composition": [
            CompositionSlice(label="Equity", weight=50, kind="equity"),
            CompositionSlice(label="Debt", weight=35, kind="debt"),
            CompositionSlice(label="Gold", weight=15, kind="gold"),
        ],
    },
    "Corporate Bond": {
        "summary": "Lends to high-quality companies for steady interest income.",
        "invests_in": "AA+/AAA-rated corporate bonds — stable, low volatility.",
        "who_for": "Investors wanting better-than-FD returns with low risk.",
        "risk_label": "Low",
        "composition": [CompositionSlice(label="Debt", weight=97, kind="debt"), CompositionSlice(label="Cash", weight=3, kind="cash")],
    },
    "Short / Low Duration": {
        "summary": "Holds short-maturity bonds — low risk, good for 1–3 year needs.",
        "invests_in": "Bonds maturing soon, so interest-rate swings have little impact.",
        "who_for": "Investors parking money for the short-to-medium term.",
        "risk_label": "Low",
        "composition": [CompositionSlice(label="Debt", weight=96, kind="debt"), CompositionSlice(label="Cash", weight=4, kind="cash")],
    },
    "Gilt": {
        "summary": "Invests only in government bonds — no credit risk.",
        "invests_in": "Sovereign (government) securities; sensitive to interest rates.",
        "who_for": "Safety-first investors comfortable with some rate-driven ups and downs.",
        "risk_label": "Low",
        "composition": [CompositionSlice(label="Govt debt", weight=98, kind="debt"), CompositionSlice(label="Cash", weight=2, kind="cash")],
    },
    "Liquid / Overnight": {
        "summary": "Parks cash safely for days to weeks — near-zero risk.",
        "invests_in": "Very short-term instruments; used like a savings alternative.",
        "who_for": "Emergency funds and money you may need any day.",
        "risk_label": "Very low",
        "composition": [CompositionSlice(label="Money market", weight=100, kind="cash")],
    },
    "Gold": {
        "summary": "Tracks the price of gold — an inflation hedge and diversifier.",
        "invests_in": "Physical gold (via ETFs) or gold-linked instruments.",
        "who_for": "Investors wanting a hedge that often rises when equities fall.",
        "risk_label": "Moderate",
        "composition": [CompositionSlice(label="Gold", weight=100, kind="gold")],
    },
}

_DEFAULT = {
    "summary": "A diversified mutual fund.",
    "invests_in": "A mix of securities according to its mandate.",
    "who_for": "Investors matching its risk profile.",
    "risk_label": "Moderate",
    "composition": _EQUITY,
}


def get_fund_info(bucket: str) -> FundInfo:
    data = _BUCKET_INFO.get(bucket, _DEFAULT)
    return FundInfo(**data)
