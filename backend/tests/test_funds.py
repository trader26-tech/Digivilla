from datetime import date

from app.services.mf_analytics import compute_metrics
from app.services.mf_ingest import parse_navall


def test_parse_navall_basic():
    sample = "\n".join(
        [
            "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
            "",
            "Open Ended Schemes(Equity Scheme - Large Cap Fund)",
            "",
            "Test Mutual Fund",
            "",
            "123456;INF001;INF002;Test Large Cap Fund - Direct - Growth;123.45;14-Aug-2026",
        ]
    )
    schemes = parse_navall(sample)
    assert len(schemes) == 1
    s = schemes[0]
    assert s.scheme_code == 123456
    assert s.fund_house == "Test Mutual Fund"
    assert s.scheme_category == "Equity Scheme - Large Cap Fund"
    assert s.plan == "DIRECT"
    assert s.option == "GROWTH"
    assert s.nav == 123.45
    assert s.nav_date == date(2026, 8, 14)


def test_compute_metrics_growth():
    # Simple doubling over ~1 year -> ~100% 1y return.
    series = [
        (date(2025, 8, 14), 100.0),
        (date(2026, 8, 14), 200.0),
    ]
    m = compute_metrics(series)
    assert m.history_points == 2
    assert m.return_1y is not None
    assert 95 < m.return_1y < 105
    assert m.inception_date == date(2025, 8, 14)


def test_compute_metrics_insufficient():
    m = compute_metrics([(date(2026, 1, 1), 10.0)])
    assert m.history_points == 1
    assert m.return_1y is None
