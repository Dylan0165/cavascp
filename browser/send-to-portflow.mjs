#!/usr/bin/env node
/**
 * Zet één bestand uit de document-inbox in een Portflow-collectie.
 *
 * Wordt aangeroepen door het dashboard, maar werkt ook los:
 *
 *   node send-to-portflow.mjs --file <pad> --collection <id> [--name "titel"] [--lo "LO1,LO2"]
 *   node send-to-portflow.mjs --list            # collecties tonen
 *   node send-to-portflow.mjs --selftest        # verbinding controleren
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
    else if (arg === '--list') out.list = true;
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

    /* Leeruitkomsten koppelen als er codes zijn meegegeven. */
    let goalIds = [];
    if (args.lo) {
      const codes = args.lo.split(',').map((s) => s.trim()).filter(Boolean);
      const goals = await pf.goals();
      const list = Array.isArray(goals) ? goals : (goals?.goals ?? []);
      goalIds = list
        .filter((g) =>
          codes.some((code) => new RegExp(`^LO\\s*${code.replace(/^LO/i, '')}\\b`, 'i').test(g.name ?? g.description ?? '')),
        )
        .map((g) => g.id);
      log(`leeruitkomsten: ${codes.join(', ')} -> ${goalIds.length} doel(en)`);
    }

    if (args.dry) {
      emit({ ok: true, action: 'dry', collection: { id: target.id, name: target.name }, goalIds, file: filePath });
    } else {
      const result = await pf.addFileEvidence({
        filePath,
        collectionIds: [target.id],
        goalIds,
        name: args.name || undefined,
        quiet: true,
      });
      log(`geüpload naar "${target.name}": evidence ${result.evidenceId}`);
      emit({
        ok: true,
        action: 'upload',
        evidenceId: result.evidenceId,
        name: result.name,
        size: result.size,
        collection: { id: target.id, name: target.name },
        goalIds,
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
