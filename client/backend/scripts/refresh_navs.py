"""Daily NAV refresh — run by a Railway cron once a day after the AMFI publish
(~1 AM IST). Fetches the latest NAV for every scheme the app actually uses
(client holdings + villa bucket funds) into the shared ``scheme_nav_cache``
table, so every client reads today's value instantly.

Resource-efficient by design: one run/day, only the schemes in use, and it skips
any scheme already stamped with today's NAV (so a re-run or retry is cheap).

Run:  python -m scripts.refresh_navs
"""

import sys


def main() -> int:
    from app import nav_cache
    codes = nav_cache.held_scheme_codes()
    if not codes:
        print("refresh_navs: no scheme codes in use — nothing to do")
        return 0
    print(f"refresh_navs: refreshing {len(codes)} scheme(s)…")
    summary = nav_cache.refresh_all(codes)
    print(f"refresh_navs: done — {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
