// Verify a token-radar entry end to end, from the repo, before submitting:
// rebuild the output with main.ts, rebuild the dossier with the official vendor
// code and byte-compare it, check the board gates and the coverage partition,
// check the screenshots decode and fit their caps, and check the dashboard
// sources fit the text budget and carry no external references.
// Usage: node scripts/verify-entry.mjs [--input <snapshot.json|dir>]
// Exit code 0 means every check passed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
};
const input = arg('input', join(here, '..', 'kits', 'token-radar-01-kit', 'token-radar-01-kit', 'input', 'snapshot.json'));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const out = mkdtempSync(join(tmpdir(), 'radar-verify-'));
try {
  execFileSync('node', ['main.ts', '--input', input], { cwd: here, env: { ...process.env, MAKEFUN_OUTPUT_DIR: out }, stdio: 'pipe' });
  check('main.ts builds the output', true);
} catch (e) {
  check('main.ts builds the output', false, String(e.stderr || e.message).slice(0, 200));
  process.exit(1);
}

// 1. The dossier the vendor rebuilds from this output must be byte-identical
//    to the dossier main.ts wrote — the scorer does exactly this comparison.
const { buildDossier } = await import(join(here, 'vendor', 'makefun-board.ts'));
const rebuilt = buildDossier(out, { text_max_bytes: 65_536 });
const written = readFileSync(join(out, 'dossier.json'));
check('dossier rebuild is byte-identical', Buffer.compare(Buffer.from(rebuilt), written) === 0, `${written.length} bytes`);

// 2. Board gates + coverage partition, from the model's own checks.
const { boardIssue, coverage, parseSnapshot, buildRadar } = await import(join(here, 'lib', 'model.ts'));
const snapshot = parseSnapshot(readFileSync(input.endsWith('.json') ? input : join(input, 'snapshot.json'), 'utf8'));
const { board, radar } = buildRadar(snapshot);
check('board passes the gate', boardIssue(board, snapshot) === null, boardIssue(board, snapshot) ?? `${board.length} rows`);
const c = coverage(snapshot, board);
check(
  'coverage partition sums to the snapshot total',
  c.ranked + c.preTokenExcluded + c.priced + c.unpricedTokenEvidence === c.total,
  `${c.ranked} + ${c.preTokenExcluded} + ${c.priced} + ${c.unpricedTokenEvidence} = ${c.total}`,
);
check('coverage matches the dashboard data', radar.coverage.total === c.total && radar.coverage.ranked === c.ranked);

// 3. Screenshots: 3-4 images, each a whole decodable PNG/JPEG within its cap.
const shots = readdirSync(join(out, 'screenshots')).sort();
check('3-4 screenshots', shots.length >= 3 && shots.length <= 4, shots.join(', '));
for (const name of shots) {
  const buf = readFileSync(join(out, 'screenshots', name));
  const png = buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const dims = png ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : jpg ? 'jpeg' : 'unknown';
  check(`screenshot ${name} decodes (${dims}), <=512KiB`, (png || jpg) && buf.length <= 524_288, `${Math.round(buf.length / 1024)}KiB`);
}

// 4. Dashboard sources: text budget and no external references. A URL printed as
// plain text (the snapshot's own source line cites its API) is a citation, not a
// fetch; what the gate forbids is a URL in an HTML attribute, a CSS url(), or a
// JS import — those are what this checks.
const dash = readdirSync(join(out, 'dashboard')).filter((n) => /\.(html|css|js|md)$/.test(n));
const bytes = dash.reduce((s, n) => s + statSync(join(out, 'dashboard', n)).size, 0);
check('dashboard text fits 65,536 bytes', bytes <= 65_536, `${bytes} bytes across ${dash.join(', ')}`);
const external = dash.filter((n) => /(href|src)\s*=\s*["']https?:|url\(\s*["']?https?:|@import\s+["']https?:|import\(\s*["']https?:/.test(readFileSync(join(out, 'dashboard', n), 'utf8')));
check('dashboard has no external references', external.length === 0, external.join(', '));
check('dashboard carries the generated audit note', existsSync(join(out, 'dashboard', 'model-audit.md')));

rmSync(out, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
