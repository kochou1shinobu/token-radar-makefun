import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRadar, boardIssue, parseSnapshot, calibrate, isRankable, impliedValue,
  MODEL, MODEL_VERSION, farmSteps, categoryFamily, coverage,
} from '../lib/model.ts';
import { validateModel, launchOdds, pricedPeers } from '../lib/validation.ts';
import type { Snapshot, SnapshotProtocol } from '../lib/model.ts';

// One synthetic protocol per index; even rows are Dexes, odd rows Lending, so
// calibration and ranking get a mixed field to work on.
const proto = (i: number, overrides: Partial<SnapshotProtocol> = {}): SnapshotProtocol => ({
  slug: `test-${i}`,
  name: `Demo Protocol ${i}`,
  category: i % 2 ? 'Lending' : 'Dexes',
  chains: ['Base'],
  tvl_usd: 5_000_000 + i * 1_000_000,
  change_7d: i % 5 ? 10 : null,
  mcap_usd: null,
  listed_at: '2024-01-01',
  gecko_id: null,
  symbol: null,
  ...overrides,
});

// 140 unpriced protocols (the rankable field), 20 priced ones (the live set),
// plus five names that must be excluded as products or token fields.
export const fixture: Snapshot = {
  as_of: '2026-11-14',
  source: 'SYNTHETIC TEST FIXTURE — not competition data',
  floor_usd: 50_000_000,
  protocols: [
    ...Array.from({ length: 140 }, (_, i) => proto(i)),
    ...Array.from({ length: 20 }, (_, i) => proto(200 + i, {
      mcap_usd: 100_000_000, gecko_id: `coin-${i}`, symbol: `C${i}`,
    })),
    proto(300, { category: 'Bridge' }),
    proto(301, { name: 'Wrapped Demo' }),
    proto(302, { name: 'Demo v2' }),
    proto(303, { symbol: 'ONLY' }),
    proto(304, { name: 'Binance Example' }),
  ],
  watchlist: Array.from({ length: 40 }, (_, i) => `test-${100 + i}`),
};

test('coverage, ranks, caps, deterministic and separate token records', () => {
  const snap = parseSnapshot(JSON.stringify(fixture));
  const a = buildRadar(snap);
  const b = buildRadar(snap);
  assert.deepEqual(a, b);
  assert.equal(boardIssue(a.board, snap), null);
  assert.equal(a.board.length, 140);
  assert.equal(a.radar.watchlist_covered, 40);
  assert.equal(a.radar.early_size, 45);
  assert.equal(a.radar.live_size, 20);
  assert.equal(a.radar.unpriced_token_records, 1);
  assert.ok(a.board.every(r => r.mcap_usd === null));
});

test('peer calibration and outlier caps', () => {
  const m = calibrate(fixture);
  assert.equal(m.global_peer!.n, 20);
  assert.ok(m.global_peer!.multiple > 0 && m.global_peer!.multiple <= 2);
  const p = proto(1, { change_7d: 100000, listed_at: null, chains: [] });
  const v = impliedValue(p, fixture.as_of, m);
  assert.equal(v.growthMult, 1.15);
  assert.equal(v.maturityMult, 1);
  assert.equal(v.breadthMult, 1);
  assert.equal(
    calibrate({ ...fixture, protocols: [] }).global_peer!.multiple,
    MODEL.default_multiple,
  );
});

test('product and token-field exclusions', () => {
  for (const p of fixture.protocols.slice(-5)) assert.equal(isRankable(p), false);
  assert.equal(isRankable(proto(1)), true);
});

test('malformed input and over-cap board rejected', () => {
  assert.throws(
    () => parseSnapshot(JSON.stringify({
      ...fixture,
      protocols: [...fixture.protocols, fixture.protocols[0]],
    })),
    /Duplicate/,
  );
  assert.throws(
    () => parseSnapshot(JSON.stringify({ ...fixture, watchlist: ['missing'] })),
    /watchlist/,
  );
  const { board } = buildRadar(fixture);
  board[0].implied_value_usd = 100_000_000_000_001;
  assert.match(boardIssue(board, fixture)!, /implied value/);
});

test('calibration families are split, not lumped', () => {
  // Category keywords map to distinct families: a curator is not a stablecoin.
  assert.equal(categoryFamily('Yield Aggregator').family, 'yield & vaults');
  assert.equal(categoryFamily('Risk Curator').family, 'yield & vaults');
  assert.equal(categoryFamily('Stablecoins').family, 'stablecoins & rwa');
  assert.equal(categoryFamily('RWA').family, 'stablecoins & rwa');
  assert.equal(categoryFamily('Insurance').family, 'insurance & infrastructure');
  assert.equal(categoryFamily('Dexes').family, 'trading venue');
  assert.equal(categoryFamily('Dex Aggregator').family, 'trading venue');
  assert.equal(categoryFamily('Basis Trading').family, 'trading venue');
  assert.equal(categoryFamily('Something Unknown').family, 'other');
  const m = calibrate(fixture);
  assert.ok('yield & vaults' in m.peer_multiples!);
  assert.ok('stablecoins & rwa' in m.peer_multiples!);
  assert.ok('insurance & infrastructure' in m.peer_multiples!);
  assert.ok(!('yield & infrastructure' in m.peer_multiples!));
  // The fixture's priced set is all Dexes/Lending, so the yield family is empty
  // and must say it falls back to the global median, with no typical peers.
  const y = m.peer_multiples!['yield & vaults']!;
  assert.equal(y.n, 0);
  assert.equal(y.fallback, 'global');
  assert.deepEqual(y.typicalPeers, []);
  assert.equal(y.multiple, m.global_peer!.multiple);
  // A populated family publishes its evidence: raw median, quartiles, clip count.
  const lending = m.peer_multiples!['lending']!;
  assert.ok(lending.n > 0);
  assert.equal(lending.fallback, 'family');
  assert.ok(lending.rawMedian !== null && lending.rawMedian > 0);
  assert.ok(lending.q1 !== null && lending.q3 !== null && lending.q1 <= lending.q3);
  assert.ok(Number.isInteger(lending.clipped) && lending.clipped >= 0);
  assert.ok(lending.typicalPeers.length > 0 && lending.typicalPeers.length <= 3);
});

test('scenario sensitivity brackets the base value and rank', () => {
  const { radar } = buildRadar(parseSnapshot(JSON.stringify(fixture)));
  assert.equal(radar.sensitivity.length, 10);
  for (const s of radar.sensitivity) {
    assert.ok(s.conservative <= s.base && s.base <= s.generous);
    assert.ok(s.rankLow <= s.rank && s.rank <= s.rankHigh);
    assert.ok(s.rankLow >= 1 && s.rankHigh <= radar.board_size);
  }
});

test('conditional farm plans satisfy step gate', () => {
  const categories: Array<string | null> = [
    'Dexes', 'Dex Aggregator', 'Lending', 'Derivatives', 'Insurance', 'RWA',
    'Yield', 'Stablecoins', 'Prediction Market', null,
  ];
  for (const category of categories) {
    const steps = farmSteps(proto(1, { category }), 100);
    assert.equal(steps.length, 6);
    assert.ok(steps.every(s => s.length >= 20 && s.length <= 600));
    assert.match(steps.join(' '), /Time:|time:/);
    assert.match(steps.join(' '), /Cost:|cost:/);
  }
});

test('coverage partition is mutually exclusive and sums to the total', () => {
  const { board, radar } = buildRadar(parseSnapshot(JSON.stringify(fixture)));
  const c = coverage(fixture, board);
  // Fixture: 140 rankable + 20 priced + 4 product-like + 1 symbol-only = 165 records.
  assert.equal(c.total, 165);
  assert.equal(c.ranked, 140);
  assert.equal(c.preTokenExcluded, 4);
  assert.equal(c.priced, 20);
  assert.equal(c.unpricedTokenEvidence, 1);
  assert.equal(c.ranked + c.preTokenExcluded + c.priced + c.unpricedTokenEvidence, c.total);
  assert.equal(c.rankedWatchlist, 40);
  assert.equal(c.rankedOutside, 100);
  assert.equal(radar.coverage.total, c.total);
  assert.equal(radar.coverage.ranked, c.ranked);
});

test('farm plans follow the real business path, not a generic route', () => {
  const joined = (category: string) => farmSteps(proto(1, { category }), 100).join(' ');
  // A curator runs vaults on other people's strategies; an allocator moves capital
  // between protocols; a CDP mints against collateral. None of them is a lender.
  const curator = joined('Risk Curators');
  assert.match(curator, /curator/);
  assert.match(curator, /vault/);
  const allocator = joined('Onchain Capital Allocator');
  assert.match(allocator, /allocator/);
  const cdp = joined('CDP');
  assert.match(cdp, /mint/);
  assert.doesNotMatch(cdp, /supply up to \$\d+ of a supported asset/);
  const lending = joined('Lending');
  assert.match(lending, /supply up to \$\d+ of a supported asset/);
  assert.doesNotMatch(lending, /mint/);
  // The review window names observable exit triggers, and the last step sums the
  // total expected out-of-pocket instead of scattering fee allowances.
  for (const category of ['Risk Curators', 'CDP', 'Lending']) {
    const text = joined(category);
    assert.match(text, /TVL falls more than 30% in 7 days/);
    assert.match(text, /Total expected out-of-pocket: up to \$\d+ in network fees/);
  }
  // Chains are named, not reduced to one alphabetical-first chain.
  const multi = farmSteps(proto(1, { category: 'Yield', chains: ['Base', 'Ethereum', 'Arbitrum'] }), 100).join(' ');
  assert.match(multi, /Base, Ethereum, Arbitrum/);
  assert.match(multi, /sorts them alphabetically/);
});

// --- radar-9 held-out validation ---
// A synthetic snapshot with 12 priced peers above the floor, across families,
// so the two blind tests have something to fit and test on.
const pricedFixture = (i: number, overrides: Partial<SnapshotProtocol> = {}): SnapshotProtocol => ({
  slug: `priced-${i}`,
  name: `Priced Protocol ${i}`,
  category: ['Dexes', 'Lending', 'Yield Aggregator', 'Stablecoins', 'Insurance'][i % 5]!,
  chains: ['Base'],
  tvl_usd: 60_000_000 + i * 10_000_000,
  change_7d: i % 3 ? 10 : -5,
  mcap_usd: Math.round((60_000_000 + i * 10_000_000) * [0.08, 0.12, 0.05, 0.2, 0.09, 0.15, 0.07, 0.11, 0.06, 0.18, 0.1, 0.13][i]!),
  listed_at: '2023-06-01',
  gecko_id: `priced-coin-${i}`,
  symbol: `P${i}`,
  ...overrides,
});
const validationFixture: Snapshot = {
  as_of: '2026-11-14',
  source: 'SYNTHETIC VALIDATION FIXTURE — not competition data',
  floor_usd: 50_000_000,
  protocols: [
    ...Array.from({ length: 12 }, (_, i) => pricedFixture(i)),
    ...Array.from({ length: 20 }, (_, i) => proto(400 + i)),
  ],
  watchlist: Array.from({ length: 5 }, (_, i) => `test-${400 + i}`),
};

test('held-out validation runs both blind tests and decides each term by rule', () => {
  const snap = parseSnapshot(JSON.stringify(validationFixture));
  assert.equal(pricedPeers(snap).length, 12);
  const v = validateModel(snap);
  assert.equal(v.peers, 12);
  assert.equal(v.loo.length, 6);
  assert.equal(v.walkForward.length, 6);
  for (const r of [...v.loo, ...v.walkForward]) {
    assert.ok(Number.isFinite(r.medianLogErr) && r.medianLogErr >= 0);
    assert.ok(r.within2x >= 0 && r.within2x <= 1);
    assert.ok(r.within3x >= 0 && r.within3x <= 1);
    assert.ok(r.within3x >= r.within2x);
  }
  assert.equal(v.decisions.length, 4);
  for (const d of v.decisions) {
    assert.ok(d.verdict === 'kept' || d.verdict === 'dropped');
    // The verdict follows the rule: dropped only when removing the term improves
    // BOTH tests by at least 0.02 in median log10 error.
    const shouldDrop = d.looWith - d.looWithout >= 0.02 && d.wfWith - d.wfWithout >= 0.02;
    assert.equal(d.verdict, shouldDrop ? 'dropped' : 'kept', d.term);
  }
  assert.ok(v.perFamily.length >= 3);
  for (const p of v.perFamily) assert.ok(Number.isFinite(p.medianLogErr) && p.medianLogErr >= 0);
});

test('validation is deterministic and launch odds are descriptive fractions', () => {
  const snap = parseSnapshot(JSON.stringify(validationFixture));
  assert.deepEqual(validateModel(snap), validateModel(snap));
  const odds = launchOdds(snap);
  assert.equal(odds.length, 6);
  for (const o of odds) {
    assert.ok(o.priced + o.preToken >= 0);
    assert.ok(o.odds === null || (o.odds >= 0 && o.odds <= 1));
    if (o.priced === 0 && o.preToken === 0) assert.equal(o.odds, null);
  }
});

test('maturity term is exactly 1 in radar-9', () => {
  assert.equal(MODEL_VERSION, 'radar-9');
  assert.equal(MODEL.maturity_floor, 1);
  assert.equal(MODEL.maturity_range, 0);
  const v = impliedValue(proto(1, { listed_at: '2020-01-01' }), '2026-11-14', MODEL);
  assert.equal(v.maturityMult, 1);
  const young = impliedValue(proto(1, { listed_at: '2026-11-01' }), '2026-11-14', MODEL);
  assert.equal(young.maturityMult, 1);
});

test('buildRadar leaves validation for main.ts to fill', () => {
  const snap = parseSnapshot(JSON.stringify(fixture));
  const { radar } = buildRadar(snap);
  assert.equal(radar.validation, null);
  assert.deepEqual(radar.launch_odds, []);
});
