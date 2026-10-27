#!/usr/bin/env node
/**
 * De snapshot-keten testen: maken, controleren, en weer weggooien.
 *
 * LET OP: dit script MAAKT EEN SNAPSHOT in je portfolio. Dat is geen READ-actie.
 * Daarom draait het alleen met --doen, en niet standaard.
 *
 * De snapshot krijgt de naam "cavascp test-snapshot" zodat je hem herkent, en
 * wordt aan het eind verwijderd — ook als er onderweg iets misgaat.
 *
 * Wat het test:
 *   1. de snapshot-lijst lezen (het endpoint zonder portfolio-id in het pad)
 *   2. een snapshot maken met alleen de mappen van dit semester
 *   3. wachten tot Portflow hem klaar heeft ("being finalized")
 *   4. controleren dat hij in de lijst staat en wat erin zit
 *   5. hem verwijderen en controleren dat hij weg is
 *
 *   node tools/test-snapshot.mjs            # alleen laten zien wat het zou doen
 *   node tools/test-snapshot.mjs --doen     # ook echt uitvoeren
 */

import { CONFIG } from '../browser/config.mjs';
import { Portflow } from '../browser/portflow.mjs';
import { semesterMappen } from '../mcp/lib/leeruitkomsten.mjs';
import { LEERUITKOMSTEN, portflowGoalIdVoor } from '../mcp/lib/leeruitkomsten.mjs';

const DOEN = process.argv.includes('--doen');
const NAAM = 'cavascp test-snapshot';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const { chromium } = await import(CONFIG.playwrightUrl);
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
let snapshotId = null;

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  console.log('');

  /* ── 1. De lijst lezen ──────────────────────────────────────────────── */
  console.log('1) De snapshot-lijst lezen');
  const voor = await pf.snapshots({ perPage: 100 });
  check('de lijst is op te vragen', voor.length > 0, `${voor.length} snapshots`);
  check(
    'de snapshots hebben een naam en een id',
    voor.every((s) => s.id && s.naam),
    `jongste: "${voor[0]?.naam}" van ${String(voor[0]?.gemaakt).slice(0, 10)}`,
  );
  check(
    'er staat geen oude test-snapshot meer in',
    !voor.some((s) => s.naam === NAAM),
    voor.some((s) => s.naam === NAAM) ? 'LET OP: er staat er al een' : 'schoon',
  );
  console.log(`     jouw snapshots: ${voor.length}, nieuwste "${voor[0]?.naam}"`);
  console.log('');

  /* ── Wat gaan we maken? ─────────────────────────────────────────────── */
  const mappen = semesterMappen();
  const collectionIds = mappen.map((m) => m.portflowCollectionId);
  const goalIds = LEERUITKOMSTEN.map((l) => portflowGoalIdVoor(l.code)).filter(Boolean);

  console.log('2) Wat de snapshot zou bevatten');
  console.log(`     naam    : ${NAAM}`);
  console.log(`     mappen  : ${mappen.map((m) => `${m.naam} (${m.portflowCollectionId})`).join(', ')}`);
  console.log(`     doelen  : ${goalIds.join(', ')}`);
  for (const cid of collectionIds) {
    try {
      const bewijs = await pf.evidenceForFreeze(cid);
      const naam = mappen.find((m) => m.portflowCollectionId === cid)?.naam;
      console.log(`     ${String(naam).padEnd(22)} ${bewijs.length} bewijsstukken`);
    } catch (error) {
      console.log(`     ${cid}: ${error.message}`);
    }
  }
  console.log('');

  if (!DOEN) {
    console.log('='.repeat(74));
    console.log('DROOGLOOP — er is niets gemaakt.');
    console.log('');
    console.log('Dit script maakt een snapshot in je portfolio. Dat is geen leesactie,');
    console.log('dus het draait alleen met --doen. De snapshot krijgt de naam');
    console.log(`"${NAAM}" en wordt daarna direct weer verwijderd.`);
    console.log('');
    console.log('  node tools/test-snapshot.mjs --doen');
    console.log('='.repeat(74));
  } else {
    /* ── 2. Maken ─────────────────────────────────────────────────────── */
    console.log('3) De snapshot maken');
    const uit = await pf.maakSnapshot({
      naam: NAAM,
      collectionIds,
      goalIds,
      alleenDezeMappen: true,
      quiet: false,
    });
    check('het verzoek is geaccepteerd', uit.ok, 'Portflow zegt: being finalized');
    console.log('');

    /* ── 3. Wachten tot hij klaar is ──────────────────────────────────── */
    console.log('4) Wachten tot Portflow hem klaar heeft');
    const nieuw = await pf.wachtOpSnapshot({
      bekendeIds: voor.map((s) => s.id),
      timeoutMs: 150_000,
      intervalMs: 5000,
    });
    check('de snapshot staat in de lijst', Boolean(nieuw), nieuw ? `id ${nieuw.id}` : 'niet verschenen binnen 150 seconden');
    if (nieuw) {
      snapshotId = nieuw.id;
      check('de naam klopt', nieuw.naam === NAAM, nieuw.naam);
      check('hij heeft een code', Boolean(nieuw.code), nieuw.code ?? 'geen');
      console.log(`     id ${nieuw.id}, code ${nieuw.code ?? '—'}`);
      console.log(`     showcase: ${nieuw.showcaseUrl ?? '—'}`);
    }
    console.log('');

    /* ── 4. Opruimen ──────────────────────────────────────────────────── */
    console.log('5) Opruimen');
    if (snapshotId) {
      const status = await pf.deleteSnapshot(snapshotId);
      check('verwijderen gelukt', status === 204 || status === 200, `status ${status}`);
      snapshotId = null;
      await new Promise((r) => setTimeout(r, 2500));
      const na = await pf.snapshots({ perPage: 100 });
      check('de snapshot is weg', !na.some((s) => s.naam === NAAM), `${na.length} snapshots over`);
      check('je eigen snapshots staan er nog', na.length === voor.length, `${voor.length} → ${na.length}`);
    } else {
      check('er was iets om op te ruimen', false, 'geen id; controleer je portfolio op een achtergebleven snapshot');
    }
  }
} catch (error) {
  check(`keten mislukt: ${error.message}`, false, error.stack?.split('\n')[1]?.trim());

  if (snapshotId) {
    console.log(`\n  opruimen na fout (snapshot ${snapshotId})…`);
    try {
      const status = await pf.deleteSnapshot(snapshotId);
      console.log(`  opgeruimd, status ${status}`);
      snapshotId = null;
    } catch (opruimFout) {
      console.log(`  OPRUIMEN MISLUKT: ${opruimFout.message}`);
      console.log(`  verwijder snapshot ${snapshotId} handmatig via "My snapshots" in Portflow`);
    }
  }
} finally {
  await context.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
