// Records one order-book / open-interest / funding snapshot per coin every 5 minutes for `--minutes` (default 55), appending to
// book/<UTC date>.jsonl (one JSON object per line). Same fields as the app repo's scripts/collect-book.ts so the files can be merged.
// Snapshots are public exchange data. Run by .github/workflows/collect.yml.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';

const PAIRS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT', ADA: 'ADAUSDT', AVAX: 'AVAXUSDT', LINK: 'LINKUSDT', DOT: 'DOTUSDT' };
const SPOT = 'https://data-api.binance.vision';
const FAPI = 'https://fapi.binance.com';
const minutes = Number(process.argv.find((a) => a.startsWith('--minutes='))?.slice(10) ?? 55);
const STEP = 300000;
const SAVE = process.argv.includes('--save'); // commit + push the new data every 15 minutes (used in CI)
const NEWS = process.argv.includes('--news'); // also record headlines (news.mjs) at the start and every 20 minutes, so one job keeps both going

const get = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

/** (bid - ask) / (bid + ask) volume over the top `levels` levels or within `bps` of the mid price. */
function imbalance(d, { levels, bps }) {
  const bids = d.bids.map(([p, q]) => [+p, +q]);
  const asks = d.asks.map(([p, q]) => [+p, +q]);
  const mid = (bids[0][0] + asks[0][0]) / 2;
  const within = (p) => (bps === undefined ? true : Math.abs(p / mid - 1) <= bps / 1e4);
  const sum = (side) => side.slice(0, levels ?? side.length).filter(([p]) => within(p)).reduce((a, [, q]) => a + q, 0);
  const b = sum(bids), a = sum(asks);
  return b + a > 0 ? (b - a) / (b + a) : 0;
}

async function once() {
  const t = Date.now();
  const lines = await Promise.all(
    Object.entries(PAIRS).map(async ([sym, pair]) => {
      try {
        const [depth, oi, prem] = await Promise.all([
          get(`${SPOT}/api/v3/depth?symbol=${pair}&limit=100`),
          get(`${FAPI}/fapi/v1/openInterest?symbol=${pair}`).catch(() => null),
          get(`${FAPI}/fapi/v1/premiumIndex?symbol=${pair}`).catch(() => null),
        ]);
        return JSON.stringify({ t, sym, obi20: imbalance(depth, { levels: 20 }), obi10bp: imbalance(depth, { bps: 10 }), obi50bp: imbalance(depth, { bps: 50 }), oi: oi ? +oi.openInterest : null, funding: prem ? +prem.lastFundingRate : null });
      } catch {
        return null;
      }
    }),
  );
  const ok = lines.filter(Boolean);
  if (ok.length) {
    mkdirSync('book', { recursive: true });
    appendFileSync(`book/${new Date(t).toISOString().slice(0, 10)}.jsonl`, ok.join('\n') + '\n');
  }
  console.log(`${new Date(t).toISOString()} wrote ${ok.length}/${Object.keys(PAIRS).length} snapshots (futures data ${ok.some((l) => JSON.parse(l).oi !== null) ? 'ok' : 'UNAVAILABLE from this network'})`);
}

/** Commits and pushes book/ (best effort, retried after a rebase when another run pushed first). */
function save() {
  if (!SAVE) return;
  const git = (...a) => spawnSync('git', a, { stdio: 'inherit' }).status === 0;
  git('add', 'book');
  if (spawnSync('git', ['diff', '--cached', '--quiet']).status === 0) return;
  git('commit', '-qm', `snapshots ${new Date().toISOString()}`);
  for (let i = 0; i < 3; i++) if (git('pull', '-q', '--rebase', 'origin', 'main') && git('push', '-q', 'origin', 'HEAD:main')) break;
}

/** Records headlines with news.mjs (it saves them itself when run with --save). */
function news() {
  if (!NEWS) return;
  spawnSync('node', ['news.mjs', ...(SAVE ? ['--save'] : [])], { stdio: 'inherit' });
}

const stop = Date.now() + minutes * 60000;
let rounds = 0;
news();
await once();
while (true) {
  const next = Date.now() - (Date.now() % STEP) + STEP + 2000; // just after each 5-minute boundary
  if (next > stop) break;
  await new Promise((r) => setTimeout(r, next - Date.now()));
  await once().catch((e) => console.error(String(e)));
  if (++rounds % 3 === 0) save();
  if (rounds % 4 === 0) news();
}
save();
