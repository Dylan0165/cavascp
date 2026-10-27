#!/usr/bin/env node
/**
 * Portflow in kaart: structuur, doelen, bewijs en de snapshot-flow.
 *
 * Dit is het onderzoek voor de automatiseringswens:
 *   - mappen (collections) met hun beschrijving en leeruitkomsten
 *   - welk bewijs waar hangt en aan welke doelen het gekoppeld is
 *   - hoe een bewijsstuk aan MEERDERE leeruitkomsten kan hangen
 *   - welke velden een collectie heeft (voor de leeswijzer)
 *   - en de snapshot-endpoints (maken + inleveren)
 *
 * Alleen-lezen. Er wordt niets aangemaakt of gewijzigd.
 *
 *   node research-portflow.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
const OUT = path.resolve('out');
await mkdir(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

/* Alles wat naar de API gaat vastleggen, zodat we de vorm van elk endpoint zien. */
const traffic = [];
page.on('request', (req) => {
  const url = req.url();
  if (!url.includes('/api/v1/')) return;
  traffic.push({
    kind: 'req',
    method: req.method(),
    path: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    query: url.includes('?') ? url.split('?')[1].slice(0, 120) : null,
    body: (() => {
      try {
        const d = req.postData();
        return d && d.length < 800 ? d : d ? `<${d.length} bytes>` : null;
      } catch {
        return null;
      }
    })(),
  });
});
page.on('response', (res) => {
  const url = res.url();
  if (!url.includes('/api/v1/')) return;
  const ct = (res.headers()['content-type'] ?? '').split(';')[0];
  if (!ct.includes('json')) return;
  traffic.push({
    kind: 'res',
    method: res.request().method(),
    path: url.replace(`https://${CONFIG.portflowHost}`, '').split('?')[0],
    status: res.status(),
  });
});

try {
  console.log('Verbinden met Portflow…');
  const portfolioId = await pf.connect();
  console.log(`portfolio ${portfolioId} · ${pf.me?.name ?? '?'}`);
  console.log('');

  /* ── 1. Collecties: alle velden ─────────────────────────────────────── */
  const collections = await pf.collections();
  console.log('='.repeat(78));
  console.log(`COLLECTIES (${collections.length})`);
  console.log('='.repeat(78));
  if (collections[0]) {
    console.log(`velden: ${Object.keys(collections[0]).join(', ')}`);
    console.log('');
  }
  for (const c of collections) {
    const desc = c.description ? `${c.description.length} tekens` : 'geen';
    console.log(
      `  ${String(c.id).padStart(7)}  ${String(c.name).slice(0, 30).padEnd(30)}  ` +
        `bewijs=${String(c.evidence_count ?? 0).padStart(2)}  doelen=${String(c.goals_count ?? 0).padStart(2)}  ` +
        `beschrijving=${desc}  kleur=${c.color}`,
    );
  }

  /* ── 2. Doelen (leeruitkomsten) ─────────────────────────────────────── */
  console.log('');
  console.log('='.repeat(78));
  console.log('DOELEN / LEERUITKOMSTEN');
  console.log('='.repeat(78));
  const goalsRaw = await pf.call('GET', `/api/v1/portfolios/${portfolioId}/goals?page=1&per_page=100`);
  const goals = Array.isArray(goalsRaw.data) ? goalsRaw.data : (goalsRaw.data?.goals ?? []);
  console.log(`aantal: ${goals.length}`);
  if (goals[0]) console.log(`velden: ${Object.keys(goals[0]).join(', ')}`);
  const goalsById = new Map();
  for (const g of goals) {
    goalsById.set(g.id, g);
    console.log(`  ${String(g.id).padStart(7)}  ${String(g.title ?? g.name ?? '?').slice(0, 56)}`);
  }

  /* ── 3. Bewijs per collectie, met koppelingen ───────────────────────── */
  console.log('');
  console.log('='.repeat(78));
  console.log('BEWIJS EN KOPPELINGEN');
  console.log('='.repeat(78));

  const perCollection = [];
  for (const c of collections) {
    const raw = await pf.call(
      'GET',
      `/api/v1/portfolios/${portfolioId}/collections/${c.id}/evidence?page=1&per_page=100`,
    );
    const items = Array.isArray(raw.data) ? raw.data : (raw.data?.evidence ?? []);
    if (!items.length) continue;

    console.log(`\n  "${c.name}" (${items.length} bewijsstukken)`);
    if (items[0]) console.log(`    velden: ${Object.keys(items[0]).join(', ')}`);

    for (const item of items.slice(0, 6)) {
      // Een bewijsstuk kan een genest `evidence`-object hebben (koppeling) of
      // het bewijsstuk zelf zijn.
      const ev = item.evidence ?? item;
      const goalIds = (item.goals ?? ev.goals ?? []).map((g) => g.id ?? g);
      const goalNames = goalIds.map((id) => goalsById.get(id)?.title ?? goalsById.get(id)?.name ?? id);
      console.log(
        `    ${String(ev.id).padStart(8)}  ${String(ev.name ?? '?').slice(0, 38).padEnd(38)}  ` +
          `type=${ev.latest_version_type ?? '?'}  doelen=[${goalNames.join(' | ') || 'geen'}]`,
      );
    }
    perCollection.push({ collection: { id: c.id, name: c.name }, count: items.length, sample: items.slice(0, 3) });
  }

  /* ── 4. Snapshot-endpoints ──────────────────────────────────────────── */
  console.log('');
  console.log('='.repeat(78));
  console.log('SNAPSHOT');
  console.log('='.repeat(78));
  const snapshotPaths = [
    `/api/v1/portfolios/${portfolioId}/snapshots`,
    `/api/v1/portfolios/${portfolioId}/snapshots?page=1`,
    '/api/v1/snapshots',
  ];
  for (const p of snapshotPaths) {
    const r = await pf.call('GET', p);
    const n = Array.isArray(r.data) ? r.data.length : (r.data?.snapshots?.length ?? null);
    console.log(`  [${r.status}] ${p}${n !== null ? `  → ${n} items` : ''}`);
    if (r.status === 200 && r.data) {
      const sample = Array.isArray(r.data) ? r.data[0] : r.data?.snapshots?.[0] ?? r.data;
      if (sample) console.log(`        velden: ${Object.keys(sample).join(', ')}`);
    }
  }

  /* ── 5. Wat deed de app zelf? ───────────────────────────────────────── */
  console.log('');
  console.log('='.repeat(78));
  console.log('API-VERKEER VAN DE APP');
  console.log('='.repeat(78));
  const unique = new Map();
  for (const t of traffic) {
    const key = `${t.kind} ${t.method} ${t.path}`;
    if (!unique.has(key)) unique.set(key, t);
  }
  for (const t of [...unique.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const status = t.status ? ` [${t.status}]` : '';
    const body = t.body ? `  body: ${t.body.slice(0, 90)}` : '';
    console.log(`  ${t.kind} ${String(t.method).padEnd(6)} ${t.path}${status}${body}`);
  }

  /* ── Rapport ────────────────────────────────────────────────────────── */
  const report = {
    generatedAt: new Date().toISOString(),
    portfolioId,
    collectionFields: collections[0] ? Object.keys(collections[0]) : [],
    goalFields: goals[0] ? Object.keys(goals[0]) : [],
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      color: c.color,
      hidden: c.hidden,
      sectionId: c.section_id,
      goalsCount: c.goals_count,
      evidenceCount: c.evidence_count,
      preferredView: c.preferred_view,
    })),
    goals: goals.map((g) => ({ id: g.id, title: g.title ?? g.name, keys: Object.keys(g) })),
    evidencePerCollection: perCollection,
    traffic: [...unique.values()],
  };
  const file = path.join(OUT, 'portflow-research.json');
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  console.log('');
  console.log(`rapport: ${file}`);
} catch (error) {
  console.error(`\nFOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
