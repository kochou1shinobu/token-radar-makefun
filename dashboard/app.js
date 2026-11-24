// Token Launch Radar's dashboard (model radar-2). It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a live-token view kept apart from the ranking, a method
// page that states the model, and a detail view for every protocol with its model breakdown and
// farm plan. No network: every byte it shows is in data.js. The detail view recomputes the implied
// value from the row's own figures with the same formula lib/model.ts uses, and says so when the
// recomputation matches the board — the page and the code are the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
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
    dir: -1,
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

  // The model, recomputed in the page: identical constants and formula to lib/model.ts (radar-2).
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
      if (av !== bv) return state.dir * (av - bv);
      return a.rank - b.rank;
    });
    return rows;
  }

  function header() {
    return (
      '<header class="top">' +
      '<p class="eyebrow">Token Launch Radar · model ' + esc(DATA.model_version) + '</p>' +
      '<h1>Which pre-token protocol launches biggest?</h1>' +
      '<p class="lede">Every protocol in the snapshot that <strong>records no token</strong> and is not a wrapped, staked or bridged product of one that trades, ranked by what its launch would be worth under one stated model — each with the steps to farm it. Implied value is this board\u2019s own claim from the snapshot\u2019s figures, not a prediction that a token will come.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.rows.length + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat hot"><b>' + DATA.early_size + '</b><span>early finds below the $50M floor</span></div>' +
      '<div class="stat"><b>' + DATA.total_pre_token + '</b><span>pre-token in snapshot</span></div>' +
      '<div class="stat"><b>' + DATA.live_size + '</b><span>live tokens set aside</span></div>' +
      '<div class="stat"><b>' + esc(DATA.as_of) + '</b><span>snapshot date</span></div>' +
      '</div>' +
      '<nav class="tabs" role="tablist">' +
      '<button data-view="board" aria-selected="' + (state.view === 'board' || state.view === 'detail') + '">The board</button>' +
      '<button data-view="live" aria-selected="' + (state.view === 'live') + '">Live tokens (not ranked)</button>' +
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
      '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(state.q) + '">' +
      '<select id="category">' + catOpts + '</select>' +
      '<select id="chain">' + chainOpts + '</select>' +
      '<select id="sort">' + sortOpts + '</select>' +
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
        '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.on_watchlist ? '<span class="badge">watchlist</span>' : '<span class="badge early">early</span>') +
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
      '<p class="eyebrow">Rank #' + row.rank + ' of ' + DATA.rows.length + (row.on_watchlist ? ' · on the house watchlist' : ' · early find below the watchlist floor') + '</p>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="lede">' + esc(row.category || 'Uncategorised') + ' · ' + esc(row.chains.join(', ') || 'no chains recorded') + ' · tracked by DefiLlama since ' + esc(row.listed_at || 'an unrecorded date') + '</p>' +
      '<div class="grid">' +
      '<div class="cell"><b>' + fmtUsd(row.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="cell"><b>' + fmtPct(row.change_7d) + '</b><span>TVL change, 7d</span></div>' +
      '<div class="cell"><b>' + fmtAge(row.age_days) + '</b><span>age with no token</span></div>' +
      '<div class="cell"><b>' + row.chains.length + '</b><span>chains</span></div>' +
      '<div class="cell"><b>' + fmtUsd(row.implied_value_usd) + '</b><span>implied launch value</span></div>' +
      '<div class="cell"><b>' + (row.tvl_usd > 0 ? (row.implied_value_usd / row.tvl_usd).toFixed(2) + '×' : 'n/a') + '</b><span>implied / TVL</span></div>' +
      '</div>' +
      '<div class="modelbox"><h3>Why this value — the model, step by step</h3>' +
      '<div class="mrow"><span>TVL × category multiple (' + row.category_multiple.toFixed(2) + ' for ' + esc(row.category || 'its category') + ')</span><b>' + fmtUsd(Math.round(row.tvl_usd * row.category_multiple)) + '</b></div>' +
      '<div class="mrow"><span>× growth multiplier (7d change ' + fmtPct(row.change_7d) + ', clamped)</span><b>× ' + row.growth_multiplier.toFixed(2) + '</b></div>' +
      '<div class="mrow"><span>× maturity multiplier (' + fmtAge(row.age_days) + ' with no token)</span><b>× ' + row.maturity_multiplier.toFixed(2) + '</b></div>' +
      '<div class="mrow"><span>× breadth multiplier (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')</span><b>× ' + row.breadth_multiplier.toFixed(2) + '</b></div>' +
      '<div class="mrow total"><span>Implied launch value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '<p class="verify">This page recomputes the same formula from the row\u2019s own figures and gets ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : '.') + '</p>' +
      '</div>' +
      '<div class="farmbox"><h3>How to farm it</h3><ol class="farm">' + steps + '</ol></div>' +
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
      '<p class="lede" style="margin-bottom:12px">These protocols already have a token that trades, so the radar does not rank them — it shows the market\u2019s own value for them, as the scale a launch is measured against.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Chains</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">7d change</th></tr></thead><tbody>' + body + '</tbody></table>' +
      footer()
    );
  }

  function methodView() {
    var m = DATA.model;
    var mults = DATA.category_multiples.map(function (c) {
      return '<tr><td>' + esc(c.family) + '</td><td class="num">' + c.multiple.toFixed(2) + '× TVL</td></tr>';
    }).join('');
    return (
      header() +
      '<section class="method"><h3>The model (' + esc(DATA.model_version) + ')</h3>' +
      '<p class="formula">implied = TVL × category multiple × growth multiplier × maturity multiplier × breadth multiplier</p>' +
      '<p><strong>Growth.</strong> The 7-day TVL change, clamped to ' + m.growth_floor + '%…+' + m.growth_cap + '%, becomes <code>1 + (growth / 100) × ' + m.growth_weight + '</code>: a protocol growing 50% in a week is worth about 30% more than a flat one of the same size, and a shrinking one is marked down, never to zero.</p>' +
      '<p><strong>Maturity.</strong> <code>' + m.maturity_floor + ' + ' + m.maturity_range + ' × min(age, ' + m.maturity_days + ' days) / ' + m.maturity_days + '</code>: every extra year a protocol has run at size with no token is evidence its launch, if it comes, is a real event and not a wrapper. An unrecorded listing date counts as ' + m.unknown_age_days + ' days.</p>' +
      '<p><strong>Breadth.</strong> <code>1 + ' + m.breadth_per_chain + ' × min(chains − 1, ' + m.breadth_max_extra_chains + ')</code>: a protocol live on more chains reaches more wallets that a launch would drop to.</p>' +
      '<h3>Category multiples</h3>' +
      '<p>Venues that intermediate order flow have historically launched at a higher value per dollar of TVL than passive yield or lending books, so the model prices the business, not just the balance:</p>' +
      '<table><thead><tr><th>Family</th><th class="num">Base</th></tr></thead><tbody>' + mults + '</tbody></table>' +
      '<h3>Who is on the board — and who is not</h3>' +
      '<p>The board ranks every protocol whose snapshot record shows no token (no market cap, no CoinGecko id, no symbol) after removing the products of tokens that already trade: categories Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX, names ending in a version marker, names carrying the whole word wrapped, staked or staking, and names beginning with an exchange\u2019s name. The house watchlist — the same rule above a $50M TVL floor — is the floor of the board, never its ceiling: ' + DATA.early_size + ' of the ' + DATA.rows.length + ' ranked protocols sit below that floor. Protocols with a live token are never ranked; they are shown apart, at market value, on the Live tokens tab.</p>' +
      '<p>No protocol name is special-cased anywhere in the model: one function scores every row from its own figures, and the detail view of every row shows the arithmetic and recomputes it in the page.</p>' +
      '</section>' + footer()
    );
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
      tr.addEventListener('click', function () { state.slug = tr.getAttribute('data-slug'); state.view = 'detail'; render(); window.scrollTo(0, 0); });
    });
    var back = document.getElementById('back');
    if (back) back.addEventListener('click', function () { state.view = 'board'; render(); });
  }

  render();
})();
