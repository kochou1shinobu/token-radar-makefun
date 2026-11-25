// radar-4 model: snapshot-only peer calibration with published peer evidence.
// Every number on the board is derived from the sealed snapshot alone: no
// hardcoded per-protocol values, no launch-probability claim. The multiple a
// protocol gets is the median market-cap/TVL of already-priced peers in its
// category family, clipped to a sane band and shrunk toward the global median
// when the family sample is small.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  default_multiple: number;
  peer_multiples?: Record<string, PeerCalibration>;
  global_peer?: PeerCalibration;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  default_multiple: 0.3,
  growth_weight: 0.25,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.85,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 730,
  breadth_per_chain: 0.02,
  breadth_max_extra_chains: 5,
};

/**
 * Category families: peer groups for calibration, not fixed valuation multiples.
 * The old single "yield & infrastructure" bucket lumped together businesses whose
 * tokens price very differently — a yield curator's token is not a stablecoin's,
 * and neither is an insurer's — so it is split into three families. A category
 * that matches nothing falls into "other" and calibrates on the global median.
 */
export const CATEGORY_FAMILIES: { match: string[]; family: string }[] = [
  { match: ['dex', 'dex aggregator', 'derivative', 'perpetual', 'options', 'prediction', 'trading'], family: 'trading venue' },
  { match: ['lend', 'cdp', 'collateral', 'money market'], family: 'lending' },
  { match: ['yield', 'farm', 'vault', 'curator', 'allocator'], family: 'yield & vaults' },
  { match: ['stable', 'rwa'], family: 'stablecoins & rwa' },
  { match: ['insurance', 'infra', 'service'], family: 'insurance & infrastructure' },
];

/** Which calibration family a category falls in. */
export function categoryFamily(category: string | null): { family: string } {
  const c = (category ?? '').toLowerCase();
  for (const row of CATEGORY_FAMILIES) {
    if (row.match.some((w) => c.includes(w))) return { family: row.family };
  }
  return { family: 'other' };
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-6';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_family: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/**
 * Scenario sensitivity for one top-10 row: the implied value under the family's
 * lower-quartile multiple (conservative) and upper-quartile multiple (generous),
 * against the base multiple, and the rank range the row takes across the three
 * scenarios. A row whose rank barely moves is a robust call; one that swings
 * from 2nd to 40th is a calibration artefact wearing a rank.
 */
export interface SensitivityRow {
  rank: number;
  slug: string;
  name: string;
  base: number;
  conservative: number;
  generous: number;
  rankLow: number;
  rankHigh: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  category_multiples: { family: string; multiple: number; n: number; median: number | null }[];
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  outside_size: number;
  watchlist_covered: number;
  unpriced_token_records: number;
  live_size: number;
  total_pre_token: number;
  sensitivity: SensitivityRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null; multiple: number; family: string } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra_chains);
  const { family } = categoryFamily(protocol.category);
  const multiple = model.peer_multiples?.[family]?.multiple ?? model.global_peer?.multiple ?? model.default_multiple;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age, multiple, family };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades, or an exchange. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name are that exchange's product, not a launch of their own. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked, bridged or
 * versioned product of a token that already trades. The snapshot carries no parentProtocol field,
 * so outside-watchlist rows are provisional candidates, not proven independent launches.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  return !isProductLike(p);
}

function isProductLike(p: SnapshotProtocol): boolean {
  if (p.category !== null && [...PRODUCT_CATEGORIES].some(c => c.toLowerCase() === p.category!.toLowerCase())) return true;
  if (VERSIONED.test(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((x) => p.name.toLowerCase().startsWith(x.toLowerCase()))) return true;
  return false;
}

/**
 * Calibration evidence for one peer group, published on the dashboard so a reader can
 * check the multiple instead of taking it on trust: sample size, the raw (unclipped)
 * median ratio, the clipped median and quartiles it was actually taken from, how many
 * peer ratios the clip band cut, the shrunk multiple the board uses, where that
 * multiple came from when the family sample is thin, and three representative peers
 * nearest the family's median ratio.
 */
export interface PeerCalibration {
  n: number;
  median: number | null;
  multiple: number;
  rawMedian: number | null;
  q1: number | null;
  q3: number | null;
  clipped: number;
  fallback: 'family' | 'global';
  typicalPeers: string[];
}

const FAMILIES = [
  'trading venue',
  'lending',
  'yield & vaults',
  'stablecoins & rwa',
  'insurance & infrastructure',
  'other',
];

/** The lower quartile of a sorted list (linear interpolation); null on an empty list. */
function quartile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Peer ratios are clipped to this band before any median is taken, so one absurd print cannot rule a family. */
const boundedRatio = (r: number) => Math.max(0.05, Math.min(2, r));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y), i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i]! : (a[i - 1]! + a[i]!) / 2;
}

/**
 * Calibrate the multiples from the snapshot's own priced protocols: records at or above the
 * floor with a positive market cap, deduplicated per token (gecko id first, then symbol, then
 * slug; the largest-TVL record wins, because market cap is a token-level figure repeated across
 * a protocol's versioned pools). Each family's multiple is its clipped median ratio shrunk
 * toward the global median with weight n/(n+12); these are current circulating ratios, not
 * historical launch FDVs, and the model says so wherever it states them.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): ModelConstants {
  const unique = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (!(p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= snapshot.floor_usd) || isProductLike(p)) continue;
    const key = p.gecko_id ? `gecko:${p.gecko_id.toLowerCase()}` : p.symbol ? `symbol:${p.symbol.toLowerCase()}` : `slug:${p.slug}`;
    const prior = unique.get(key);
    if (!prior || p.tvl_usd > prior.tvl_usd || (p.tvl_usd === prior.tvl_usd && p.slug < prior.slug)) unique.set(key, p);
  }
  const peers = [...unique.values()];
  const ratios = peers.map(p => boundedRatio(p.mcap_usd! / p.tvl_usd));
  const center = median(ratios) ?? model.default_multiple;
  const globalRaw = peers.map(p => p.mcap_usd! / p.tvl_usd);
  const globalSorted = [...ratios].sort((a, b) => a - b);
  const global: PeerCalibration = {
    n: ratios.length,
    median: median(ratios),
    multiple: center,
    rawMedian: median(globalRaw),
    q1: quartile(globalSorted, 0.25),
    q3: quartile(globalSorted, 0.75),
    clipped: globalRaw.filter(r => r < 0.05 || r > 2).length,
    fallback: 'global',
    typicalPeers: typicalPeers(peers, median(ratios)),
  };
  const families: Record<string, PeerCalibration> = {};
  for (const family of FAMILIES) {
    const members = peers.filter(p => categoryFamily(p.category).family === family);
    const raw = members.map(p => p.mcap_usd! / p.tvl_usd);
    const xs = raw.map(boundedRatio);
    const sorted = [...xs].sort((a, b) => a - b);
    const m = median(xs), w = xs.length / (xs.length + 12);
    families[family] = {
      n: xs.length,
      median: m,
      multiple: (m ?? center) * w + center * (1 - w),
      rawMedian: median(raw),
      q1: quartile(sorted, 0.25),
      q3: quartile(sorted, 0.75),
      clipped: raw.filter(r => r < 0.05 || r > 2).length,
      fallback: xs.length > 0 ? 'family' : 'global',
      typicalPeers: typicalPeers(members, m),
    };
  }
  return { ...model, global_peer: global, peer_multiples: families };
}

/** Up to three peers nearest the group's median ratio, by slug, most typical first. */
function typicalPeers(members: SnapshotProtocol[], center: number | null): string[] {
  if (center === null || !members.length) return [];
  return [...members]
    .sort((a, b) => Math.abs(boundedRatio(a.mcap_usd! / a.tvl_usd) - center) - Math.abs(boundedRatio(b.mcap_usd! / b.tvl_usd) - center))
    .slice(0, 3)
    .map(p => p.slug);
}

/** The snapshot's protocols indexed by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  model = model.peer_multiples ? model : calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is on the board, always.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (!p || !isPreToken(p)) throw new SnapshotError(`Watchlist conflicts with token record: ${slug}`);
    chosen.set(slug, p);
  }
  // Additional provisional candidates, including below-floor rows and any the watchlist omitted.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      category_family: s.family,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's tracked age: younger protocols get a longer review window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The one step that differs by product type; every plan stays conditional, because the snapshot holds no asset, product or reward metadata. */
function actionFor(p: SnapshotProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  if (/lend|cdp|collateral|money market/.test(c)) return `If a supported lending market is open, supply up to $${capital} of a supported asset, check utilization and withdrawal liquidity; avoid borrowing just for points.`;
  if (/aggregator/.test(c)) return `If the app routes swaps, quote a needed swap of $${Math.min(capital,50)} or less; compare slippage and fees with alternatives. Do not assume it has liquidity pools.`;
  if (/dex/.test(c)) return `If spot swaps are supported, make a needed small swap (up to $${Math.min(capital,50)}). Only consider LP if a real pool exists and you understand impermanent loss.`;
  if (/perpetual|derivative|options/.test(c)) return `Inspect collateral, funding, liquidation and trading fees. Start with a free demo or skip; only make a small genuine trade if already experienced. Never add leverage solely to farm.`;
  if (/prediction/.test(c)) return `Review market resolution rules and local eligibility. If lawful and genuinely useful, cap a single position at $${Math.min(capital,10)}; it can lose the full stake. Otherwise skip.`;
  if (/yield|farm|vault|curator|allocator/.test(c)) return `If a public vault exists, check its underlying strategy, share redemption, withdrawal delays and fees; test a small deposit of an eligible asset before committing up to $${capital}.`;
  if (/stable/.test(c)) return `If public mint/redeem is available, check collateral, redemption and depeg risk. Test up to $${Math.min(capital,25)} only if the round trip is supported and affordable.`;
  if (/rwa/.test(c)) return `Check investor eligibility, minimum subscription, custody and redemption terms. Do not mint if access is restricted or the minimum exceeds $${capital}; otherwise test the smallest permitted amount.`;
  if (/insurance/.test(c)) return `Inspect real coverage, exclusions and premium quotes. Buy cover only for an existing risk and only if the premium fits the $${capital} ceiling; do not assume a policy NFT exists.`;
  return `Identify the actual public user action and its supported assets. If there is no accessible user-facing product, stay on the watchlist; do not deposit into an unverified contract.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p), capital = capitalFor(p), hold = holdDaysFor(age);
  const fee = chain === 'Ethereum' ? 15 : 5;
  return [
    `Verify ${p.name} (${p.slug}) from trusted official sources; check that ${chain} is actually supported, whether a token or rewards already exist, eligibility, audits and withdrawal terms. Stop if identity or access is unclear. Cost: $0; time: 15 min.`,
    `${actionFor(p, capital)} Budget ceiling: $${capital} capital or less (not a required minimum); fee allowance up to $${fee}, not a live quote. Time: 15–25 min.`,
    `Before signing, simulate or inspect the transaction, verify contract and asset, limit approvals and estimate round-trip fees. Skip if fees exceed $${fee} or 10% of the chosen position. Cost: $0 before signing; time: 5–10 min.`,
    `For ${p.name}, use only the normal product when it serves a genuine need. Check official rewards terms weekly; no confirmed points, required volume or airdrop in the snapshot. Avoid artificial churn or extra wallets. Cost: $0 to review; time: 5 min/week.`,
    `If a position is appropriate, review it weekly for up to ${hold} days; exit sooner if risks, fees or liquidity change. Do not lock funds just for a speculative reward. Capital at risk: up to $${capital}; review time: 5 min/week.`,
    `Record transaction hashes, net fees and any published eligibility rules. Test withdrawal or exit within your risk budget; revoke unused approvals when applicable. Never pay an unsolicited claim fee or share keys. Time: 10 min; network fee from remaining allowance.`,
  ].map(s => s.length > 600 ? s.slice(0,597)+'...' : s);
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * Scenario sensitivity for the top 10 rows. Each scenario re-prices every board row
 * with a different multiple from the same peer evidence: the family's lower quartile
 * (conservative) or upper quartile (generous), shrunk toward the global quartile with
 * the same n/(n+12) weight the base multiple uses. Ranks are then recomputed under
 * each scenario, so the table shows how far a row's rank moves when the calibration,
 * not the protocol, changes.
 */
export function sensitivityRows(snapshot: Snapshot, model: ModelConstants, board: BoardRow[]): SensitivityRow[] {
  const index = bySlug(snapshot.protocols);
  const global = model.global_peer;
  const scenarioImplied = (row: BoardRow, which: 'q1' | 'q3'): number => {
    const p = index.get(row.slug)!;
    const v = impliedValue(p, snapshot.as_of, model);
    const fam = model.peer_multiples?.[row.model.category_family];
    const n = fam?.n ?? 0, w = n / (n + 12);
    const famQ = which === 'q1' ? fam?.q1 : fam?.q3;
    const globQ = which === 'q1' ? global?.q1 : global?.q3;
    const q = famQ ?? globQ ?? (which === 'q1' ? v.multiple * 0.75 : v.multiple * 1.25);
    const gq = globQ ?? q;
    const mult = q * w + gq * (1 - w);
    return Math.max(1, Math.round(p.tvl_usd * mult * v.growthMult * v.maturityMult * v.breadthMult));
  };
  const rankUnder = (values: Map<string, number>): Map<string, number> => {
    const order = [...board].sort((a, b) => values.get(b.slug)! - values.get(a.slug)! || (a.slug < b.slug ? -1 : 1));
    return new Map(order.map((r, i) => [r.slug, i + 1]));
  };
  const cons = new Map(board.map(r => [r.slug, scenarioImplied(r, 'q1')]));
  const gen = new Map(board.map(r => [r.slug, scenarioImplied(r, 'q3')]));
  const consRank = rankUnder(cons), genRank = rankUnder(gen);
  return board.slice(0, 10).map(r => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    base: r.implied_value_usd,
    conservative: cons.get(r.slug)!,
    generous: gen.get(r.slug)!,
    rankLow: Math.min(r.rank, consRank.get(r.slug)!, genRank.get(r.slug)!),
    rankHigh: Math.max(r.rank, consRank.get(r.slug)!, genRank.get(r.slug)!),
  }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  model = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist && r.tvl_usd < snapshot.floor_usd).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    category_multiples: FAMILIES.map(family => ({ family, ...model.peer_multiples![family]! })),
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    outside_size: board.filter(r => !r.on_watchlist).length,
    watchlist_covered: board.filter(r => r.on_watchlist).length,
    unpriced_token_records: snapshot.protocols.filter(p => !isPreToken(p) && !(p.mcap_usd !== null && p.mcap_usd > 0)).length,
    live_size: live.length,
    total_pre_token: snapshot.protocols.filter(isPreToken).length,
    sensitivity: sensitivityRows(snapshot, model, board),
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      on_watchlist: row.on_watchlist,
      implied_value_usd: row.implied_value_usd,
      category_multiple: row.model.category_multiple,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      breadth_multiplier: row.model.breadth_multiplier,
      farm_steps: row.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (!Number.isFinite(Date.parse(o.as_of+'T00:00:00Z')) || new Date(o.as_of+'T00:00:00Z').toISOString().slice(0,10) !== o.as_of) throw new SnapshotError('Invalid as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || !/^[^\s]{1,128}$/.test(p.slug) || typeof p.name !== 'string' || !p.name.trim() || typeof p.tvl_usd !== 'number' || !Number.isSafeInteger(p.tvl_usd) || p.tvl_usd <= 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? [...new Set(p.chains.filter((c): c is string => typeof c === 'string' && !!c.trim()))].sort() : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  const ids = new Set(protocols.map(p => p.slug));
  if (ids.size !== protocols.length) throw new SnapshotError('Duplicate protocol slug');
  if (new Set(o.watchlist).size !== o.watchlist.length || o.watchlist.some(x => !ids.has(x as string))) throw new SnapshotError('Invalid watchlist membership');
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'Duplicate board slug';
  if (board.length > 4000 || Buffer.byteLength(JSON.stringify({rows:board})+"\n") > 8_388_608) return 'Board exceeds row or byte cap';
  const allowed = bySlug(snapshot.protocols);
  for (const r of board) if (!allowed.has(r.slug) || !isPreToken(allowed.get(r.slug)!) || !r.name.trim() || r.slug.length > 128 || /\s/.test(r.slug)) return `Invalid row ${r.slug}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
