/**
 * The calculators' ENGINE — pure functions; every rule and number comes from a
 * CalcConfig (the settings), never from a constant here.
 *
 *   types.ts            the settings' shape
 *   default-config.ts   cold-start copy of the settings (generated)
 *   history.ts          the benchmark data, windows, villa weights, IRR
 *   tax.ts              tax on a financial year's gains
 *   book.ts             lots, payouts, the yearly rebalance
 *   simulate.ts         lumpsum (FD / Lumpsum / Flat), SIP, Flat, a villa's rate
 *   format.ts           ₹ and month labels
 *
 * Screens never call these directly: calc/view/*.view.ts turn a result into
 * exactly what a screen shows (the "view model"), and CalcDataService holds the
 * settings, the data and the shared choices (villa, SWP).
 */
export * from './types';
export * from './default-config';
export * from './history';
export * from './tax';
export * from './book';
export * from './simulate';
export * from './format';
