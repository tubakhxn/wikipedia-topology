import { N, K } from './data.js';
// Real Wikipedia content via the MediaWiki Action API (CORS via origin=*, no key).
const API = 'https://en.wikipedia.org/w/api.php';
const Q = ['generative art','intelligent agent','complex system','interactive design','emergence','cognitive science','information system','data visualization','creative coding','knowledge graph','symmetry in biology','computational design','software engineering','pattern formation'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function api(params, tries = 3) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  let err;
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.info || j.error.code);
      return j;
    } catch (e) { err = e; await sleep(600 * 2 ** t); }
  }
  throw err;
}

export async function searchPages(q, offset) {
  const j = await api({
    action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: '0', gsrlimit: '20', gsroffset: String(offset),
    prop: 'pageimages|extracts|info', piprop: 'thumbnail', pithumbsize: '500', pilimit: 'max',
    exintro: '1', explaintext: '1', exsentences: '4', exlimit: 'max', inprop: 'url'
  });
  return ((j.query && j.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
}

// a usable card = real article, real thumbnail (not an svg logo/map), real intro text
export function usable(p) {
  return !!(p && p.thumbnail && p.thumbnail.source && p.extract && p.extract.length > 40 && p.fullurl &&
    !/may (also )?refer to/i.test(p.extract) && !/^List of /i.test(p.title) && !/disambiguation/i.test(p.title) &&
    !/\.svg(\.png)?$/i.test(p.thumbnail.source));
}

export async function loadContent(D, onItem, onMiss, onMsg) {
  const byC = Array.from({ length: K }, () => []);
  for (let n = 0; n < N; n++) byC[D.cluster[n]].push(n);
  byC.forEach(a => a.sort((x, y) => D.imp[y] - D.imp[x]));   // hub first, then most important
  const seen = new Set(); let done = 0, got = 0, netFail = 0;
  const doCluster = async k => {
    const need = byC[k].length; let pages = [];
    for (let off = 0; pages.filter(usable).length < need + 4 && off < 160; off += 20) {
      let ps; try { ps = await searchPages(Q[k], off); } catch (e) { netFail++; console.warn('wikipedia search failed', Q[k], e); break; }
      if (!ps.length) break; pages = pages.concat(ps);
    }
    pages = pages.filter(usable).filter(p => !seen.has(p.title));
    byC[k].forEach((n, i) => {
      const p = pages[i];
      if (!p) { onMiss(n); return; }
      seen.add(p.title); got++;
      onItem(n, { title: p.title, text: p.extract, image: p.thumbnail.source, url: p.fullurl, pageid: p.pageid, handle: 'wikipedia.org' });
    });
    done++; onMsg(`wikipedia: ${done}/${K} topics · ${got} real articles`);
  };
  const queue = [...Array(K).keys()];
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await doCluster(queue.shift()); }));
  if (!got) onMsg('wikipedia unreachable — no articles loaded (no placeholder images are shown)');
  return got;
}

// Real article-to-article relationships: prop=links, keep only links between loaded articles.
export async function loadLinks(entries, onEdge, onMsg) {
  const idx = new Map(entries.map(e => [e.title, e.n]));
  const titles = entries.map(e => e.title), batches = [];
  for (let i = 0; i < titles.length; i += 10) batches.push(titles.slice(i, i + 10));
  let found = 0, finished = 0;
  const run = async b => {
    let cont = {};
    for (let loop = 0; loop < 3; loop++) {
      let j; try { j = await api({ action: 'query', prop: 'links', titles: b.join('|'), pllimit: 'max', plnamespace: '0', ...cont }); } catch (e) { return; }
      for (const p of (j.query && j.query.pages) || []) {
        const a = idx.get(p.title); if (a === undefined) continue;
        for (const l of p.links || []) { const t = idx.get(l.title); if (t !== undefined && t !== a) { onEdge(a, t); found++; } }
      }
      if (!j.continue) break; cont = j.continue;
    }
  };
  const q = batches.slice();
  await Promise.all(Array.from({ length: 3 }, async () => { while (q.length) { await run(q.shift()); finished++; onMsg(`wikipedia links: ${finished}/${batches.length} batches`); } }));
  return found;
}
