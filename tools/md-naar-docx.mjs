#!/usr/bin/env node
/**
 * Markdown naar Word, met de opmaak van Krava.
 *
 * Krava heeft al een generator die een nette brief oplevert: omslag,
 * inhoudsopgave, genummerde koppen, tabellen met een gevulde kopregel,
 * callouts, kop- en voettekst en paginanummers. Die gebruiken we hier, in
 * plaats van zelf XML te maken. Dit script doet alleen de vertaling van
 * markdown naar de blokken die Krava begrijpt.
 *
 *   node tools/md-naar-docx.mjs --alles
 *   node tools/md-naar-docx.mjs "vault/Documentatie/cavascp documentatie.md"
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bouwDocx } from '../mcp/lib/docx.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HIER, '..');

/* ─────────────────────────── markdown lezen ───────────────────────────── */

/**
 * Links en losse adressen leesbaar maken. Krava zet **vet** en `code` zelf om,
 * dus die laten we staan.
 */
const schoon = (tekst) =>
  String(tekst ?? '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/<((https?:\/\/)[^>]+)>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();

const lijstRegel = (regel) => /^([-*]|\d+\.)\s+/.exec(regel);

/** Waar een witregel tussen moet, en waar niet. */
function markdownNaarProject(markdown, { bestand = '' } = {}) {
  const regels = markdown.replace(/\r/g, '').split('\n');

  const project = {
    titel: path.basename(bestand, '.md').replace(/^\w/, (c) => c.toUpperCase()),
    subtitel: '',
    auteur: 'Dylan Schuurman',
    organisatie: 'Fontys Hogeschool ICT',
    datum: new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }),
    secties: [],
    bronnen: [],
  };

  let sectie = null;
  let inFrontmatter = false;
  let inBronnen = false;
  let buffer = [];
  let tabel = null;
  let lijst = null;

  const sluitAlinea = () => {
    if (!buffer.length) return;
    const tekst = schoon(buffer.join(' '));
    if (sectie) {
      sectie.blokken.push({ type: 'paragraph', tekst });
    } else if (!project.subtitel) {
      /*
       * De eerste alinea wordt de ondertitel op de omslag en in de koptekst.
       * Niet midden in een woord afkappen: zoek de laatste punt voor 180
       * tekens, en val terug op de laatste spatie.
       */
      const grens = tekst.slice(0, 180);
      const punt = grens.lastIndexOf('. ');
      const spatie = grens.lastIndexOf(' ');
      project.subtitel =
        tekst.length <= 180 ? tekst : `${grens.slice(0, punt > 60 ? punt + 1 : spatie)}…`;
    }
    buffer = [];
  };

  const sluitLijst = () => {
    if (lijst && sectie) sectie.blokken.push(lijst);
    lijst = null;
  };

  const sluitTabel = () => {
    if (tabel && sectie) sectie.blokken.push(tabel);
    tabel = null;
  };

  const sluitAlles = () => {
    sluitAlinea();
    sluitLijst();
    sluitTabel();
  };

  for (let i = 0; i < regels.length; i += 1) {
    const regel = regels[i];

    if (regel.trim() === '---' && (i === 0 || inFrontmatter)) {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;

    if (/^\|/.test(regel)) {
      sluitAlinea();
      sluitLijst();

      const cellen = regel
        .split('|')
        .slice(1, -1)
        .map((cel) => schoon(cel.trim()));

      if (cellen.every((cel) => /^-{2,}$/.test(cel.replace(/[: ]/g, '')))) continue;

      if (!tabel) tabel = { type: 'table', kop: cellen, rijen: [] };
      else tabel.rijen.push(cellen);
      continue;
    }
    sluitTabel();

    if (regel.trim() === '') {
      sluitAlinea();
      sluitLijst();
      continue;
    }

    const kop = /^(#{1,3})\s+(.*)$/.exec(regel);
    if (kop) {
      sluitAlles();
      const niveau = kop[1].length;
      const titel = schoon(kop[2]);

      if (niveau === 1) {
        project.titel = titel;
        continue;
      }

      if (niveau === 2) {
        inBronnen = /^bronnen$/i.test(titel);
        if (inBronnen) {
          sectie = null;
          continue;
        }

        sectie = { titel, niveau: 1, blokken: [] };
        project.secties.push(sectie);
        continue;
      }

      if (sectie) sectie.blokken.push({ type: 'subheading', tekst: titel, niveau: 3 });
      continue;
    }

    const opsomming = lijstRegel(regel);
    if (opsomming) {
      sluitAlinea();

      const tekst = schoon(regel.replace(/^([-*]|\d+\.)\s+/, ''));
      const genummerd = /^\d+\./.test(opsomming[1]);

      if (inBronnen) {
        project.bronnen.push({ tekst });
        continue;
      }

      if (!lijst) lijst = { type: 'list', items: [] };
      /*
       * Krava zet bij een genummerd punt geen teken neer (dat doet Word met
       * een nummering die wij uit hebben staan). Dus het nummer hoort in de
       * tekst zelf, anders verdwijnt de opsomming.
       */
      lijst.items.push({
        tekst: genummerd ? `${opsomming[1].replace('.', '')}. ${tekst}` : tekst,
        niveau: 0,
        genummerd,
      });
      continue;
    }
    sluitLijst();

    if (/^>\s?/.test(regel)) {
      sluitAlinea();
      const tekst = schoon(regel.replace(/^>\s?/, ''));
      if (!tekst || /^\[!/.test(tekst)) continue;
      if (sectie) sectie.blokken.push({ type: 'callout', soort: 'note', tekst });
      continue;
    }

    buffer.push(regel.trim());
  }

  sluitAlles();

  if (!project.secties.length) {
    project.secties.push({
      titel: 'Inhoud',
      niveau: 1,
      blokken: [{ type: 'paragraph', tekst: project.subtitel || 'Geen inhoud gevonden.' }],
    });
  }

  return project;
}

/* ────────────────────────────── uitvoeren ─────────────────────────────── */

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argumenten = process.argv.slice(2);
  const alles = argumenten.includes('--alles') || argumenten.length === 0;

  const mappen = ['vault/Documentatie', 'vault/Portfolio'];

  const bestanden = alles
    ? mappen.flatMap((map) =>
        readdirSync(path.join(PROJECT, map))
          .filter((naam) => naam.endsWith('.md'))
          .map((naam) => path.join(map, naam)),
      )
    : argumenten.filter((argument) => !argument.startsWith('--'));

  if (!bestanden.length) {
    console.log('  Geen bestanden om te zetten.\n  Gebruik: node tools/md-naar-docx.mjs <bestand.md>');
    process.exit(1);
  }

  console.log('');

  for (const bestand of bestanden) {
    const bron = path.resolve(PROJECT, bestand);
    if (!existsSync(bron)) continue;

    const doel = bron.replace(/\.md$/, '.docx');
    const project = markdownNaarProject(readFileSync(bron, 'utf8'), { bestand });

    /*
     * Een reflectie is kort genoeg om zonder inhoudsopgave te lezen; bij de
     * documentatie helpt de inhoudsopgave juist.
     */
    const { buffer, statistiek } = bouwDocx(project, {
      koptekst: project.titel,
      voettekst: 'Dylan Schuurman',
      inhoudsopgave: !/^reflectie/i.test(project.titel),
    });

    writeFileSync(doel, buffer);
    console.log(
      `  ${path.relative(PROJECT, doel).padEnd(56)} ${String(statistiek.secties).padStart(2)} secties, ` +
        `${Math.round(buffer.length / 1024)} kB`,
    );
  }

  console.log('');
}

export { markdownNaarProject };
