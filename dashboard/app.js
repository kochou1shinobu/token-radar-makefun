// Token Launch Radar's dashboard (model radar-3). It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a live-token view kept apart from the ranking, a method
// page that states the model, and a detail view for every protocol with its model breakdown and
// farm plan. No network: every byte it shows is in data.js. The detail view recomputes the implied
// value from the row's own figures with the same formula lib/model.ts uses, and says so when the
// recomputation matches the board — the page and the code are the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) { document.getElementById('board').textContent = 'Data missing. Run main.ts to build the dashboard.'; return; }
  var app = document.getElementById('board');
  app.removeAttribute('aria-busy');

  var params = new URLSearchParams(location.search);
  var state = {
    view: params.get('view') || 'board', // board | live | method | detail
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    watchOnly: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    dir: params.get('sort') === 'rank' ? 1 : -1,
    slug: params.get('slug') || null,
  };

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

  // The model, recomputed in the page: identical constants and formula to lib/model.ts (radar-3).
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
      '<div class="stat"><b>' + DATA.total_pre_token + '</b><span>no token recorded</span></div>' +
      '<div class="stat"><b>' + DATA.live_size + '</b><span>priced token records</span></div>' +
      '<div class="stat"><b>' + esc(DATA.as_of) + '</b><span>snapshot date</span></div>' +
      '</div>' +
      '<nav class="tabs" role="tablist">' +
      '<button data-view="board" aria-selected="' + (state.view === 'board' || state.view === 'detail') + '">The board</button>' +
      '<button data-view="live" aria-selected="' + (state.view === 'live') + '">Priced tokens (not ranked)</button>' +
      '<button data-view="method" aria-selected="' + (state.view === 'method') + '">How the model works</button>' +
      '</nav></header>'
    );
  }

  function footer() {
    return '<footer>Data: ' + esc(DATA.source) + '. “Records no token” is what the snapshot\u2019s record shows — a protocol may still have a token its record does not carry. Farm plans are a starting point, not financial advice; never pay to claim an airdrop.</footer>';
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
    return (
      header() + controls() +
      '<table><thead><tr>' +
      '<th>#</th><th>Protocol</th><th>Chains</th>' +
      '<th class="num sortable" data-sort="tvl">TVL</th>' +
      '<th class="num sortable" data-sort="growth">7d change</th>' +
      '<th class="num sortable" data-sort="age">Age</th>' +
      '<th class="num sortable" data-sort="implied">Implied value</th>' +
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
    var mults = DATA.category_multiples.map(function(c) { return '<tr><td>'+esc(c.family)+'</td><td class="num">'+c.n+'</td><td class="num">'+(c.median===null?'n/a':c.median.toFixed(3))+'</td><td class="num">'+c.multiple.toFixed(3)+'×</td></tr>'; }).join('');
    return header()+'<section class="method"><h2>Transparent valuation</h2><p class="formula">TVL × peer multiple × growth × tracking maturity × chain breadth</p><p>Calibrate from positive market-cap records at or above the watchlist TVL floor, excluding product-like records. Deduplicate by token identifier (symbol fallback; highest TVL wins). Bound each market-cap/TVL ratio to 0.05–2.00; compute the overall median, then shrink each family median towards it with weight n/(n+12). If no peer exists, use 0.30 as an explicit fallback.</p><p>Global peer pool: <strong>'+m.global_peer.n+'</strong> · median / fallback: <strong>'+m.global_peer.multiple.toFixed(3)+'×</strong></p><table><thead><tr><th>Family</th><th>Peers</th><th>Bounded median</th><th>Used multiple</th></tr></thead><tbody>'+mults+'</tbody></table><h3>Bounded adjustments</h3><p>Growth: 1 + clamp(7d TVL change, −40%, +60%) × 0.25 / 100 (0.90–1.15); missing = 0%. Maturity: 0.85 + 0.30 × min(tracking age, 1460 days)/1460; missing = 730 days. Breadth: 1 + 0.02 × min(max(chain count−1, 0), 5). These are heuristic, not fitted launch effects.</p><h3>Coverage and limitations</h3><p>All '+DATA.watchlist_covered+' official watchlist rows are included; '+DATA.outside_size+' more pass observable category, name and token-field screens. '+DATA.early_size+' are below the floor. Parent-protocol relationships are absent from the snapshot, so outside-watchlist candidates remain provisional. No token recorded is not proof of no token.</p><p>Current circulating cap is a proxy for conditional launch market cap, not FDV or historical launch calibration. TVL can be duplicated or driven by incentives; category labels, short-term TVL changes and tracking age are imperfect. No airdrop probability, distribution or return is inferred. The model is deterministic and uses only sealed input.</p></section>'+footer();
  }

  function render() {
    var html;
    if (state.view === 'detail' && state.slug) {
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.slug) row = r; });
      html = row ? detailView(row) : boardView();
    } else if (state.view === 'live') html = liveView();
    else if (state.view === 'method') html = methodView();
    else html = boardView();
    app.className = state.view === 'detail' ? 'detail-page' : '';
    app.innerHTML = html;
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
