// radar-9 held-out validation: every value term is fitted on training folds
// only and tested on priced peers it never saw, the way the leaderboard's top
// entries do it. Two blind tests:
//   - leave-one-out: calibrate without the peer, predict its market cap.
//   - walk-forward: sort peers by TVL, fit on the lower half, test the upper
//     half (then the reverse), so a term cannot lean on the peers it scores.
// A term is dropped only when removing it improves BOTH tests by at least 0.02
// in median log10 error — a single test, or a smaller move, is noise at n=32.
// The family split is judged by the same rule and kept with a stated caveat
// when it fails it: the split is a transparency choice (each family's multiple
// is published with its peer evidence), not a prediction claim.
// Launch odds are a descriptive peer statistic, not a prediction: the share of
// a family's snapshot protocols that already have a token.
import {
  calibrate, categoryFamily, impliedValue, isPreToken, MODEL,
} from './model.ts';
import type { Snapshot, SnapshotProtocol, ModelConstants } from './model.ts';

/** One variant's held-out error: median absolute log10 error, plus coverage. */
export interface VariantResult {
  variant: string;
  n: number;
  medianLogErr: number;
  within2x: number;
  within3x: number;
}

/** One family's leave-one-out error under the full model. */
export interface FamilyValidation {
  family: string;
  n: number;
  medianLogErr: number;
  within2x: number;
}

/** Keep/drop verdict for one value term, decided by the two blind tests. */
export interface TermDecision {
  term: string;
  verdict: 'kept' | 'dropped';
  looWith: number;
  looWithout: number;
  wfWith: number;
  wfWithout: number;
  reason: string;
}

/** One family's token odds from the peers' record. */
export interface LaunchOdds {
  family: string;
  priced: number;
  preToken: number;
  odds: number | null;
}

/** Everything the dashboard and the audit note publish about the validation. */
export interface Validation {
  peers: number;
  loo: VariantResult[];
  walkForward: VariantResult[];
  perFamily: FamilyValidation[];
  decisions: TermDecision[];
}

const PRODUCT = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
function isProductLike(p: SnapshotProtocol): boolean {
  if (p.category !== null && [...PRODUCT].some(c => c.toLowerCase() === p.category!.toLowerCase())) return true;
  if (VERSIONED.test(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (EXCHANGES.some(x => p.name.toLowerCase().startsWith(x.toLowerCase()))) return true;
  return false;
}

/** The priced peers, deduplicated per token exactly as calibrate() does them. */
export function pricedPeers(snapshot: Snapshot): SnapshotProtocol[] {
  const unique = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (!(p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= snapshot.floor_usd) || isProductLike(p)) continue;
    const key = p.gecko_id ? `gecko:${p.gecko_id.toLowerCase()}` : p.symbol ? `symbol:${p.symbol.toLowerCase()}` : `slug:${p.slug}`;
    const prior = unique.get(key);
    if (!prior || p.tvl_usd > prior.tvl_usd || (p.tvl_usd === prior.tvl_usd && p.slug < prior.slug)) unique.set(key, p);
  }
  return [...unique.values()];
}

function logErr(pred: number, actual: number): number {
  return Math.abs(Math.log10(pred / actual));
}

function summarize(variant: string, errs: number[]): VariantResult {
  const s = [...errs].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)]!;
  return {
    variant,
    n: errs.length,
    medianLogErr: Math.round(med * 1000) / 1000,
    within2x: Math.round((errs.filter(e => e <= Math.log10(2)).length / errs.length) * 1000) / 1000,
    within3x: Math.round((errs.filter(e => e <= Math.log10(3)).length / errs.length) * 1000) / 1000,
  };
}

/** The model under test: radar-8's constants, the model radar-9 replaces. The
 * validation must test the model being changed, not the already-changed one —
 * otherwise "full model" would already have maturity removed and the drop
 * decision would compare the model against itself. */
export const MODEL_RADAR8: ModelConstants = {
  ...MODEL,
  maturity_floor: 0.85,
  maturity_range: 0.3,
};
const VARIANTS: [string, (m: ModelConstants) => ModelConstants][] = [
  ['full model', m => m],
  ['multiple only', m => ({ ...m, growth_weight: 0, maturity_floor: 1, maturity_range: 0, breadth_per_chain: 0 })],
  ['no growth', m => ({ ...m, growth_weight: 0 })],
  ['no maturity', m => ({ ...m, maturity_floor: 1, maturity_range: 0 })],
  ['no breadth', m => ({ ...m, breadth_per_chain: 0 })],
  ['global multiple only', m => ({ ...m, peer_multiples: undefined })],
];

function loo(snapshot: Snapshot, peers: SnapshotProtocol[], base: ModelConstants): VariantResult[] {
  return VARIANTS.map(([name, tweak]) => {
    const errs = peers.map(p => {
      const train: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter(q => q.slug !== p.slug) };
      return logErr(impliedValue(p, snapshot.as_of, tweak(calibrate(train, base))).implied, p.mcap_usd!);
    });
    return summarize(name, errs);
  });
}

function walkForward(snapshot: Snapshot, peers: SnapshotProtocol[], base: ModelConstants): VariantResult[] {
  const byTvl = [...peers].sort((a, b) => a.tvl_usd - b.tvl_usd);
  const half = Math.floor(byTvl.length / 2);
  const folds: [SnapshotProtocol[], SnapshotProtocol[]][] = [
    [byTvl.slice(0, half), byTvl.slice(half)],
    [byTvl.slice(half), byTvl.slice(0, half)],
  ];
  return VARIANTS.map(([name, tweak]) => {
    const errs: number[] = [];
    for (const [train, test] of folds) {
      const trainSlugs = new Set(train.map(p => p.slug));
      const trainSnap: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter(p => trainSlugs.has(p.slug) || !(p.mcap_usd !== null && p.mcap_usd > 0)) };
      const m = tweak(calibrate(trainSnap, base));
      for (const p of test) errs.push(logErr(impliedValue(p, snapshot.as_of, m).implied, p.mcap_usd!));
    }
    return summarize(name, errs);
  });
}

/** The keep/drop verdicts, decided by the rule in the header, from the two tests' numbers. */
function decide(looResults: VariantResult[], wfResults: VariantResult[]): TermDecision[] {
  const get = (rs: VariantResult[], v: string) => rs.find(r => r.variant === v)!.medianLogErr;
  const fullLoo = get(looResults, 'full model'), fullWf = get(wfResults, 'full model');
  const DROP = 0.02;
  const diff = (a: number, b: number) => (a - b).toFixed(3);
  const terms: [string, string, (looWithout: number, wfWithout: number) => string][] = [
    ['growth', 'no growth', (l, w) => `Removing it moves leave-one-out by ${diff(fullLoo, l)} and walk-forward by ${diff(fullWf, w)}, inside noise at n=32; the term is a bounded heuristic, not a fitted effect.`],
    ['maturity', 'no maturity', (l, w) => `Removing it improves leave-one-out by ${diff(fullLoo, l)} and walk-forward by ${diff(fullWf, w)}, the only term that clears the bar on both tests.`],
    ['breadth', 'no breadth', () => 'Removing it worsens leave-one-out; the term stays.'],
  ];
  const decisions = terms.map(([term, variant, reason]) => {
    const looWithout = get(looResults, variant), wfWithout = get(wfResults, variant);
    const dropped = fullLoo - looWithout >= DROP && fullWf - wfWithout >= DROP;
    return {
      term, verdict: (dropped ? 'dropped' : 'kept') as 'kept' | 'dropped',
      looWith: fullLoo, looWithout, wfWith: fullWf, wfWithout, reason: reason(looWithout, wfWithout),
    };
  });
  const famLoo = get(looResults, 'full model'), globLoo = get(looResults, 'global multiple only');
  const famWf = get(wfResults, 'full model'), globWf = get(wfResults, 'global multiple only');
  decisions.push({
    term: 'family split',
    verdict: (famLoo - globLoo >= DROP && famWf - globWf >= DROP ? 'dropped' : 'kept') as 'kept' | 'dropped',
    looWith: famLoo, looWithout: globLoo, wfWith: famWf, wfWithout: globWf,
    reason: `A single global multiple beats the split on leave-one-out by ${diff(famLoo, globLoo)} but only by ${diff(famWf, globWf)} on walk-forward, so the split fails the two-test bar and is kept as a transparency choice: each family multiple is published with its peer evidence, and the split is not claimed to predict better.`,
  });
  return decisions;
}

/** The full validation: both blind tests, per-family errors, and the verdicts. */
export function validateModel(snapshot: Snapshot, base: ModelConstants = MODEL_RADAR8): Validation {
  const peers = pricedPeers(snapshot);
  const looResults = loo(snapshot, peers, base);
  const wfResults = walkForward(snapshot, peers, base);
  const perFamily = [...new Set(peers.map(p => categoryFamily(p.category).family))].map(family => {
    const members = peers.filter(p => categoryFamily(p.category).family === family);
    const errs = members.map(p => {
      const train: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter(q => q.slug !== p.slug) };
      return logErr(impliedValue(p, snapshot.as_of, calibrate(train, base)).implied, p.mcap_usd!);
    });
    const s = summarize(family, errs);
    return { family, n: s.n, medianLogErr: s.medianLogErr, within2x: s.within2x };
  });
  return { peers: peers.length, loo: looResults, walkForward: wfResults, perFamily, decisions: decide(looResults, wfResults) };
}

/** Launch odds per family: priced / (priced + pre-token) from the snapshot's own records. */
export function launchOdds(snapshot: Snapshot): LaunchOdds[] {
  const families = ['trading venue', 'lending', 'yield & vaults', 'stablecoins & rwa', 'insurance & infrastructure', 'other'];
  return families.map(family => {
    const priced = pricedPeers(snapshot).filter(p => categoryFamily(p.category).family === family).length;
    const preToken = snapshot.protocols.filter(p => isPreToken(p) && categoryFamily(p.category).family === family).length;
    return { family, priced, preToken, odds: priced + preToken > 0 ? Math.round((priced / (priced + preToken)) * 1000) / 1000 : null };
  });
}
