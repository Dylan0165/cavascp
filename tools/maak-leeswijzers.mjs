#!/usr/bin/env node
/**
 * Genereert de leeswijzers voor de mappen van dit semester.
 *
 * Standaard laat hij alleen zien wat eruit komt. Met --opslaan maakt hij er
 * documenten van in de werkplek, en met --schrijfPortflow zet hij de tekst als
 * beschrijving in de map zelf — dat is wat de docent in Portflow leest.
 *
 *   node tools/maak-leeswijzers.mjs                     # samenvatting
 *   node tools/maak-leeswijzers.mjs --toon              # de volledige tekst
 *   node tools/maak-leeswijzers.mjs --opslaan           # als document bewaren
 *   node tools/maak-leeswijzers.mjs --schrijfPortflow   # in de map zetten
 */

import { CONFIG } from '../browser/config.mjs';
import { Portflow } from '../browser/portflow.mjs';
import { leeswijzersVoorSemester } from '../mcp/lib/leeswijzer.mjs';
import * as werkplek from '../dashboard/lib/documenten.mjs';

const OPSLAAN = process.argv.includes('--opslaan');
const SCHRIJF = process.argv.includes('--schrijfPortflow');
const TOON = process.argv.includes('--toon');

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
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  console.log('');

  const uit = await leeswijzersVoorSemester(pf, { log: (m) => console.log(`  ${m}`) });
  console.log('');

  for (const item of uit) {
    console.log('='.repeat(78));
    console.log(`${item.map.naam.toUpperCase()}  (Portflow ${item.map.portflowCollectionId})`);
    console.log('='.repeat(78));
    if (item.fout) {
      console.log(`  FOUT: ${item.fout}`);
      console.log('');
      continue;
    }

    const { leeswijzer } = item;
    console.log(`  ${leeswijzer.statistiek.bewijsstukken} bewijsstukken`);
    console.log(`  gedekt : ${leeswijzer.gedekt.join(', ') || '—'}`);
    console.log(`  leeg   : ${leeswijzer.ontbrekend.join(', ') || '—'}`);
    console.log('');

    if (TOON) {
      console.log(leeswijzer.markdown);
      console.log('');
    }

    if (OPSLAAN) {
      /*
       * Als document bewaren, zodat je het in de werkplek kunt openen,
       * aanpassen en als Word-bestand kunt inleveren.
       *
       * De Markdown gaat in één sectie; de generator zet de koppen zelf om.
       */
      const doc = werkplek.leegDocument({
        titel: `Leeswijzer — ${item.map.naam}`,
        subtitel: 'Wat er in deze map staat en welke leeruitkomsten het aantoont',
        documenttype: 'leeswijzer',
        brief: 'Automatisch gemaakt uit de inhoud van de map.',
        plan: {
          titel: '',
          ondertitel: '',
          secties: [
            {
              id: 'leeswijzer',
              titel: item.map.naam,
              niveau: 1,
              tekst: leeswijzer.markdown,
              subsecties: [],
            },
          ],
        },
      });
      const bewaard = werkplek.bewaar(doc);
      console.log(`  bewaard als document: ${bewaard.id}`);
      console.log('');
    }

    if (SCHRIJF) {
      try {
        await pf.setCollectionDescription(item.map.portflowCollectionId, leeswijzer.markdown);
        console.log(`  beschrijving van de map gezet (${leeswijzer.markdown.length} tekens)`);
      } catch (error) {
        console.log(`  beschrijving zetten mislukt: ${error.message}`);
      }
      console.log('');
    }
  }

  if (!OPSLAAN && !SCHRIJF && !TOON) {
    console.log('(droogloop — --toon toont de tekst, --opslaan bewaart documenten,');
    console.log(' --schrijfPortflow zet de beschrijving in de map zelf)');
  }
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
