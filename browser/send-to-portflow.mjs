#!/usr/bin/env node
/**
 * Zet één bestand uit de document-inbox in een Portflow-collectie.
 *
 * Wordt aangeroepen door het dashboard, maar werkt ook los:
 *
 *   node send-to-portflow.mjs --file <pad> --collection <id> [--name "titel"]
 *                              [--goal-ids "485381,485384"] [--description "toelichting"]
 *   node send-to-portflow.mjs --file <pad> --collection <id> --lo "LO2,LO5"
 *   node send-to-portflow.mjs --list            # collecties tonen
 *   node send-to-portflow.mjs --selftest        # verbinding controleren
 *
 * Gebruik --goal-ids en niet --lo als je de id's al hebt: de naam-route kan het
 * doel van een ouder semester pakken, want namen komen vier keer voor.
 *
 * De uitvoer is één JSON-regel op de laatste regel, zodat het dashboard het
 * resultaat kan lezen. Alle menselijke tekst gaat naar stderr.
 *
 * Er wordt niets geüpload zolang --dry niet is meegegeven én er een bestand en
 * collectie bekend zijn.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

function parseArgs(argv) {
  const out = { file: null, collection: null, name: null, lo: null, list: false, selftest: false, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') out.file = argv[++i];
    else if (arg === '--collection') out.collection = Number(argv[++i]);
    else if (arg === '--name') out.name = argv[++i];
    else if (arg === '--lo') out.lo = argv[++i];
    else if (arg === '--goal-ids') out.goalIds = argv[++i];
    else if (arg === '--description') out.description = argv[++i];
    else if (arg === '--list') out.list = true;
    else if (arg === '--mappen') out.mappen = true;
    else if (arg === '--snapshots') out.snapshots = true;
    else if (arg === '--beschrijving') out.beschrijving = true;
    else if (arg === '--tekst-bestand') out.tekstBestand = argv[++i];
    else if (arg === '--selftest') out.selftest = true;
    else if (arg === '--dry') out.dry = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const log = (...parts) => console.error(...parts);

/** Het resultaat gaat als één JSON-regel naar stdout. */
function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

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

try {
  await pf.connect();
  log(`verbonden: portfolio ${pf.portfolioId}, ${pf.me?.name ?? '?'}`);

  /* ── collecties tonen ─────────────────────────────────────────────────── */
  if (args.list) {
    const collections = await pf.collections();
    emit({
      ok: true,
      action: 'list',
      portfolioId: pf.portfolioId,
      user: pf.me?.name ?? null,
      collections: collections.map((c) => ({
        id: c.id,
        name: c.name,
        evidenceCount: c.evidence_count ?? 0,
        goalsCount: c.goals_count ?? 0,
      })),
    });
  } else if (args.mappen) {
    /*
     * De mappen van dit semester met hun inhoud en dekking.
     *
     * Dit is wat de Portflow-tab toont. We gebruiken het
     * portfolio-freezes-endpoint, want dat is het enige dat bewijs MET zijn
     * doelen teruggeeft. Zonder de doelen kun je niets over dekking zeggen.
     */
    const { semesterMappen, LEERUITKOMSTEN, portflowGoalIdVoor, maakLeeswijzer } = await import(
      '../mcp/lib/leeswijzer.mjs'
    ).then(async (lw) => ({
      ...lw,
      ...(await import('../mcp/lib/leeruitkomsten.mjs')),
    }));

    const doelen = await pf.goals();
    const doelNaam = new Map((doelen ?? []).map((g) => [g.id, g.name]));

    const mappen = [];
    for (const map of semesterMappen()) {
      let bewijs = [];
      try {
        bewijs = await pf.evidenceForFreeze(map.portflowCollectionId);
      } catch (error) {
        log(`  ${map.naam}: ${error.message}`);
      }

      /* Per stuk ook de naam, datum en beschrijving ophalen. */
      for (const stuk of bewijs) {
        try {
          const d = await pf.call('GET', `/api/v1/portfolios/${pf.portfolioId}/evidence/${stuk.id}`);
          if (d.ok) {
            stuk.naam = d.data?.name ?? stuk.naam;
            stuk.gemaakt = d.data?.created_at ?? null;
            stuk.beschrijving = d.data?.description ?? null;
          }
        } catch {
          /* zonder detail werkt de rest ook */
        }
      }

      /* Welke leeruitkomsten dekt deze map? */
      const gedekt = new Set();
      for (const stuk of bewijs) {
        for (const goalId of stuk.goalIds ?? []) {
          for (const lo of LEERUITKOMSTEN) {
            if (portflowGoalIdVoor(lo.code) === Number(goalId)) gedekt.add(lo.code);
          }
        }
      }

      const leeswijzer = maakLeeswijzer({
        mapNaam: map.naam,
        mapId: map.portflowCollectionId,
        bewijs,
      });

      mappen.push({
        id: map.portflowCollectionId,
        naam: map.naam,
        bewijs: bewijs.map((s) => ({
          id: s.id,
          naam: s.naam,
          gemaakt: s.gemaakt,
          beschrijving: s.beschrijving,
          goalIds: s.goalIds ?? [],
          leeruitkomsten: (s.goalIds ?? [])
            .map((g) => LEERUITKOMSTEN.find((lo) => portflowGoalIdVoor(lo.code) === Number(g))?.code)
            .filter(Boolean),
        })),
        gedekt: [...gedekt].sort(),
        ontbrekend: leeswijzer.ontbrekend,
        leeswijzer: leeswijzer.markdown,
      });
    }

    emit({
      ok: true,
      action: 'mappen',
      portfolioId: pf.portfolioId,
      user: pf.me?.name ?? null,
      mappen,
      leeruitkomsten: LEERUITKOMSTEN.map((lo) => ({
        code: lo.code,
        naam: lo.naam,
        goalId: portflowGoalIdVoor(lo.code),
      })),
    });
  } else if (args.snapshots) {
    /*
     * De snapshots van dit portfolio.
     *
     * Handig om te zien wat je wanneer hebt ingeleverd, en om te controleren of
     * er geen test-snapshot is blijven staan. Een snapshot is onveranderlijk,
     * dus je kunt hem niet meer aanpassen — alleen bekijken of verwijderen.
     */
    const lijst = await pf.snapshots({ perPage: 50 });
    emit({
      ok: true,
      action: 'snapshots',
      portfolioId: pf.portfolioId,
      user: pf.me?.name ?? null,
      aantal: lijst.length,
      snapshots: lijst.map((s) => ({
        id: s.id,
        naam: s.naam,
        versie: s.versie,
        gemaakt: s.gemaakt,
        code: s.code,
        showcaseUrl: s.showcaseUrl,
        inleveringen: s.inleveringen,
        // Waar hij naartoe is gegaan, als hij is ingeleverd.
        opdrachten: (s.lmsAssignments ?? []).map((a) => ({
          naam: a.name ?? a.assignment_name ?? null,
          op: a.submitted_at ?? a.created_at ?? null,
        })),
      })),
    });
  } else if (args.beschrijving) {
    /*
     * De beschrijving van een map zetten.
     *
     * De tekst komt uit een bestand en niet van de opdrachtregel: een leeswijzer
     * is duizenden tekens met regeleinden, en dat overleeft de opdrachtregel
     * niet.
     */
    if (!args.collection) throw new Error('geen --collection meegegeven');
    if (!args.tekstBestand) throw new Error('geen --tekst-bestand meegegeven');

    const { readFileSync, existsSync } = await import('node:fs');
    if (!existsSync(args.tekstBestand)) throw new Error(`tekstbestand niet gevonden: ${args.tekstBestand}`);
    const tekst = readFileSync(args.tekstBestand, 'utf8');

    const collections = await pf.collections();
    const doel = collections.find((c) => Number(c.id) === Number(args.collection));
    if (!doel) throw new Error(`collectie ${args.collection} bestaat niet`);

    const uitkomst = await pf.setCollectionDescription(doel.id, tekst);
    log(`beschrijving van "${doel.name}" gezet (${uitkomst.length} tekens)`);
    emit({
      ok: true,
      action: 'beschrijving',
      collection: { id: doel.id, name: doel.name },
      lengte: uitkomst.length,
      hadAl: Boolean(doel.description),
    });
  } else if (args.selftest) {
    const capabilities = await pf.capabilities();
    emit({
      ok: true,
      action: 'selftest',
      portfolioId: pf.portfolioId,
      user: pf.me?.name ?? null,
      evidenceCreation: capabilities?.lms?.capabilities?.evidence_creation ?? false,
    });
  } else {
    /* ── uploaden ───────────────────────────────────────────────────────── */
    if (!args.file) throw new Error('geen --file meegegeven');
    if (!args.collection) throw new Error('geen --collection meegegeven');

    const filePath = path.resolve(args.file);
    if (!existsSync(filePath)) throw new Error(`bestand niet gevonden: ${filePath}`);

    const collections = await pf.collections();
    const target = collections.find((c) => Number(c.id) === Number(args.collection));
    if (!target) {
      throw new Error(
        `collectie ${args.collection} bestaat niet. Beschikbaar: ${collections.map((c) => `${c.id}=${c.name}`).join(', ')}`,
      );
    }

    /*
     * Leeruitkomsten koppelen.
     *
     * Twee manieren, en de voorkeur is duidelijk:
     *
     *   --goal-ids 485381,485384   de doelen staan al vast (uit de geverifieerde
     *                              koppeling in data/lo-koppeling.json)
     *   --lo LO2,LO5               hier zoeken we het doel bij op NAAM
     *
     * De naam-route is onbetrouwbaar: "Professional Standard" bestaat vier keer
     * in Portflow, in vier semesters. Wie op naam zoekt, pakt de eerste de beste
     * en zet je bewijs aan het doel van een vorig semester. Daarom krijgt
     * --goal-ids voorrang, en waarschuwen we als de naam-route meerdere
     * kandidaten vindt.
     */
    let goalIds = [];
    if (args.goalIds) {
      goalIds = String(args.goalIds)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      log(`doelen uit de koppeling: ${goalIds.join(', ')}`);
    } else if (args.lo) {
      const codes = args.lo.split(',').map((s) => s.trim()).filter(Boolean);
      const goals = await pf.goals();
      const list = Array.isArray(goals) ? goals : (goals?.goals ?? []);
      const treffers = list.filter((g) =>
        codes.some((code) => new RegExp(`^LO\\s*${code.replace(/^LO/i, '')}\\b`, 'i').test(g.name ?? g.description ?? '')),
      );
      goalIds = treffers.map((g) => g.id);
      log(`leeruitkomsten: ${codes.join(', ')} -> ${goalIds.length} doel(en): ${treffers.map((g) => `${g.id} "${g.name}"`).join(', ')}`);

      /*
       * Waarschuwen als een code op meerdere doelen past. Dan is de kans groot
       * dat er een doel van een ouder semester tussen zit.
       */
      for (const code of codes) {
        const aantal = list.filter((g) =>
          new RegExp(`^LO\\s*${code.replace(/^LO/i, '')}\\b`, 'i').test(g.name ?? g.description ?? ''),
        ).length;
        if (aantal > 1) {
          log(
            `LET OP: "${code}" past op ${aantal} doelen. Er kan een doel van een ouder semester tussen zitten. ` +
              'Gebruik --goal-ids met de id uit data/lo-koppeling.json.',
          );
        }
      }
    }

    if (args.dry) {
      emit({ ok: true, action: 'dry', collection: { id: target.id, name: target.name }, goalIds, file: filePath });
    } else {
      const result = await pf.addFileEvidence({
        filePath,
        collectionIds: [target.id],
        goalIds,
        name: args.name || undefined,
        description: args.description || '',
        quiet: true,
      });
      log(`geüpload naar "${target.name}": evidence ${result.evidenceId}`);

      /* De toelichting hoort bij het bewijsstuk. Mislukt het, dan is het
         bestand er in ieder geval — dat melden we apart. */
      let toelichtingGezet = false;
      if (args.description) {
        try {
          await pf.setEvidenceDescription(result.evidenceId, args.description);
          toelichtingGezet = true;
          log('toelichting gezet');
        } catch (error) {
          log(`toelichting zetten mislukt: ${error.message}`);
        }
      }

      emit({
        ok: true,
        action: 'upload',
        evidenceId: result.evidenceId,
        name: result.name,
        size: result.size,
        collection: { id: target.id, name: target.name },
        goalIds,
        toelichtingGezet,
      });
    }
  }
} catch (error) {
  log(`FOUT: ${error.message}`);
  emit({ ok: false, error: error.message });
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
