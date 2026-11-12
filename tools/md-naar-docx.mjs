#!/usr/bin/env node
/**
 * Markdown naar Word.
 *
 * Waarom zelf en niet met een pakket: een .docx is een zip met een paar vaste
 * XML-bestanden erin. We hebben al een zip-schrijver in het project, dus het
 * enige dat erbij hoeft is het document zelf. Dat scheelt een afhankelijkheid
 * van een halve megabyte voor een functie die we één keer per document nodig
 * hebben.
 *
 * Wat het ondersteunt, en niet meer dan dat:
 *   # / ## / ###   koppen
 *   alinea's
 *   - lijstjes     bullets
 *   | tabellen |   met een kopregel
 *   > citaten      ingesprongen, cursief
 *   **vet**        binnen een alinea
 *   [tekst](url)   als platte tekst met het adres erachter
 *
 *   node tools/md-naar-docx.mjs "vault/Documentatie/cavascp documentatie.md"
 *   node tools/md-naar-docx.mjs --alles
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipBestanden } from '../dashboard/lib/zip-schrijf.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HIER, '..');

/* ───────────────────────────── XML-hulpjes ────────────────────────────── */

const esc = (tekst) =>
  String(tekst ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** **vet** en `code` omzetten naar Word-runs. */
function runs(tekst) {
  const stukken = [];
  const patroon = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|<https?:\/\/[^>]+>)/g;
  let laatste = 0;

  for (const match of String(tekst).matchAll(patroon)) {
    if (match.index > laatste) stukken.push({ tekst: tekst.slice(laatste, match.index) });

    const stuk = match[0];
    if (stuk.startsWith('**')) stukken.push({ tekst: stuk.slice(2, -2), vet: true });
    else if (stuk.startsWith('`')) stukken.push({ tekst: stuk.slice(1, -1), code: true });
    else if (stuk.startsWith('<')) stukken.push({ tekst: stuk.slice(1, -1) });
    else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(stuk);
      stukken.push({ tekst: `${link[1]} (${link[2]})` });
    }

    laatste = match.index + stuk.length;
  }

  if (laatste < tekst.length) stukken.push({ tekst: tekst.slice(laatste) });

  return stukken
    .filter((stuk) => stuk.tekst !== '')
    .map((stuk) => {
      const eigenschappen = [
        stuk.vet ? '<w:b/>' : '',
        stuk.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
      ].join('');

      return `<w:r>${eigenschappen ? `<w:rPr>${eigenschappen}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(stuk.tekst)}</w:t></w:r>`;
    })
    .join('');
}

const alinea = (tekst, { stijl, cursief = false, inset = 0 } = {}) => {
  const ppr = [
    stijl ? `<w:pStyle w:val="${stijl}"/>` : '',
    inset ? `<w:ind w:left="${inset}"/>` : '',
  ].join('');

  const rpr = cursief ? '<w:rPr><w:i/></w:rPr>' : '';
  const inhoud = cursief
    ? `<w:r>${rpr}<w:t xml:space="preserve">${esc(tekst)}</w:t></w:r>`
    : runs(tekst);

  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inhoud}</w:p>`;
};

const bullet = (tekst) =>
  `<w:p><w:pPr><w:pStyle w:val="Lijst"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${runs(tekst)}</w:p>`;

/** Een tabel met een kopregel, met randen. */
function tabel(rijen) {
  const breedte = Math.floor(9000 / Math.max(1, rijen[0].length));

  const cel = (tekst, { kop = false } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${breedte}" w:type="dxa"/>${
      kop ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEFEA"/>' : ''
    }</w:tcPr><w:p>${
      kop
        ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(tekst)}</w:t></w:r>`
        : runs(tekst)
    }</w:p></w:tc>`;

  const rand = 'w:val="single" w:sz="4" w:space="0" w:color="CCCCC4"';

  return `<w:tbl>
<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>
<w:top ${rand}/><w:left ${rand}/><w:bottom ${rand}/><w:right ${rand}/>
<w:insideH ${rand}/><w:insideV ${rand}/>
</w:tblBorders></w:tblPr>
${rijen
  .map(
    (rij, index) =>
      `<w:tr>${index === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${rij
        .map((celTekst) => cel(celTekst, { kop: index === 0 }))
        .join('')}</w:tr>`,
  )
  .join('\n')}
</w:tbl><w:p/>`;
}

/* ─────────────────────────── markdown ontleden ────────────────────────── */

export function markdownNaarBlokken(markdown) {
  const regels = markdown.replace(/\r/g, '').split('\n');
  const blokken = [];

  let tabelRijen = null;
  let alineaBuffer = [];

  const sluitAlinea = () => {
    if (alineaBuffer.length) {
      blokken.push(alinea(alineaBuffer.join(' ')));
      alineaBuffer = [];
    }
  };

  const sluitTabel = () => {
    if (tabelRijen?.length) blokken.push(tabel(tabelRijen));
    tabelRijen = null;
  };

  let inFrontmatter = false;

  for (let i = 0; i < regels.length; i += 1) {
    const regel = regels[i];

    // Frontmatter overslaan (de eerste twee regels met ---).
    if (regel.trim() === '---' && (i === 0 || inFrontmatter)) {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;

    if (/^\|/.test(regel)) {
      sluitAlinea();
      const cellen = regel
        .split('|')
        .slice(1, -1)
        .map((cel) => cel.trim());

      // De scheidingsregel (|---|---|) hoort niet in de tabel.
      if (cellen.every((cel) => /^-{2,}$/.test(cel.replace(/[: ]/g, '')))) continue;

      tabelRijen = tabelRijen ?? [];
      tabelRijen.push(cellen);
      continue;
    }

    sluitTabel();

    if (regel.trim() === '') {
      sluitAlinea();
      continue;
    }

    const kop = /^(#{1,3})\s+(.*)$/.exec(regel);
    if (kop) {
      sluitAlinea();
      const niveau = kop[1].length;
      blokken.push(alinea(kop[2], { stijl: niveau === 1 ? 'Titel' : niveau === 2 ? 'Kop1' : 'Kop2' }));
      continue;
    }

    /*
     * Genummerde regels ("1. Eerste punt") zijn in markdown losse alinea's.
     * Zonder deze tak plakt de parser ze aan elkaar tot één blok, en dan lees
     * je "1. ... 2. ... 3. ..." als één zin.
     */
    if (/^\d+\.\s+/.test(regel)) {
      sluitAlinea();
      blokken.push(alinea(regel));
      continue;
    }

    if (/^[-*]\s+/.test(regel)) {
      sluitAlinea();
      blokken.push(bullet(regel.replace(/^[-*]\s+/, '')));
      continue;
    }

    if (/^>\s?/.test(regel)) {
      sluitAlinea();
      blokken.push(alinea(regel.replace(/^>\s?/, ''), { cursief: true, inset: 360 }));
      continue;
    }

    alineaBuffer.push(regel.trim());
  }

  sluitAlinea();
  sluitTabel();

  return blokken.join('\n');
}

/* ────────────────────────────── docx maken ────────────────────────────── */

const DOCUMENT = (inhoud) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${inhoud}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418"/></w:sectPr>
</w:body>
</w:document>`;

const STIJLEN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:cs="Segoe UI"/>
<w:sz w:val="21"/><w:color w:val="1F2A24"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>

<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>

<w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/>
<w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="52"/><w:color w:val="1F3D2B"/></w:rPr></w:style>

<w:style w:type="paragraph" w:styleId="Kop1"><w:name w:val="heading 1"/>
<w:pPr><w:spacing w:before="360" w:after="120"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F3D2B"/></w:rPr></w:style>

<w:style w:type="paragraph" w:styleId="Kop2"><w:name w:val="heading 2"/>
<w:pPr><w:spacing w:before="280" w:after="100"/><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2F5D45"/></w:rPr></w:style>

<w:style w:type="paragraph" w:styleId="Lijst"><w:name w:val="List Paragraph"/>
<w:pPr><w:spacing w:after="80"/><w:ind w:left="360"/></w:pPr></w:style>
</w:styles>`;

const NUMMERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

export function maakDocx(markdown) {
  const inhoud = markdownNaarBlokken(markdown);

  return zipBestanden([
    { naam: '[Content_Types].xml', data: CONTENT_TYPES },
    { naam: '_rels/.rels', data: RELS },
    { naam: 'word/document.xml', data: DOCUMENT(inhoud) },
    { naam: 'word/_rels/document.xml.rels', data: DOC_RELS },
    { naam: 'word/styles.xml', data: STIJLEN },
    { naam: 'word/numbering.xml', data: NUMMERING },
  ]);
}

/* ─────────────────────────────── opdracht ─────────────────────────────── */

/** Bestanden die standaard omgezet worden met --alles. */
const STANDAARD = [
  'vault/Documentatie/cavascp documentatie.md',
  'vault/Documentatie/studio040 documentatie.md',
  'vault/Portfolio/Reflectie semester.md',
  'vault/Portfolio/Reflectie Studio040.md',
];

const argumenten = process.argv.slice(2);
const alles = argumenten.includes('--alles') || argumenten.length === 0;
const bestanden = alles
  ? STANDAARD.filter((bestand) => {
      try {
        readFileSync(path.join(PROJECT, bestand));
        return true;
      } catch {
        return false;
      }
    })
  : argumenten.filter((argument) => !argument.startsWith('--'));

if (!bestanden.length) {
  console.log('  Geen bestanden om om te zetten.\n  Gebruik: node tools/md-naar-docx.mjs <bestand.md>');
  process.exit(1);
}

for (const bestand of bestanden) {
  const bron = path.resolve(PROJECT, bestand);
  const doel = bron.replace(/\.md$/, '.docx');

  const buffer = maakDocx(readFileSync(bron, 'utf8'));
  writeFileSync(doel, buffer);

  console.log(`  ${path.relative(PROJECT, doel)}  (${Math.round(buffer.length / 1024)} kB)`);
}

console.log('');
