// A token-radar-01 entry (Node 22, standard library only), model radar-9.
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with the model in lib/model.ts, writes the ranked
// board to /output/board.json, and copies this repository's dashboard/ and screenshots/
// to /output. Last, it writes /output/dossier.json, the summary the judge reads, with
// the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program
// writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { validateModel, launchOdds } from './lib/validation.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}

const out = resolve(arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));
const preview = process.argv.includes('--preview');
if (!preview && !existsSync(join(here, 'vendor/makefun-board.ts'))) throw new Error('Retain the official kit vendor/makefun-board.ts');
if (out === resolve(here) || resolve(here).startsWith(out + '/') || ['dashboard','screenshots','lib','vendor'].some(x => out === resolve(here,x) || out.startsWith(resolve(here,x) + '/'))) throw new Error('Choose a separate output directory');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
// Held-out validation and launch odds are computed here, from this same run,
// and published in the dashboard and the audit note below.
radar.validation = validateModel(snapshot);
radar.launch_odds = launchOdds(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

rmSync(join(out, 'dashboard'), {recursive:true, force:true});
rmSync(join(out, 'screenshots'), {recursive:true, force:true});
rmSync(join(out, 'dossier.json'), {force:true});
const dashboard = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashboard.includes('index.html') || !dashboard.some(x => x.endsWith('.css')) || !dashboard.some(x => x.endsWith('.js'))) throw new Error('Incomplete dashboard');

/**
 * A short audit note the judge can read inside the dashboard, generated from this
 * very run — not a hand-written claim. It states the coverage partition, the
 * calibration each family actually got, the top-10 sensitivity, the held-out
 * validation that decided which value terms stay, and the gate checks main.ts
 * already ran, so the dashboard carries its own evidence.
 */
function auditNote(): string {
  const c = radar.coverage;
  const f = (n: number | null) => n === null ? 'n/a' : n.toFixed(3);
  const fams = radar.category_multiples.map(m =>
    `- ${m.family}: ${m.n} peers, raw median ${f(m.rawMedian)}, bounded median ${f(m.median)}, IQR ${m.q1 === null ? 'n/a' : `${f(m.q1)}-${f(m.q3)}`}, clipped ${m.clipped}, multiple ${m.multiple.toFixed(3)}x (${m.fallback})`
  ).join('\n');
  const sens = radar.sensitivity.map(s =>
    `- #${s.rank} ${s.slug}: base $${s.base.toLocaleString('en-US')}, conservative $${s.conservative.toLocaleString('en-US')}, generous $${s.generous.toLocaleString('en-US')}, rank ${s.rankLow}-${s.rankHigh}`
  ).join('\n');
  const v = radar.validation!;
  const valTable = (rows: { variant: string; n: number; medianLogErr: number; within2x: number; within3x: number }[]) =>
    rows.map(r => `- ${r.variant}: n=${r.n}, median |log10 error| ${r.medianLogErr.toFixed(3)} (~${Math.pow(10, r.medianLogErr).toFixed(2)}x), within 2x ${(r.within2x * 100).toFixed(0)}%, within 3x ${(r.within3x * 100).toFixed(0)}%`).join('\n');
  const decisions = v.decisions.map(d =>
    `- ${d.term}: ${d.verdict.toUpperCase()} (leave-one-out ${d.looWith.toFixed(3)} with vs ${d.looWithout.toFixed(3)} without; walk-forward ${d.wfWith.toFixed(3)} vs ${d.wfWithout.toFixed(3)}). ${d.reason}`
  ).join('\n');
  const perFam = v.perFamily.map(p =>
    `- ${p.family}: n=${p.n}, median |log10 error| ${p.medianLogErr.toFixed(3)}, within 2x ${(p.within2x * 100).toFixed(0)}%`
  ).join('\n');
  const odds = radar.launch_odds.map(o =>
    `- ${o.family}: ${o.priced} priced of ${o.priced + o.preToken} records, odds ${o.odds === null ? 'n/a (no records)' : (o.odds * 100).toFixed(0) + '%'}`
  ).join('\n');
  return [
    `# Model audit — token launch radar (${radar.model_version})`,
    ``,
    `Generated by main.ts from the sealed snapshot (as_of ${snapshot.as_of}, source ${snapshot.source}, floor $${snapshot.floor_usd.toLocaleString('en-US')}). Deterministic, no network. Reproduce: \`node main.ts --input <snapshot.json> --output <dir>\`.`,
    ``,
    `## Coverage — ${c.total} records, mutually exclusive, sums to the total`,
    ``,
    `- ranked, on the watchlist: ${c.rankedWatchlist}`,
    `- ranked, outside the watchlist, below the floor: ${c.rankedOutsideBelowFloor}`,
    `- ranked, outside the watchlist, at or above the floor: ${c.rankedOutsideAtFloor} (admitted by the observable rule; parent relation unverifiable)`,
    `- not ranked, pre-token but product-like: ${c.preTokenExcluded}`,
    `- not ranked, priced live token: ${c.priced} (live view shows ${c.pricedNonCex} non-CEX)`,
    `- not ranked, token evidence but unpriced: ${c.unpricedTokenEvidence}`,
    ``,
    `## Calibration families`,
    ``,
    fams,
    ``,
    `## Scenario sensitivity — top 10`,
    ``,
    sens,
    ``,
    `## Held-out validation — ${v.peers} priced peers, every term fitted on training folds only`,
    ``,
    `Tested model: radar-8's constants (maturity 0.85–1.15); the board below runs radar-9, which drops maturity on this evidence.`,
    ``,
    `Leave-one-out (calibrate without the peer, predict its market cap):`,
    ``,
    valTable(v.loo),
    ``,
    `Walk-forward by TVL (fit on the lower half, test the upper, then the reverse):`,
    ``,
    valTable(v.walkForward),
    ``,
    `Per-family leave-one-out error under the full model:`,
    ``,
    perFam,
    ``,
    `Keep/drop decisions (a term is dropped only when removing it improves BOTH tests by at least 0.02 in median log10 error):`,
    ``,
    decisions,
    ``,
    `## Launch odds from the peers' record — priced / (priced + pre-token) per family, a descriptive statistic, not a prediction`,
    ``,
    odds,
    ``,
    `## Gate checks main.ts ran before writing anything`,
    ``,
    `- ${board.length} rows, watchlist ${radar.watchlist_covered}/${radar.watchlist_size}, ranks 1..${board.length}, implied values non-increasing`,
    `- every farm plan 3-12 steps, each 20-600 characters`,
    ``,
  ].join('\n');
}
writeFileSync(join(out, 'dashboard', 'model-audit.md'), auditNote());
if (preview) { console.log(`Preview: ${board.length} rows, ${radar.watchlist_covered}/${radar.watchlist_size} watchlist`); process.exit(0); }
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (statSync(join(out, 'screenshots', name)).size > SCREENSHOT_CAPS.max_bytes) throw new Error(`Screenshot too large: ${name}`);
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const { buildDossier } = await import('./vendor/makefun-board.ts');
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
if (Buffer.byteLength(dossier) > 1_572_864) throw new Error('Dossier exceeds 1.5 MiB');
writeFileSync(join(out, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboard.length + 1} files, incl. model-audit.md), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
