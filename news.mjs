// Records crypto headlines from public RSS feeds into news/<UTC date>.jsonl: id, feed, pub (publisher time, ms), seen (when we first saw it, ms), title, url.
// Only the headline and link are kept (no article text). RSS feeds hold just the latest 20-40 items, so this must run regularly (news.yml, every 20 minutes);
// there is no history to download afterwards. Pass --save to commit and push (CI).
// Why: to test, out-of-sample and after a few weeks of data, whether headline volume or tone predicts the next hour (the app repo's `npm run research`).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';

const FEEDS = {
  cointelegraph: 'https://cointelegraph.com/rss',
  decrypt: 'https://decrypt.co/feed',
  theblock: 'https://www.theblock.co/rss.xml',
  coindesk: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
};
const SAVE = process.argv.includes('--save');
const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const clean = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => entities[m] ?? m).replace(/\s+/g, ' ').trim();
const tag = (block, name) => clean(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '');

/** Drops utm_* tracking parameters so the same article always has the same link (and id). */
function stripTracking(u) {
  try { const x = new URL(u); [...x.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => x.searchParams.delete(k)); return x.toString(); } catch { return u; }
}

function parse(xml) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(([b]) => {
    const pub = Date.parse(tag(b, 'pubDate') || tag(b, 'dc:date'));
    return { title: tag(b, 'title'), url: stripTracking(tag(b, 'link') || tag(b, 'guid')), pub: Number.isFinite(pub) ? pub : null };
  }).filter((x) => x.title && x.url);
}

const dir = 'news';
mkdirSync(dir, { recursive: true });
const known = new Set();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().slice(-4)) // today and the last few days are enough: feeds only hold hours
  for (const line of readFileSync(`${dir}/${f}`, 'utf8').split('\n')) { try { known.add(JSON.parse(line).id); } catch { /* blank */ } }

const seen = Date.now();
let added = 0;
const lines = [];
for (const [feed, url] of Object.entries(FEEDS)) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; signalpilot-research/1.0)', Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parse(await res.text());
    let n = 0;
    for (const it of items) {
      const id = createHash('sha1').update(it.url).digest('hex').slice(0, 16);
      if (known.has(id)) continue;
      known.add(id);
      lines.push(JSON.stringify({ id, feed, pub: it.pub, seen, title: it.title, url: it.url }));
      n++;
    }
    added += n;
    console.log(`${feed.padEnd(14)} ${items.length} items in feed, ${n} new`);
  } catch (e) {
    console.log(`${feed.padEnd(14)} FAILED: ${e.message}`);
  }
}
if (lines.length) appendFileSync(`${dir}/${new Date(seen).toISOString().slice(0, 10)}.jsonl`, lines.join('\n') + '\n');
console.log(`${new Date(seen).toISOString()} recorded ${added} new headlines`);

if (SAVE && added) {
  const git = (...a) => spawnSync('git', a, { stdio: 'inherit' }).status === 0;
  git('add', dir);
  git('commit', '-qm', `headlines ${new Date().toISOString()}`);
  for (let i = 0; i < 4; i++) if (git('pull', '-q', '--rebase', 'origin', 'main') && git('push', '-q', 'origin', 'HEAD:main')) break;
}
