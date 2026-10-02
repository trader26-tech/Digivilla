// GENERATED from client/backend/app/data/calc_config.json by scripts/calc_config.py —
// do not edit by hand. Only used until the live settings (GET /calc/config) arrive,
// and the last live copy is remembered on the device, so this is a cold-start fallback.
import { CalcConfig } from './types';

export const DEFAULT_CONFIG: CalcConfig = {
  "version": 1,
  "updated_at": "2026-10-02T00:00:00+05:30",
  "updated_by": "repo default",
  "note": "Today's values. The live copy is calc-data/calc_config.json in Supabase Storage; this file is the fallback.",
  "villas": [
    {
      "key": "conservative",
      "name": "Conservative",
      "risk": 1,
      "risk_name": "Low",
      "weights": {
        "arbitrage": 0.7,
        "gold": 0.075,
        "large": 0.075,
        "mid": 0.075,
        "small": 0.075
      }
    },
    {
      "key": "balanced",
      "name": "Balanced",
      "risk": 2,
      "risk_name": "Medium",
      "weights": {
        "arbitrage": 0.36,
        "gold": 0.16,
        "large": 0.16,
        "mid": 0.16,
        "small": 0.16
      }
    },
    {
      "key": "aggressive",
      "name": "Aggressive",
      "risk": 3,
      "risk_name": "High",
      "weights": {
        "arbitrage": 0.2,
        "gold": 0.2,
        "large": 0.2,
        "mid": 0.2,
        "small": 0.2
      }
    }
  ],
  "default_villa": "balanced",
  "rebalance": {
    "parts": [
      "gold",
      "large",
      "mid",
      "small"
    ],
    "month": 12
  },
  "income": {
    "pay_first": [
      "arbitrage"
    ]
  },
  "withdrawals": {
    "swp_default": true,
    "lumpsum_monthly_rate": 0.003,
    "sip_yearly_rate": 0.036
  },
  "tax": {
    "equity_st_rate": 0.2,
    "equity_lt_rate": 0.125,
    "equity_lt_months": 12,
    "equity_exempt": 125000,
    "gold_parts": [
      "gold"
    ],
    "gold_lt_rate": 0.125,
    "gold_lt_months": 12,
    "cess": 0.04,
    "default_slab": 30
  },
  "estate": {
    "villa_cost": 500000,
    "villa_income_monthly": 1500,
    "plots": 9,
    "stages": [
      {
        "name": "Plot",
        "at": 100000
      },
      {
        "name": "Levelled",
        "at": 200000
      },
      {
        "name": "Foundation",
        "at": 300000
      },
      {
        "name": "Steel frame",
        "at": 400000
      },
      {
        "name": "Villa",
        "at": 500000
      }
    ]
  },
  "flat": {
    "stamp_pct": 7,
    "registration_pct": 1,
    "sell_brokerage_pct": 1.5,
    "rent_rise_pct": 5,
    "upkeep_pct": 0.4,
    "vacant_months": 1,
    "std_deduction": 0.3
  },
  "fd": {
    "nri_tds_pct": 30
  },
  "display": {
    "inflation_pct": 6,
    "rate_years": 15
  }
} as CalcConfig;
