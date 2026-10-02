"""Read and change the calculator SETTINGS (app/calc_config.py) from the command
line — what Claude runs when you ask for a change in chat.

    python -m scripts.calc_config show                      # everything in force
    python -m scripts.calc_config show villas.balanced      # one part
    python -m scripts.calc_config set withdrawals.lumpsum_monthly_rate=0.0025
    python -m scripts.calc_config set villas.balanced.weights='{"arbitrage":0.4,"gold":0.15,"large":0.15,"mid":0.15,"small":0.15}'
    python -m scripts.calc_config set villas.balanced.name=Steady estate.villa_income_monthly=1600
    python -m scripts.calc_config add-villa income '{"name":"Income","risk":1,"risk_name":"Low","weights":{"arbitrage":0.9,"gold":0.1}}'
    python -m scripts.calc_config remove-villa income
    python -m scripts.calc_config history
    python -m scripts.calc_config pull                      # copy the live settings into the repo defaults
    python -m scripts.calc_config rollback 3

Paths: dotted; a villa is addressed by its key (villas.<key>.…). Values are
JSON when they parse as JSON (numbers, true/false, objects), text otherwise.
`set`/`add-villa`/`remove-villa`/`rollback` validate first, then publish the
LIVE copy (apps pick it up within a minute) AND write the repo default
(app/data/calc_config.json) so the two never drift. Add --dry-run to only
validate and show the change.
"""

import json
import sys
from pathlib import Path

from app import calc_config

DEFAULT_FILE = Path(calc_config.__file__).resolve().parent / "data" / "calc_config.json"
# the app's cold-start copy (generated, never edited by hand)
TS_DEFAULT = Path(calc_config.__file__).resolve().parents[2] / "frontend" / "src" / "app" / "calc" / "engine" / "default-config.ts"


def write_defaults(cfg: dict) -> None:
    """Repo default JSON + the app's generated default-config.ts — kept identical."""
    DEFAULT_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    if TS_DEFAULT.parent.exists():
        TS_DEFAULT.write_text(
            "// GENERATED from client/backend/app/data/calc_config.json by scripts/calc_config.py —\n"
            "// do not edit by hand. Only used until the live settings (GET /calc/config) arrive,\n"
            "// and the last live copy is remembered on the device, so this is a cold-start fallback.\n"
            "import { CalcConfig } from './types';\n\n"
            f"export const DEFAULT_CONFIG: CalcConfig = {json.dumps(cfg, indent=2, ensure_ascii=False)} as CalcConfig;\n")


def _node(cfg, parts, create=False):
    cur = cfg
    for p in parts:
        if isinstance(cur, list):                    # villas.<key>
            nxt = next((x for x in cur if isinstance(x, dict) and x.get("key") == p), None)
            if nxt is None:
                raise KeyError(f"no villa with key '{p}'")
            cur = nxt
        else:
            if p not in cur:
                if not create:
                    raise KeyError(f"'{p}' not found")
                cur[p] = {}
            cur = cur[p]
    return cur


def _parse(v: str):
    try:
        return json.loads(v)
    except json.JSONDecodeError:
        return v


def _publish(cfg: dict, dry: bool, what: str) -> None:
    errs = calc_config.validate(cfg)
    if errs:
        print("NOT saved — fix these first:")
        for e in errs:
            print("  •", e)
        sys.exit(1)
    if dry:
        print(f"OK (dry run) — {what}")
        return
    out = calc_config.save(cfg, by="claude (scripts/calc_config.py)")
    write_defaults(out)
    print(f"Saved v{out['version']} — {what}. Live now (apps refresh within {calc_config.CACHE_S}s); "
          "repo default + the app's default-config.ts updated (commit + deploy to make them the fallback too).")


def main(argv: list[str]) -> None:
    dry = "--dry-run" in argv
    argv = [a for a in argv if a != "--dry-run"]
    if not argv:
        print(__doc__); return
    cmd, args = argv[0], argv[1:]
    cfg = calc_config.get(fresh=True)
    if cmd == "show":
        node = _node(cfg, args[0].split(".")) if args else cfg
        print(json.dumps(node, indent=2, ensure_ascii=False)); return
    if cmd == "set":
        changes = []
        for a in args:
            path, _, raw = a.partition("=")
            *parent, last = path.split(".")
            node = _node(cfg, parent, create=True)
            old = node.get(last) if isinstance(node, dict) else None
            node[last] = _parse(raw)
            changes.append(f"{path}: {json.dumps(old, ensure_ascii=False)} → {json.dumps(node[last], ensure_ascii=False)}")
        print("\n".join(changes))
        _publish(cfg, dry, f"{len(changes)} change(s)"); return
    if cmd == "add-villa":
        key, spec = args[0], _parse(args[1])
        if any(v["key"] == key for v in cfg["villas"]):
            print(f"villa '{key}' already exists — use set"); sys.exit(1)
        cfg["villas"].append({"key": key, **spec})
        _publish(cfg, dry, f"villa '{key}' added"); return
    if cmd == "remove-villa":
        cfg["villas"] = [v for v in cfg["villas"] if v["key"] != args[0]]
        _publish(cfg, dry, f"villa '{args[0]}' removed"); return
    if cmd == "pull":                 # live → repo defaults (after an edit in the admin)
        write_defaults(cfg)
        print(f"Repo defaults now match the live settings (v{cfg.get('version')})."); return
    if cmd == "history":
        print(f"in force: v{cfg.get('version')} · {cfg.get('updated_at')} · {cfg.get('updated_by')}")
        for h in calc_config.history()[:20]:
            print(f"  v{h['version']}  saved {h.get('saved_at') or ''}")
        return
    if cmd == "rollback":
        old = calc_config.load_version(int(args[0]))
        if not old:
            print(f"no saved v{args[0]}"); sys.exit(1)
        _publish(old, dry, f"rolled back to the settings of v{args[0]}"); return
    print(f"unknown command '{cmd}'\n"); print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
