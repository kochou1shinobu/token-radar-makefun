// Token Launch Radar's dashboard (model radar-4). It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a live-token view kept apart from the
// ranking, a method page that states the model, and a detail view for every protocol with its
// model breakdown and farm plan. No network: every byte it shows is in data.js. The detail
// view recomputes the implied value from the row's own figures with the same formula
// lib/model.ts uses, and says so when the recomputation matches the board — the page and the
// code are the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) { document.getElementById('board').textContent = 'Data missing. Run main.ts to build the dashboard.'; return; }
  var app = document.getElementById('board');
  app.removeAttribute('aria-busy');

  var params = new URLSearchParams(location.search);
  var SORT_KEYS = ['implied', 'tvl', 'growth', 'age', 'rank'];
  // State is read from the URL, validated, and written back on every render, so a
  // refresh or a shared link keeps the same filters and sort. Anything invalid
  // falls back to the board with defaults instead of an empty detail page: an
  // unknown view, sort, category or chain, or a detail slug that names no row.
  var state = {
    view: params.get('view') || 'board', // board | live | method | detail
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    watchOnly: params.get('watch') === '1',
    belowFloor: params.get('below') === '1',
    sort: SORT_KEYS.indexOf(params.get('sort') || '') >= 0 ? params.get('sort') : 'implied',
    dir: params.get('sort') === 'rank' ? 1 : -1,
    slug: params.get('slug') || null,
  };
  if (state.view !== 'board' && state.view !== 'live' && state.view !== 'method' && state.view !== 'detail') state.view = 'board';
  if (state.category !== 'all' && categories().indexOf(state.category) < 0) state.category = 'all';
  if (state.chain !== 'all' && chains().indexOf(state.chain) < 0) state.chain = 'all';
  if (state.view === 'detail' && (!state.slug || !DATA.rows.some(function (r) { return r.slug === state.slug; }))) {
    state.view = 'board'; state.slug = null;
  }

  // Keep the URL in step with the state, so filters and sort survive a refresh.
  function syncUrl() {
    try {
      var p = new URLSearchParams();
      if (state.view !== 'board') p.set('view', state.view);
      if (state.q) p.set('q', state.q);
      if (state.category !== 'all') p.set('category', state.category);
      if (state.chain !== 'all') p.set('chain', state.chain);
      if (state.watchOnly) p.set('watch', '1');
      if (state.belowFloor) p.set('below', '1');
      if (state.sort !== 'implied') p.set('sort', state.sort);
      if (state.view === 'detail' && state.slug) p.set('slug', state.slug);
      var qs = p.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    } catch (e) { /* file:// or sandboxed hosts: the page works without it */ }
  }

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The model, recomputed in the page: identical constants and formula to lib/model.ts (radar-6).
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_extra_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth));
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }

  function filtered() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      if (state.belowFloor && r.tvl_usd >= DATA.floor_usd) return false;
      return true;
    });
    var key = { implied: 'implied_value_usd', tvl: 'tvl_usd', growth: 'change_7d', age: 'age_days', rank: 'rank' }[state.sort] || 'implied_value_usd';
    rows.sort(function (a, b) {
      var av = a[key] === null || a[key] === undefined ? -Infinity : a[key];
      var bv = b[key] === null || b[key] === undefined ? -Infinity : b[key];
      if (av === -Infinity && bv !== -Infinity) return 1;
      if (bv === -Infinity && av !== -Infinity) return -1;
      if (av !== bv) return state.dir * (av - bv);
      return a.rank - b.rank;
    });
    return rows;
  }

  function header() {
    return (
      '<header class="top">' +
      '<p class="eyebrow">Token Launch Radar · model ' + esc(DATA.model_version) + '</p>' +
      '<h1>Find the next token launch opportunity.</h1>' +
      '<p class="lede">Snapshot-ranked opportunities with <strong>no token recorded</strong>. Comparable-token valuations, bounded growth and maturity adjustments, and conditional farm plans. Launch value is a scenario, not launch probability or expected airdrop proceeds.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.rows.length + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_covered + ' / ' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat hot"><b>' + DATA.early_size + '</b><span>below-floor finds</span></div>' +
      '<div class="stat"><b>' + DATA.coverage.preTokenExcluded + '</b><span>excluded as product-like</span></div>' +
      '<div class="stat"><b>' + DATA.coverage.priced + '</b><span>priced token records</span></div>' +
      '<div class="stat"><b>' + DATA.coverage.unpricedTokenEvidence + '</b><span>token evidence, unpriced</span></div>' +
      '</div>' +
      '<nav class="tabs" role="tablist">' +
      '<button data-view="board" aria-selected="' + (state.view === 'board' || state.view === 'detail') + '">The board</button>' +
      '<button data-view="live" aria-selected="' + (state.view === 'live') + '">Priced tokens (not ranked)</button>' +
      '<button data-view="method" aria-selected="' + (state.view === 'method') + '">How the model works</button>' +
      '</nav></header>'
    );
  }

  function footer() {
    return '<footer>Data: ' + esc(DATA.source) + ', snapshot ' + esc(DATA.as_of) + '. “Records no token” is what the snapshot\u2019s record shows — a protocol may still have a token its record does not carry. Farm plans are a starting point, not financial advice; never pay to claim an airdrop.</footer>';
  }

  function controls() {
    var catOpts = '<option value="all">All categories</option>' + categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="all">All chains</option>' + chains().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var sortOpts = [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age'], ['rank', 'Model rank']].map(function (o) {
      return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>Sort: ' + o[1] + '</option>';
    }).join('');
    return (
      '<div class="controls">' +
      '<input type="search" aria-label="Search protocols" id="q" placeholder="Search name or slug…" value="' + esc(state.q) + '">' +
      '<select aria-label="Category" id="category">' + catOpts + '</select>' +
      '<select aria-label="Chain" id="chain">' + chainOpts + '</select>' +
      '<select aria-label="Sort" id="sort">' + sortOpts + '</select>' +
      '<label class="check"><input type="checkbox" id="watch"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '<label class="check"><input type="checkbox" id="below"' + (state.belowFloor ? ' checked' : '') + '> Below floor only</label>' +
      '<span class="count" id="count"></span>' +
      '</div>'
    );
  }

  function boardView() {
    var rows = filtered();
    var body = rows.map(function (r) {
      var chg = r.change_7d === null ? '<td class="num">n/a</td>' : '<td class="num ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</td>';
      return (
        '<tr tabindex="0" role="link" aria-label="Open ' + esc(r.name) + '" data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.on_watchlist ? '<span class="badge">watchlist</span>' : '<span class="badge early">' + (r.tvl_usd < DATA.floor_usd ? 'early' : 'unverified') + '</span>') +
        '<br><span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + chg +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td class="num">' + (r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a') + '</td>' +
        '</tr>'
      );
    }).join('');
    // The active sort column shows its direction; the rest stay plain.
    function sortTh(key, label) {
      var active = state.sort === key;
      var arrow = active ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
      var aria = active ? ' aria-sort="' + (state.dir === -1 ? 'descending' : 'ascending') + '"' : '';
      return '<th class="num sortable" data-sort="' + key + '"' + aria + '>' + label + arrow + '</th>';
    }
    return (
      header() + controls() +
      '<table><thead><tr>' +
      '<th>#</th><th>Protocol</th><th>Chains</th>' +
      sortTh('tvl', 'TVL') +
      sortTh('growth', '7d change') +
      sortTh('age', 'Age') +
      sortTh('implied', 'Implied value') +
      '<th class="num">Implied / TVL</th>' +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="8" class="empty">No protocol matches those filters.</td></tr>') + '</tbody></table>' +
      footer()
    );
  }

  function detailView(row) {
    var recomputed = impliedOf(row);
    var steps = row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return (
      header() +
      '<section class="detail">' +
      '<button class="back" id="back">← Back to the board</button>' +
      '<p class="eyebrow">Rank #' + row.rank + ' of ' + DATA.rows.length + (row.on_watchlist ? ' · on the house watchlist' : ' · outside watchlist; parent relation unverified') + '</p>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="lede">' + esc(row.category || 'Uncategorised') + ' · ' + esc(row.chains.join(', ') || 'no chains recorded') + ' · tracked by DefiLlama since ' + esc(row.listed_at || 'an unrecorded date') + '</p>' +
      '<div class="grid">' +
      '<div class="cell"><b>' + fmtUsd(row.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="cell"><b>' + fmtPct(row.change_7d) + '</b><span>TVL change, 7d</span></div>' +
      '<div class="cell"><b>' + fmtAge(row.age_days) + '</b><span>tracking age</span></div>' +
      '<div class="cell"><b>' + row.chains.length + '</b><span>chains</span></div>' +
      '<div class="cell"><b>' + fmtUsd(row.implied_value_usd) + '</b><span>implied launch value</span></div>' +
      '<div class="cell"><b>' + (row.tvl_usd > 0 ? (row.implied_value_usd / row.tvl_usd).toFixed(2) + '×' : 'n/a') + '</b><span>implied / TVL</span></div>' +
      '</div>' +
      '<div class="detailcolumns"><div class="modelbox"><h3>Why this value — the model, step by step</h3>' +
      '<div class="mrow"><span>TVL × peer multiple (' + row.category_multiple.toFixed(3) + ' for ' + esc(row.category || 'its category') + ')</span><b>' + fmtUsd(Math.round(row.tvl_usd * row.category_multiple)) + '</b></div>' +
      '<div class="mrow"><span>× growth multiplier (7d change ' + fmtPct(row.change_7d) + ', clamped)</span><b>× ' + row.growth_multiplier.toFixed(2) + '</b></div>' +
      '<div class="mrow"><span>× maturity multiplier (' + fmtAge(row.age_days) + ' tracked)</span><b>× ' + row.maturity_multiplier.toFixed(2) + '</b></div>' +
      '<div class="mrow"><span>× breadth multiplier (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')</span><b>× ' + row.breadth_multiplier.toFixed(2) + '</b></div>' +
      '<div class="mrow total"><span>Implied launch value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '<p class="verify">This page recomputes the same formula from the row\u2019s own figures and gets ' + usd.format(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : '.') + '</p>' +
      '</div>' +
      '<div class="farmbox"><h3>Conditional farm plan</h3><p class="hint">No rewards, assets or features verified by the snapshot. Budgets are illustrative ceilings.</p><ol class="farm">' + steps + '</ol></div></div>' +
      '</section>' + footer()
    );
  }

  function liveView() {
    var body = DATA.live.map(function (r) {
      return '<tr><td><span class="pname">' + esc(r.name) + '</span><br><span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d < 0 ? 'down' : 'up') + '">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
    return (
      header() +
      '<p class="lede" style="margin-bottom:12px">Positive market-cap records, separate from launch candidates. Current circulating cap is not historical launch FDV. Token records without a positive quoted cap: ' + DATA.unpriced_token_records + ' (not ranked or shown here).</p>' +
      '<table><thead><tr><th>Protocol</th><th>Chains</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">7d change</th></tr></thead><tbody>' + body + '</tbody></table>' +
      footer()
    );
  }

  function methodView() {
    var m = DATA.model;
    var g = m.global_peer;
    var fmt3 = function(v) { return v === null || v === undefined ? 'n/a' : v.toFixed(3); };
    var mults = DATA.category_multiples.map(function(c) {
      return '<tr><td>'+esc(c.family)+'</td><td class="num">'+c.n+'</td><td class="num">'+fmt3(c.rawMedian)+'</td><td class="num">'+fmt3(c.median)+'</td><td class="num">'+(c.q1===null||c.q3===null?'n/a':c.q1.toFixed(3)+'–'+c.q3.toFixed(3))+'</td><td class="num">'+c.clipped+'</td><td>'+(c.fallback==='family'?'family peers':'global median')+'</td><td>'+(c.typicalPeers&&c.typicalPeers.length?c.typicalPeers.map(esc).join(', '):'—')+'</td><td class="num">'+c.multiple.toFixed(3)+'×</td></tr>';
    }).join('');
    var sens = (DATA.sensitivity||[]).map(function(s) {
      return '<tr><td class="num">'+s.rank+'</td><td>'+esc(s.name)+'</td><td class="num">'+usd.format(s.conservative)+'</td><td class="num">'+usd.format(s.base)+'</td><td class="num">'+usd.format(s.generous)+'</td><td class="num">'+(s.rankLow===s.rankHigh?(''+s.rankLow):(s.rankLow+'–'+s.rankHigh))+'</td></tr>';
    }).join('');
    var val = DATA.validation||null;
    var valTable = function(rows) {
      return (rows||[]).map(function(r) {
        return '<tr><td>'+esc(r.variant)+'</td><td class="num">'+r.n+'</td><td class="num">'+r.medianLogErr.toFixed(3)+'</td><td class="num">'+(r.within2x*100).toFixed(0)+'%</td><td class="num">'+(r.within3x*100).toFixed(0)+'%</td></tr>';
      }).join('');
    };
    var valDecisions = val ? val.decisions.map(function(d) {
      return '<tr><td>'+esc(d.term)+'</td><td><strong>'+d.verdict.toUpperCase()+'</strong></td><td class="num">'+d.looWith.toFixed(3)+' → '+d.looWithout.toFixed(3)+'</td><td class="num">'+d.wfWith.toFixed(3)+' → '+d.wfWithout.toFixed(3)+'</td><td>'+esc(d.reason)+'</td></tr>';
    }).join('') : '';
    var valFam = val ? val.perFamily.map(function(p) {
      return '<tr><td>'+esc(p.family)+'</td><td class="num">'+p.n+'</td><td class="num">'+p.medianLogErr.toFixed(3)+'</td><td class="num">'+(p.within2x*100).toFixed(0)+'%</td></tr>';
    }).join('') : '';
    var odds = (DATA.launch_odds||[]).map(function(o) {
      return '<tr><td>'+esc(o.family)+'</td><td class="num">'+o.priced+'</td><td class="num">'+o.preToken+'</td><td class="num">'+(o.odds===null?'n/a':(o.odds*100).toFixed(0)+'%')+'</td></tr>';
    }).join('');
    return header()+'<section class="method"><h2>Transparent valuation</h2><p class="formula">TVL × peer multiple × growth × chain breadth</p><p>Calibrate from positive market-cap records at or above the watchlist TVL floor, excluding product-like records. Deduplicate by token identifier (symbol fallback; highest TVL wins). Bound each market-cap/TVL ratio to 0.05–2.00; compute the overall median, then shrink each family median towards it with weight n/(n+12). If no peer exists, use 0.30 as an explicit fallback.</p><p>Global peer pool: <strong>'+g.n+'</strong> peers · raw median <strong>'+fmt3(g.rawMedian)+'×</strong> · bounded median <strong>'+fmt3(g.median)+'×</strong> · IQR <strong>'+(g.q1===null?'n/a':g.q1.toFixed(3)+'–'+g.q3.toFixed(3))+'</strong> · clipped <strong>'+g.clipped+'</strong> · used multiple <strong>'+g.multiple.toFixed(3)+'×</strong></p><table><thead><tr><th>Family</th><th>Peers</th><th>Raw median</th><th>Bounded median</th><th>IQR</th><th>Clipped</th><th>Multiple from</th><th>Typical peers</th><th>Used multiple</th></tr></thead><tbody>'+mults+'</tbody></table><p class="hint">Raw median is the median of the unclipped market-cap/TVL ratios; bounded median and IQR are taken after clipping ratios to 0.05–2.00. “Clipped” counts the peers the band cut. Families with no peers fall back to the global median and say so; typical peers are the three records nearest the family median.</p><h3>Scenario sensitivity — top 10</h3><p>Each row re-priced with its family’s lower-quartile multiple (conservative) and upper-quartile multiple (generous), shrunk toward the global quartile the same way the base multiple is. The rank range is the row’s best and worst rank across the three scenarios: a row that stays put is a robust call, one that swings is a calibration artefact wearing a rank.</p><table><thead><tr><th>Rank</th><th>Protocol</th><th>Conservative</th><th>Base</th><th>Generous</th><th>Rank range</th></tr></thead><tbody>'+sens+'</tbody></table><h3>Held-out validation — '+val.peers+' priced peers</h3><p>Every value term is fitted on training folds only and tested on priced peers it never saw. Leave-one-out calibrates without the peer and predicts its market cap; walk-forward fits on the lower-TVL half and tests the upper, then the reverse. A term is dropped only when removing it improves <em>both</em> tests by at least 0.02 in median log10 error — one test, or a smaller move, is noise at n='+val.peers+'.</p><h4>Leave-one-out</h4><table><thead><tr><th>Variant</th><th>Peers</th><th>Median |log10 error|</th><th>Within 2×</th><th>Within 3×</th></tr></thead><tbody>'+valTable(val.loo)+'</tbody></table><h4>Walk-forward by TVL</h4><table><thead><tr><th>Variant</th><th>Peers</th><th>Median |log10 error|</th><th>Within 2×</th><th>Within 3×</th></tr></thead><tbody>'+valTable(val.walkForward)+'</tbody></table><h4>Keep / drop decisions</h4><table><thead><tr><th>Term</th><th>Verdict</th><th>Leave-one-out (with → without)</th><th>Walk-forward (with → without)</th><th>Why</th></tr></thead><tbody>'+valDecisions+'</tbody></table><h4>Per-family leave-one-out error, full model</h4><table><thead><tr><th>Family</th><th>Peers</th><th>Median |log10 error|</th><th>Within 2×</th></tr></thead><tbody>'+valFam+'</tbody></table><h3>Launch odds from the peers’ record</h3><p>Priced / (priced + pre-token) per family, from the snapshot’s own records — a descriptive statistic, not a forecast. A family with no priced peers has no odds to state.</p><table><thead><tr><th>Family</th><th>Priced</th><th>Pre-token</th><th>Odds</th></tr></thead><tbody>'+odds+'</tbody></table><h3>Bounded adjustments</h3><p>Growth: 1 + clamp(7d TVL change, −40%, +60%) × 0.25 / 100 (0.90–1.15); missing = 0%. Maturity: tested held-out in radar-9 and removed — it raised the error on both blind tests, so the multiplier is 1 for every row. Breadth: 1 + 0.02 × min(max(chain count−1, 0), 5). These are heuristic, not fitted launch effects.</p><h3>Coverage — every record accounted for</h3><p>The four buckets below are mutually exclusive and sum to the snapshot total of <strong>'+DATA.coverage.total+'</strong> records, so nothing is double-counted or quietly dropped. The live view shows priced records except CEX rows ('+DATA.coverage.pricedNonCex+' of '+DATA.coverage.priced+'); that is a different cut of the same priced bucket, not a mismatch.</p><table><thead><tr><th>Bucket</th><th>Records</th><th>Rule</th></tr></thead><tbody><tr><td>Ranked, on the watchlist</td><td class="num">'+DATA.coverage.rankedWatchlist+'</td><td>Every watchlist slug, always on the board</td></tr><tr><td>Ranked, outside the watchlist, below the floor</td><td class="num">'+DATA.coverage.rankedOutsideBelowFloor+'</td><td>Pre-token, not product-like, TVL under $'+(DATA.floor_usd/1000000)+'M</td></tr><tr><td>Ranked, outside the watchlist, at or above the floor</td><td class="num">'+DATA.coverage.rankedOutsideAtFloor+'</td><td>Pre-token, not product-like, TVL at or above $'+(DATA.floor_usd/1000000)+'M — admitted by the observable rule, parent relation unverifiable from the snapshot, so they stay provisional</td></tr><tr><td>Not ranked: pre-token but product-like</td><td class="num">'+DATA.coverage.preTokenExcluded+'</td><td>Wrapped, staked, bridged, versioned or exchange product of a token that already trades</td></tr><tr><td>Not ranked: priced live token</td><td class="num">'+DATA.coverage.priced+'</td><td>Positive market cap; shown in the Priced tokens view except CEX rows</td></tr><tr><td>Not ranked: token evidence, unpriced</td><td class="num">'+DATA.coverage.unpricedTokenEvidence+'</td><td>A Gecko id or symbol is recorded but no positive market cap</td></tr></tbody></table><h3>Limitations</h3><p>All '+DATA.watchlist_covered+' official watchlist rows are included; '+DATA.outside_size+' more pass observable category, name and token-field screens. '+DATA.early_size+' are below the floor. Parent-protocol relationships are absent from the snapshot, so outside-watchlist candidates remain provisional. No token recorded is not proof of no token. “Unverified” on a board row means outside the watchlist: the row passed the observable screens, but the snapshot cannot prove it is an independent launch.</p><p>Current circulating cap is a proxy for conditional launch market cap, not FDV or historical launch calibration. TVL can be duplicated or driven by incentives; category labels, short-term TVL changes and tracking age are imperfect. Held out, the model predicts a priced peer’s market cap within about 3× at the median — implied values are order-of-magnitude estimates, not precise prices. Launch odds are the share of a family’s snapshot protocols that already have a token, not a forecast. No airdrop probability, distribution or return is inferred. The model is deterministic and uses only sealed input.</p></section>'+footer();
  }

  function render() {
    var html;
    if (state.view === 'detail' && state.slug) {
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.slug) row = r; });
      if (!row) { state.view = 'board'; state.slug = null; }
      html = row ? detailView(row) : boardView();
    } else if (state.view === 'live') html = liveView();
    else if (state.view === 'method') html = methodView();
    else html = boardView();
    app.className = state.view === 'detail' ? 'detail-page' : '';
    app.innerHTML = html;
    syncUrl();
    bind();
    var count = document.getElementById('count');
    if (count && (state.view === 'board')) count.textContent = filtered().length + ' of ' + DATA.rows.length + ' shown';
  }

  function bind() {
    var tabs = app.querySelectorAll('nav.tabs button');
    tabs.forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); render(); });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; render(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
    var cat = document.getElementById('category');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    var watch = document.getElementById('watch');
    if (watch) watch.addEventListener('change', function () { state.watchOnly = watch.checked; render(); });
    var below = document.getElementById('below');
    if (below) below.addEventListener('change', function () { state.belowFloor = below.checked; render(); });
    var sort = document.getElementById('sort');
    if (sort) sort.addEventListener('change', function () { state.sort = sort.value; state.dir = sort.value === 'rank' ? 1 : -1; render(); });
    app.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var s = th.getAttribute('data-sort');
        if (state.sort === s) state.dir = -state.dir; else { state.sort = s; state.dir = -1; }
        var sel = document.getElementById('sort'); if (sel) sel.value = s;
        render();
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      function open() { state.slug = tr.getAttribute('data-slug'); state.view = 'detail'; render(); window.scrollTo(0, 0); }
      tr.addEventListener('click', open); tr.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();open();} });
    });
    var back = document.getElementById('back');
    if (back) back.addEventListener('click', function () { state.view = 'board'; render(); });
  }

  render();
})();
