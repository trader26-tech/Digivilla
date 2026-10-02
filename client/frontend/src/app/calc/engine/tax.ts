import { CalcConfig } from './types';

/** Gains realised in one financial year, by how they're taxed. */
export interface Gains { eqSt: number; eqLt: number; goldSt: number; goldLt: number; }
export const noGains = (): Gains => ({ eqSt: 0, eqLt: 0, goldSt: 0, goldLt: 0 });

/** Today's tax rules (from the settings) applied to one financial year's gains. */
export class TaxRules {
  constructor(private t: CalcConfig['tax'], private slabPct: number) {}
  /** book a gain (or loss) from selling `sleeve` held `heldMonths` */
  add(g: Gains, sleeve: string, gain: number, heldMonths: number): void {
    if ((this.t.gold_parts as string[]).includes(sleeve)) {
      if (heldMonths > this.t.gold_lt_months) g.goldLt += gain; else g.goldSt += gain;
    } else if (heldMonths > this.t.equity_lt_months) g.eqLt += gain;
    else g.eqSt += gain;
  }
  /** the year's tax — losses offset gains of the same kind; exemption on equity long-term; + cess */
  tax(g: Gains): number {
    let st = g.eqSt, lt = g.eqLt;
    if (st < 0 && lt > 0) { lt = Math.max(0, lt + st); st = 0; }
    else if (lt < 0 && st > 0) { st = Math.max(0, st + lt); lt = 0; }
    const eq = Math.max(0, st) * this.t.equity_st_rate + Math.max(0, lt - this.t.equity_exempt) * this.t.equity_lt_rate;
    const gold = Math.max(0, g.goldSt) * (this.slabPct / 100) + Math.max(0, g.goldLt) * this.t.gold_lt_rate;
    return (eq + gold) * (1 + this.t.cess);
  }
}
