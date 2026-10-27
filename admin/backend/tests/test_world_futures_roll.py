"""A future's day move and period moves must ignore contract rolls (natgas Nov→Dec showed +17%)."""
from app import world


def test_future_prev_close_is_the_contracts_own():
    # continuous daily bars end with the expired contract's 2.602; the Dec contract closed at 3.022
    meta = {"instrumentType": "FUTURE", "previousClose": 3.022, "regularMarketPrice": 3.064,
            "regularMarketTime": 1793134358, "exchangeTimezoneName": "America/New_York"}
    bars = {"timestamp": [1792987200, 1793073600], "indicators": {"quote": [{"close": [2.64, 2.602]}]}}
    prev, _ = world._prev_close(meta, bars)
    assert prev == 3.022
    assert round((3.064 / prev - 1) * 100, 2) == 1.39


def test_currency_prev_close_ignores_odd_daily_bar():
    meta = {"instrumentType": "CURRENCY", "previousClose": 95.175, "regularMarketPrice": 95.105,
            "regularMarketTime": 1793134358, "exchangeTimezoneName": "Europe/London"}
    bars = {"timestamp": [1792972800], "indicators": {"quote": [{"close": [94.938]}]}}
    assert world._prev_close(meta, bars)[0] == 95.175


def test_index_still_uses_daily_bars():
    meta = {"instrumentType": "INDEX", "previousClose": 22600.0, "regularMarketPrice": 22749.75,
            "regularMarketTime": 1793134358, "exchangeTimezoneName": "Asia/Kolkata"}
    bars = {"timestamp": [1792987200], "indicators": {"quote": [{"close": [22753.2]}]}}
    assert world._prev_close(meta, bars)[0] == 22753.2


def test_splice_has_no_roll_jump():
    cont = [[1, 2.79], [2, 2.64], [3, 2.602], [4, 3.064]]        # old contract, then the roll
    own = [[3, 3.022], [4, 3.064]]                              # the Dec contract itself
    out = world._splice(cont, own)
    assert [p[1] for p in out[-2:]] == [3.022, 3.064]
    assert abs(out[1][1] / out[0][1] - 2.64 / 2.79) < 1e-12   # earlier moves kept, only rescaled
    assert out[0][1] > 3.0                                       # joined to the contract's level


def test_no_usd_value_before_the_currency_has_a_rate():
    fx = [[1000 * 86400, 45.0], [1001 * 86400, 46.0]]           # ₹/$ starts on day 1000
    pts = [(900 * 86400, 3000.0), (1000 * 86400, 4500.0), (1001 * 86400, 4600.0)]
    out = world._fx_walk(pts, fx)
    assert [t // 86400 for t, _ in out] == [1000, 1001]            # day 900 dropped, never priced at 45
    assert out[0][1] == 100.0 and out[1][1] == 100.0


def test_max_and_long_periods():
    day = 86400
    pts = [(0, 100.0), (3000 * day, 150.0), (8000 * day, 400.0)]
    mv = world._moves_from(pts, None)
    assert mv["max"] == 300.0                                       # from the first close
    assert mv["20y"] == 300.0                                       # 7305 days back → the close on day 0
    assert mv["10y"] == round((400 / 150 - 1) * 100, 3)             # 3652 days back → day 3000's close
