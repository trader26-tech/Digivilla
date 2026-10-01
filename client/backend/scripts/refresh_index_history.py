"""Refresh the calculators' benchmark index history (app/index_data.py).

Pulls the month-end closes from niftyindices.com (arbitrage / midcap 150 TRI /
smallcap 250 TRI) and mfapi (gold ETF), writes them to Supabase Storage
calc-data/index_history.json and, with --snapshot, to the repo copy
app/data/index_history.json too.

Run:  python -m scripts.refresh_index_history            # last ~13 months, merged
      python -m scripts.refresh_index_history --full     # everything back to 2005
      python -m scripts.refresh_index_history --snapshot # also rewrite the repo copy
"""

import json
import sys


def main() -> int:
    from app import index_data
    full = "--full" in sys.argv
    d = index_data.fetch(full=full)
    empty = [k for k, v in d["series"].items() if not v.get("months")]
    if empty:
        print(f"refresh_index_history: no data for {empty} — nothing saved")
        return 1
    index_data.save(d)
    if "--snapshot" in sys.argv:
        index_data._SNAPSHOT.write_text(json.dumps(d, separators=(",", ":")))
    for k, v in d["series"].items():
        ms = sorted(v["months"])
        print(f"  {k:10s} {ms[0]} → {ms[-1]}  ({len(ms)} months)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
