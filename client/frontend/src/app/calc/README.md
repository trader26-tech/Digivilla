# Calculators — how they're built

Four calculators (FD, Lumpsum, SIP, Flat vs DigiVilla), the Home estate numbers
and the admin's "Check the maths" all run on **one settings object** and **one
engine**. Change a number in the settings and every screen, the admin check and
the research function follow — no code change.

```
 SETTINGS  calc_config.json  ──►  GET /calc/config  ──►  CalcDataService.config()
   (villas, rebalance, income order, SWP rates, tax, estate, flat, fd, display)
      │                                                     │
      ▼                                                     ▼
 ENGINE  calc/engine/  (pure: inputs + CalcConfig + history → result)
      │
      ▼
 VIEW MODELS  calc/view/*.view.ts  (result + settings → exactly what a screen shows)
      │
      ▼
 SCREENS  *-calc.component.*  (signals for the answers; render the view model)
```

| Layer | Files | Rule |
|---|---|---|
| Settings | `client/backend/app/data/calc_config.json` (repo default) · live copy in Supabase Storage `calc-data/calc_config.json` · `client/backend/app/calc_config.py` (load / validate / save / history) | The ONLY place numbers live. |
| Engine | `engine/types.ts` · `history.ts` · `tax.ts` · `book.ts` · `simulate.ts` · `format.ts` · `default-config.ts` (generated) | Pure functions; every rule comes from the `CalcConfig` argument. |
| View models | `view/common.ts` (`terms()` = the settings in words) · `fd.view.ts` · `lumpsum.view.ts` · `sip.view.ts` · `flat.view.ts` | No numbers typed in — they come from the result or `terms()`. |
| Store | `calc-data.service.ts` | Holds the settings (remembered on the device, refreshed from the API), the history, and the shared choices (villa, SWP). |
| Screens | `fd-vs-dv`, `lumpsum-calc`, `sip-calc`, `flat-calc`, `villa-pick`, `bars-3d`, `year-cols` | Templates read `t()` (terms) and the view model, never constants. |

**Who else reads the same settings:** the client backend (estate ₹ per villa /
income — `client_portfolio.py`; default villa weights — `flat_calc.py`), the admin
(`admin/backend/app/calc_settings.py` loads the SAME `calc_config.py`; `audit.py`
mirrors the engine in Python), and `research/portfolio_sim.py`.

## Changing something

- **In the admin:** Check the maths → **Settings**. Edit, watch "What changes"
  (the app's own engine, published vs draft), Save & publish. Apps pick it up
  within a minute; every save keeps the version it replaced (Load → Save restores).
- **In chat with Claude:** `python -m scripts.calc_config set …` (from
  `client/backend`) — validates, publishes the live copy and rewrites the repo
  default + `engine/default-config.ts`. `show`, `history`, `rollback N`,
  `add-villa`, `remove-villa`, `pull` (live → repo defaults).
- **Never** hard-code a rate, weight, ₹ amount or tax rule in a component, view
  model or the engine — add it to the settings (types.ts + calc_config.json +
  `validate()` in calc_config.py + the admin editor) instead.

## Checking it

- `audit.py` (Python) must match the engine (TypeScript) on every figure — the
  admin's Calculators tab compares them live; a full sweep (villas × SWP ×
  5/8/10/15 yrs) matched on 1,416 figures (largest gap ₹0.005, rounding).
- After changing engine code, re-run that sweep with today's settings: results
  must not move unless the change was meant to move them.
