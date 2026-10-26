"""Regression: a ₹5 L villa registered ₹25 short (stamp duty) is still ONE villa — in the
shared allocation rule (client + admin) and in the placement engine, for every future investor."""
from app import placement as P
from app.shared_alloc import villa_alloc as VA

UNIT = 500_000.0
BUCKETS = [{"id": "b1", "name": "Lumpsum - Balanced", "tier": "balanced", "funds": [
    {"scheme_code": 113345, "scheme_name": "Nippon India Arbitrage Fund", "sleeve": "arbitrage", "target_weight": 36},
    {"scheme_code": 106235, "scheme_name": "Nippon India Large Cap Fund", "sleeve": "large", "target_weight": 16},
    {"scheme_code": 100377, "scheme_name": "Nippon India Growth Mid Cap Fund", "sleeve": "mid", "target_weight": 16},
    {"scheme_code": 147944, "scheme_name": "Bandhan Small Cap Fund", "sleeve": "small", "target_weight": 16},
    {"scheme_code": 999, "scheme_name": "Gold ETF FOF", "sleeve": "gold", "target_weight": 16}]}]


def test_stamp_duty_short_is_one_villa():
    assert P.whole_villas(499_975.01, UNIT) == (1, 24.99)
    assert P.whole_villas(9_999_500.02, UNIT) == (20, 499.98)        # ₹1 Cr in 20 lots, ₹500 short
    assert P.whole_villas(500_000.0, UNIT) == (1, 0.0)
    assert P.whole_villas(490_000.0, UNIT) == (0, 0.0)               # 2 % short is a real shortfall
    assert P.whole_villas(250_000.0, UNIT) == (0, 0.0)               # half a villa is not a villa


def test_allocation_rule_finishes_the_villa():
    assert VA.is_finished(499_975.01, "building", UNIT)
    assert not VA.is_finished(490_000.0, "building", UNIT)
    txns = [{"order_id": f"o{i}", "scheme_code": c, "scheme_name": n, "units": 100, "amount": a, "kind": "Lumpsum", "txn_date": "2026-10-22"}
            for i, (c, n, a) in enumerate([(106235, "Large", 166_491.68), (100377, "Mid", 166_491.68), (147944, "Small", 166_991.65)])]
    out = VA.allocate(txns, [], unit=UNIT, max_houses=99, villa_codes={106235, 100377, 147944}, client_code="x")
    assert len(out["houses"]) == 1 and out["houses"][0]["status"] == "constructed" and out["houses"][0]["pct"] == 100.0


def test_fresh_mix_gets_a_category():
    lines = [{"scheme_code": 106235, "scheme_name": "Nippon India Large Cap Fund"}, {"scheme_code": 100377, "scheme_name": "Nippon India Growth Mid Cap Fund"},
             {"scheme_code": 147944, "scheme_name": "Bandhan Small Cap Fund"}]
    vec = {106235: 0.333, 100377: 0.333, 147944: 0.334}
    assert P.infer_tier(vec, lines, BUCKETS) == "aggressive"
    conservative = lines + [{"scheme_code": 113345, "scheme_name": "Nippon India Arbitrage Fund"}]
    assert P.infer_tier({113345: 0.7, 106235: 0.1, 100377: 0.1, 147944: 0.1}, conservative, BUCKETS) == "conservative"
    assert P.infer_tier({113345: 0.36, 106235: 0.32, 100377: 0.32}, conservative[:2] + [conservative[3]], BUCKETS) == "balanced"
    # a fund that is not a villa fund → the admin decides
    assert P.infer_tier({1: 1.0}, [{"scheme_code": 1, "scheme_name": "Some Flexi Cap Fund"}], BUCKETS) is None
