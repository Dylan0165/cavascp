/**
 * Word-generator — overgenomen uit Krava.
 *
 * Bron: D:\DOCAto\src\docx.js
 * Dit bestand is automatisch omgezet van CommonJS naar een ES-module door
 * tools/port-krava.mjs. Pas het niet met de hand aan: draai dat script opnieuw
 * in plaats daarvan, dan blijft het gelijk aan Krava.
 *
 * De generator heeft geen afhankelijkheden behalve ./zip.mjs.
 */

/**
 * Bouwt een volledig .docx-bestand (WordprocessingML) zonder externe libraries.
 * Ondersteunt: omslagpagina, inhoudsopgave-veld, inhoudelijke kopstijlen,
 * figuren met automatische nummering, tabellen, codeblokken, callouts,
 * APA-bronnenlijst, huisstijl (font, kleuren, logo) en kop-/voettekst.
 */

import { maakZip } from './zip.mjs';

const EMU_PER_CM = 360000;
const TWIPS_PER_CM = 567;

function esc(tekst) {
  return String(tekst ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(tekst) {
  return esc(tekst).replace(/'/g, '&apos;');
}

/** Zet een hexkleur om naar Word-notatie (zonder #). */
function kleur(waarde, terugval) {
  const m = String(waarde || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? m[1].toUpperCase() : terugval;
}

function donkerder(hex, factor = 0.72) {
  const m = String(hex).match(/^([0-9a-fA-F]{6})$/);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return ((r << 16) | (g << 8) | b).toString(16).toUpperCase().padStart(6, '0');
}

function cm(waarde) {
  return Math.round(waarde * EMU_PER_CM);
}

/* ------------------------------------------------------------------ *
 * Inline opmaak
 * ------------------------------------------------------------------ */

/**
 * Zet markdown-achtige inline opmaak om naar <w:r>-elementen.
 * Ondersteunt **vet**, *cursief*, `code`, [tekst](url) en losse URL's.
 */
function runs(tekst, ctx, basis = {}) {
  const uit = [];
  const bron = String(tekst ?? '');
  const rPrBasis = (extra = '') =>
    `<w:rPr>${basis.cursief ? '<w:i/>' : ''}${basis.vet ? '<w:b/>' : ''}${extra}</w:rPr>`;

  const patroon = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g;
  let laatste = 0;
  let m;
  while ((m = patroon.exec(bron)) !== null) {
    if (m.index > laatste) {
      uit.push(`<w:r>${rPrBasis()}<w:t xml:space="preserve">${esc(bron.slice(laatste, m.index))}</w:t></w:r>`);
    }
    const stuk = m[0];
    if (stuk.startsWith('`')) {
      uit.push(
        `<w:r>${rPrBasis(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="${ctx.kleuren.codeTekst}"/><w:shd w:val="clear" w:color="auto" w:fill="${ctx.kleuren.codeAchtergrond}"/>`)}<w:t xml:space="preserve">${esc(stuk.slice(1, -1))}</w:t></w:r>`
      );
    } else if (stuk.startsWith('**') || stuk.startsWith('__')) {
      uit.push(`<w:r>${rPrBasis(basis.vet ? '' : '<w:b/>')}<w:t xml:space="preserve">${esc(stuk.slice(2, -2))}</w:t></w:r>`);
    } else if (stuk.startsWith('[')) {
      const mm = stuk.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const label = mm ? mm[1] : stuk;
      const url = mm ? mm[2] : '';
      uit.push(
        `<w:hyperlink r:id="${ctx.voegHyperlinkToe(url)}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${esc(label)}</w:t></w:r></w:hyperlink>`
      );
    } else if (/^https?:/.test(stuk)) {
      uit.push(
        `<w:hyperlink r:id="${ctx.voegHyperlinkToe(stuk)}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${esc(stuk)}</w:t></w:r></w:hyperlink>`
      );
    } else {
      uit.push(`<w:r>${rPrBasis(basis.cursief ? '' : '<w:i/>')}<w:t xml:space="preserve">${esc(stuk.slice(1, -1))}</w:t></w:r>`);
    }
    laatste = m.index + stuk.length;
  }
  if (laatste < bron.length) {
    uit.push(`<w:r>${rPrBasis()}<w:t xml:space="preserve">${esc(bron.slice(laatste))}</w:t></w:r>`);
  }
  return uit.join('');
}

/* ------------------------------------------------------------------ *
 * Stijlen
 * ------------------------------------------------------------------ */

function stylesXml(ctx) {
  const k = ctx.kleuren;
  const body = ctx.font.tekst;
  const kop = ctx.font.kop;
  const mono = ctx.font.mono;
  const sp = ctx.spacing;

  const kopStijl = (id, niveau, grootte, kleurWaarde, ruimteVoor, ruimteNa) => `
  <w:style w:type="paragraph" w:styleId="${id}">
    <w:name w:val="heading ${niveau}"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:keepLines/>
      <w:numPr><w:ilvl w:val="${niveau - 1}"/><w:numId w:val="1"/></w:numPr>
      <w:spacing w:before="${ruimteVoor}" w:after="${ruimteNa}"${sp.regelafstand ? ` w:line="${sp.regelafstand}" w:lineRule="auto"` : ''}/>
      <w:outlineLvl w:val="${niveau - 1}"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="${kop}" w:hAnsi="${kop}" w:cs="${kop}"/>
      <w:b/>
      <w:color w:val="${kleurWaarde}"/>
      <w:sz w:val="${grootte * 2}"/>
      <w:szCs w:val="${grootte * 2}"/>
    </w:rPr>
  </w:style>`;

  const titelGrootte = ctx.font.titelGrootte || 26;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="${body}" w:hAnsi="${body}" w:cs="${body}"/>
        <w:color w:val="${k.tekst}"/>
        <w:sz w:val="${ctx.font.tekstGrootte * 2}"/>
        <w:szCs w:val="${ctx.font.tekstGrootte * 2}"/>
        <w:lang w:val="nl-NL" w:eastAsia="nl-NL" w:bidi="ar-SA"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="${sp.naAlinea * 20}"${sp.regelafstand ? ` w:line="${sp.regelafstand}" w:lineRule="auto"` : ''}/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="0" w:after="${sp.naAlinea * 20}"${sp.regelafstand ? ` w:line="${sp.regelafstand}" w:lineRule="auto"` : ''}/>
      <w:jc w:val="both"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="TitelDoc">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="240"/><w:jc w:val="center"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="${kop}" w:hAnsi="${kop}"/>
      <w:b/><w:color w:val="${k.accent}"/>
      <w:sz w:val="${titelGrootte * 2}"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="OmslagMeta">
    <w:name w:val="Omslag metadata"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="20" w:after="20"/><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="${ctx.font.tekstGrootte * 2}"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="OmslagSubtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="360"/><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="${kop}" w:hAnsi="${kop}"/><w:color w:val="${k.subtekst}"/><w:sz w:val="${(ctx.font.tekstGrootte + 4) * 2}"/></w:rPr>
  </w:style>

  ${kopStijl('heading 1', 1, ctx.font.kopGrootte[0], k.accent, 320, 120)}

  ${kopStijl('heading 2', 2, ctx.font.kopGrootte[1], k.kop2, 280, 100)}

  ${kopStijl('heading 3', 3, ctx.font.kopGrootte[2], k.kop3, 240, 80)}

  <w:style w:type="paragraph" w:styleId="Figuur">
    <w:name w:val="Figuur"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="80"/>
      <w:jc w:val="center"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Bijschrift">
    <w:name w:val="caption"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepLines/>
      <w:spacing w:before="0" w:after="240"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:color w:val="${k.subtekst}"/>
      <w:i/>
      <w:sz w:val="${Math.max(8, ctx.font.tekstGrootte - 1) * 2}"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="CodeBlok">
    <w:name w:val="Code Blok"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepLines/>
      <w:spacing w:before="160" w:after="200" w:line="240" w:lineRule="auto"/>
      <w:shd w:val="clear" w:color="auto" w:fill="${k.codeAchtergrond}"/>
      <w:pBdr>
        <w:top w:val="single" w:sz="4" w:space="6" w:color="${k.codeRand}"/>
        <w:left w:val="single" w:sz="18" w:space="6" w:color="${k.accent}"/>
        <w:bottom w:val="single" w:sz="4" w:space="6" w:color="${k.codeRand}"/>
        <w:right w:val="single" w:sz="4" w:space="6" w:color="${k.codeRand}"/>
      </w:pBdr>
      <w:ind w:left="170" w:right="170"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="${mono}" w:hAnsi="${mono}" w:cs="${mono}"/>
      <w:color w:val="${k.codeTekst}"/>
      <w:sz w:val="${Math.max(8, ctx.font.tekstGrootte - 1.5) * 2}"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Callout">
    <w:name w:val="Callout"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepLines/>
      <w:spacing w:before="160" w:after="200"/>
      <w:shd w:val="clear" w:color="auto" w:fill="${k.calloutAchtergrond}"/>
      <w:pBdr>
        <w:left w:val="single" w:sz="18" w:space="8" w:color="${k.calloutRand}"/>
        <w:top w:val="single" w:sz="4" w:space="6" w:color="${k.calloutAchtergrond}"/>
        <w:bottom w:val="single" w:sz="4" w:space="6" w:color="${k.calloutAchtergrond}"/>
        <w:right w:val="single" w:sz="4" w:space="6" w:color="${k.calloutAchtergrond}"/>
      </w:pBdr>
      <w:ind w:left="170" w:right="170"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="CalloutTitel">
    <w:name w:val="Callout titel"/>
    <w:basedOn w:val="Callout"/>
    <w:next w:val="Callout"/>
    <w:pPr>
      <w:spacing w:before="160" w:after="40"/>
      <w:keepNext/>
    </w:pPr>
    <w:rPr><w:b/><w:color w:val="${k.calloutRand}"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Bron">
    <w:name w:val="Bronvermelding"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="140"/>
      <w:ind w:left="567" w:hanging="567"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="LijstItem">
    <w:name w:val="Lijstitem"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="60"/><w:contextualSpacing/></w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="InhoudsopgaveKop">
    <w:name w:val="TOC Heading"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="0" w:after="240"/>
      <w:outlineLvl w:val="9"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="${kop}" w:hAnsi="${kop}"/>
      <w:b/>
      <w:color w:val="${k.accent}"/>
      <w:sz w:val="${ctx.font.kopGrootte[0] * 2}"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="TOC1">
    <w:name w:val="toc 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:after="60"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TOC2">
    <w:name w:val="toc 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:after="40"/><w:ind w:left="227"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TOC3">
    <w:name w:val="toc 3"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:after="20"/><w:ind w:left="454"/></w:pPr>
  </w:style>

  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="${k.link}"/><w:u w:val="single"/></w:rPr>
  </w:style>

  <w:style w:type="table" w:styleId="TabelDoc">
    <w:name w:val="Tabel"/>
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="${k.tabelRand}"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="${k.tabelRand}"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="${k.tabelRand}"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="${k.tabelRand}"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="${k.tabelRand}"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="${k.tabelRand}"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="72" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>
        <w:bottom w:w="72" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
  </w:style>
</w:styles>`;
}

/* ------------------------------------------------------------------ *
 * Nummering (koppen) en instellingen
 * ------------------------------------------------------------------ */

function numberingXml(ctx) {
  const k = ctx.kleuren;
  const kop = ctx.font.kop;
  const niveau = (ilvl, grootte, kleurWaarde) => `
      <w:lvl w:ilvl="${ilvl}">
        <w:start w:val="1"/>
        <w:numFmt w:val="decimal"/>
        <w:pStyle w:val="heading ${ilvl + 1}"/>
        <w:suff w:val="space"/>
        <w:lvlText w:val="${Array.from({ length: ilvl + 1 }, (_, i) => `%${i + 1}`).join('.')}"/>
        <w:lvlJc w:val="left"/>
        <w:pPr><w:ind w:left="0" w:hanging="0"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="${kop}" w:hAnsi="${kop}" w:hint="default"/><w:b/><w:color w:val="${kleurWaarde}"/><w:sz w:val="${grootte * 2}"/></w:rPr>
      </w:lvl>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="multilevel"/>
    ${niveau(0, ctx.font.kopGrootte[0], k.accent)}
    ${niveau(1, ctx.font.kopGrootte[1], k.kop2)}
    ${niveau(2, ctx.font.kopGrootte[2], k.kop3)}
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;
}

function settingsXml(ctx) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  ${ctx.werkInhoudsopgaveBij ? '<w:updateFields w:val="true"/>' : ''}
  <w:defaultTabStop w:val="708"/>
  <w:characterSpacingControl w:val="doNotCompress"/>
  <w:compat>
    <w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
  </w:compat>
</w:settings>`;
}

function coreXml(project) {
  const nu = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(project.titel || 'Document')}</dc:title>
  <dc:creator>${esc(project.auteur || '')}</dc:creator>
  <cp:lastModifiedBy>${esc(project.auteur || '')}</cp:lastModifiedBy>
  <cp:revision>1</cp:revision>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nu}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nu}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml() {
  // Geen naam van de maker van het bestand in de eigenschappen: in het
  // document hoort niets te staan dat niet van de schrijver is.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <AppVersion>16.0000</AppVersion>
</Properties>`;
}

/* ------------------------------------------------------------------ *
 * Kop- en voettekst
 * ------------------------------------------------------------------ */

function koptekstXml(ctx, project) {
  const tekst = String(ctx.koptekst || '').trim();
  const titel = project.titel || '';
  const inhoud = tekst || titel;
  const k = ctx.kleuren;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${k.tabelRand}"/></w:pBdr>
      <w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs>
      <w:spacing w:after="60"/>
      <w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr>
    </w:pPr>
    <w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${esc(inhoud)}</w:t></w:r>
    ${project.subtitel ? `<w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:tab/><w:t xml:space="preserve">${esc(project.subtitel)}</w:t></w:r>` : ''}
  </w:p>
</w:hdr>`;
}

function voettekstXml(ctx) {
  const k = ctx.kleuren;
  const links = String(ctx.voettekst || '').trim();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs>
      <w:spacing w:before="60"/>
      <w:jc w:val="left"/>
      <w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr>
    </w:pPr>
    <w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${esc(links)}</w:t></w:r>
    <w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:tab/><w:t xml:space="preserve">${esc(ctx.paginanummer ? 'Pagina ' : '')}</w:t></w:r>
    ${ctx.paginanummer ? `<w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>
    <w:r><w:rPr><w:color w:val="${k.subtekst}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>` : ''}
  </w:p>
</w:ftr>`;
}

/* ------------------------------------------------------------------ *
 * Documentinhoud
 * ------------------------------------------------------------------ */

function inhoudsopgaveXml(ctx) {
  // De inhoudsopgave is een echt Word-veld: bij het openen vult Word hem
  // opnieuw, want settings.xml zet updateFields aan. Zijn de regels al bekend
  // (opties.inhoudsopgaveRegels), dan zetten we ze als tussenresultaat in het
  // veld. Zo klopt de inhoudsopgave ook bij een lezer die geen velden bijwerkt,
  // zoals een pdf-export of een online viewer.
  const regels = Array.isArray(ctx.inhoudsopgaveRegels) ? ctx.inhoudsopgaveRegels : [];
  const tussen = regels
    .map((regel) => {
      const niveau = Math.min(3, Math.max(1, Number(regel.niveau) || 1));
      return `
  <w:p>
    <w:pPr><w:pStyle w:val="TOC${niveau}"/><w:rPr><w:noProof/></w:rPr></w:pPr>
    <w:r><w:t xml:space="preserve">${esc(String(regel.tekst || ''))}</w:t></w:r>
    <w:r><w:tab/></w:r>
    <w:r><w:t>${esc(String(regel.pagina ?? ''))}</w:t></w:r>
  </w:p>`;
    })
    .join('');

  return `
  <w:p>
    <w:pPr><w:pStyle w:val="InhoudsopgaveKop"/></w:pPr>
    <w:r><w:t>${esc(ctx.labels.inhoudsopgave)}</w:t></w:r>
  </w:p>
  <w:p>
    <w:pPr><w:rPr><w:noProof/></w:rPr></w:pPr>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    ${tussen ? '' : `<w:r><w:t xml:space="preserve">${esc(ctx.labels.tocVernieuwen)}</w:t></w:r>`}
  </w:p>${tussen}
  <w:p>
    <w:pPr><w:rPr><w:noProof/></w:rPr></w:pPr>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>`;
}

function omslagXml(ctx, project, sectPrOmslag = '') {
  const regels = [];
  if (ctx.logo) {
    const breedteCm = ctx.logoBreedteCm || 3.2;
    const schaal = breedteCm / ctx.logo.breedteCm;
    regels.push(`
  <w:p>
    <w:pPr><w:spacing w:before="1200" w:after="400"/><w:jc w:val="center"/></w:pPr>
    <w:r>${afbeeldingRun(ctx, ctx.logo, schaal)}</w:r>
  </w:p>`);
  } else {
    regels.push('<w:p><w:pPr><w:spacing w:before="1400"/></w:pPr></w:p>');
  }

  regels.push(`
  <w:p>
    <w:pPr><w:pStyle w:val="OmslagMeta"/></w:pPr>
    <w:r><w:t xml:space="preserve">${esc(project.instelling || '')}</w:t></w:r>
  </w:p>
  <w:p>
    <w:pPr><w:pStyle w:val="TitelDoc"/></w:pPr>
    <w:r><w:t xml:space="preserve">${esc(project.titel || 'Naamloos document')}</w:t></w:r>
  </w:p>`);

  if (project.subtitel) {
    regels.push(`
  <w:p>
    <w:pPr><w:pStyle w:val="OmslagSubtitle"/></w:pPr>
    <w:r><w:t xml:space="preserve">${esc(project.subtitel)}</w:t></w:r>
  </w:p>`);
  } else {
    regels.push('<w:p><w:pPr><w:spacing w:after="360"/></w:pPr></w:p>');
  }

  const meta = [];
  if (project.auteur) meta.push(`${ctx.labels.auteur}: ${project.auteur}`);
  if (project.opleiding) meta.push(`${ctx.labels.opleiding}: ${project.opleiding}`);
  if (project.vak) meta.push(`${ctx.labels.vak}: ${project.vak}`);
  if (project.begeleiders) meta.push(`${ctx.labels.begeleiders}: ${project.begeleiders}`);
  if (project.datum) meta.push(`${ctx.labels.datum}: ${project.datum}`);
  if (project.versie) meta.push(`${ctx.labels.versie}: ${project.versie}`);

  for (const regel of meta) {
    regels.push(`
  <w:p>
    <w:pPr><w:pStyle w:val="OmslagMeta"/></w:pPr>
    <w:r><w:t xml:space="preserve">${esc(regel)}</w:t></w:r>
  </w:p>`);
  }

  // De omslagsectie eindigt hier. De sectPr in deze alinea zorgt ervoor dat de
  // inhoudsopgave op een nieuwe pagina begint, zonder losse pagina-einde.
  if (sectPrOmslag) {
    regels.push(`<w:p><w:pPr>${sectPrOmslag}</w:pPr></w:p>`);
  } else {
    regels.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  return regels.join('');
}

function afbeeldingRun(ctx, beeld, schaal = 1) {
  const relId = ctx.voegAfbeeldingToe(beeld);
  const cx = Math.round(beeld.breedteCm * schaal * EMU_PER_CM);
  const cy = Math.round(beeld.hoogteCm * schaal * EMU_PER_CM);
  const id = ctx.volgendeDrawingsId();
  return `<w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="${cx}" cy="${cy}"/>
        <wp:effectExtent l="0" t="0" r="0" b="0"/>
        <wp:docPr id="${id}" name="Afbeelding ${id}" descr="${escAttr(beeld.alt || '')}"/>
        <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr>
                <pic:cNvPr id="${id}" name="${escAttr(beeld.bestandsnaam || 'afbeelding')}" descr="${escAttr(beeld.alt || '')}"/>
                <pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="${relId}"/>
                <a:srcRect/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr bwMode="auto">
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>`;
}

function paragraaf(tekst, stijl, ctx, extraPr = '') {
  const pPr = `<w:pPr>${stijl ? `<w:pStyle w:val="${stijl}"/>` : ''}${extraPr}</w:pPr>`;
  return `<w:p>${pPr}${runs(tekst, ctx)}</w:p>`;
}

function codeBlokXml(code, ctx) {
  const regels = String(code).replace(/\t/g, '    ').split('\n');
  return regels
    .map(
      (regel, index) =>
        `<w:p><w:pPr><w:pStyle w:val="CodeBlok"/>${index < regels.length - 1 ? '<w:keepNext/>' : ''}</w:pPr>${runs(regel || ' ', ctx)}</w:p>`
    )
    .join('');
}

function calloutXml(blok, ctx) {
  const titels = {
    note: ctx.labels.calloutNote,
    tip: ctx.labels.calloutTip,
    important: ctx.labels.calloutBelangrijk,
    warning: ctx.labels.calloutWaarschuwing
  };
  const titel = blok.titel || titels[blok.soort] || titels.note;
  const delen = [];
  delen.push(`<w:p><w:pPr><w:pStyle w:val="CalloutTitel"/></w:pPr>${runs(titel, ctx, { vet: true })}</w:p>`);
  const alineas = String(blok.tekst || '').split(/\n{2,}/).filter((a) => a.trim());
  for (const alinea of alineas) {
    delen.push(`<w:p><w:pPr><w:pStyle w:val="Callout"/></w:pPr>${runs(alinea.replace(/\n/g, ' '), ctx)}</w:p>`);
  }
  return delen.join('');
}

function tabelXml(blok, ctx) {
  const kolommen = Math.max(blok.kop.length, ...blok.rijen.map((r) => r.length), 1);
  const breedte = Math.floor(ctx.tekstBreedteTwips / kolommen);
  const cel = (tekst, { kop = false, eersteKolom = false } = {}) => `
      <w:tc>
        <w:tcPr>
          <w:tcW w:w="${breedte}" w:type="dxa"/>
          ${kop ? `<w:shd w:val="clear" w:color="auto" w:fill="${ctx.kleuren.tabelKop}"/>` : ''}
        </w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="20" w:after="20"/><w:jc w:val="left"/></w:pPr>
          ${runs(String(tekst ?? ''), ctx, { vet: kop || eersteKolom })}
        </w:p>
      </w:tc>`;
  const rijen = [];
  if (blok.kop.some((k) => k !== '')) {
    rijen.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${blok.kop.map((k) => cel(k, { kop: true })).join('')}</w:tr>`);
  }
  for (const rij of blok.rijen) {
    const cellen = [];
    for (let i = 0; i < kolommen; i++) cellen.push(cel(rij[i] ?? '', { eersteKolom: i === 0 && !blok.kop.length }));
    rijen.push(`<w:tr>${cellen.join('')}</w:tr>`);
  }
  return `
  <w:tbl>
    <w:tblPr>
      <w:tblStyle w:val="TabelDoc"/>
      <w:tblW w:w="${ctx.tekstBreedteTwips}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
    </w:tblPr>
    <w:tblGrid>${Array.from({ length: kolommen }, () => `<w:gridCol w:w="${breedte}"/>`).join('')}</w:tblGrid>
    ${rijen.join('')}
  </w:tbl>
  <w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
}

/**
 * Bouwt het document.
 *
 * @param {object} project  titel, subtitel, auteur, secties[{titel, blokken}], bronnen[]
 * @param {object} opties   stijl, huisstijl, afbeeldingen, labels
 * @returns {{buffer: Buffer, statistiek: object}}
 */
function bouwDocx(project, opties) {
  const optiesKleuren = opties.kleuren || {};
  const ctx = {
    labels: Object.assign(
      {
        inhoudsopgave: 'Inhoudsopgave',
        tocVernieuwen: 'Vernieuw de inhoudsopgave in Word met F9 of rechtsklik > Velden bijwerken.',
        auteur: 'Auteur',
        opleiding: 'Opleiding',
        vak: 'Vak',
        begeleiders: 'Begeleiders',
        datum: 'Datum',
        versie: 'Versie',
        figuur: 'Figuur',
        bronnen: 'Bronnen',
        calloutNote: 'Toelichting',
        calloutTip: 'Tip',
        calloutBelangrijk: 'Belangrijk',
        calloutWaarschuwing: 'Waarschuwing'
      },
      opties.labels || {}
    ),
    kleuren: {
      accent: kleur(optiesKleuren.accent, 'B08127'),
      kop2: kleur(optiesKleuren.kop2, '2E5BA8'),
      kop3: kleur(optiesKleuren.kop3, '4A6FA5'),
      tekst: kleur(optiesKleuren.tekst, '1A1A1A'),
      subtekst: kleur(optiesKleuren.subtekst, '5A6472'),
      link: kleur(optiesKleuren.link, '1F6FEB'),
      codeAchtergrond: kleur(optiesKleuren.codeAchtergrond, 'F5F6F8'),
      codeRand: kleur(optiesKleuren.codeRand, 'D8DCE3'),
      codeTekst: kleur(optiesKleuren.codeTekst, '24292F'),
      calloutAchtergrond: kleur(optiesKleuren.calloutAchtergrond, 'EEF3FB'),
      calloutRand: kleur(optiesKleuren.calloutRand, kleur(optiesKleuren.accent, 'B08127')),
      tabelKop: kleur(optiesKleuren.tabelKop, 'E8EDF6'),
      tabelRand: kleur(optiesKleuren.tabelRand, 'C6CEDA')
    },
    font: Object.assign(
      {
        tekst: 'Calibri',
        kop: 'Calibri',
        mono: 'Consolas',
        tekstGrootte: 10.5,
        kopGrootte: [17, 13.5, 11.5],
        titelGrootte: 26
      },
      opties.font || {}
    ),
    spacing: Object.assign({ naAlinea: 6, regelafstand: 276 }, opties.spacing || {}),
    inhoudsopgaveRegels: Array.isArray(opties.inhoudsopgaveRegels) ? opties.inhoudsopgaveRegels : [],
    werkInhoudsopgaveBij: opties.werkInhoudsopgaveBij !== false,
    paginanummer: opties.paginanummer !== false,
    koptekst: opties.koptekst,
    voettekst: opties.voettekst
  };

  const paginaBreedteCm = 21 - (opties.marges?.links ?? 2.5) - (opties.marges?.rechts ?? 2.5);
  ctx.tekstBreedteCm = paginaBreedteCm;
  ctx.tekstBreedteTwips = Math.round(paginaBreedteCm * TWIPS_PER_CM);

  /* --- afbeeldingen en relaties --- */
  const afbeeldingen = new Map(); // sleutel -> {buffer, extensie, breedteCm, hoogteCm}
  const relaties = [
    {
      id: 'rIdStyles',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
      doel: 'styles.xml'
    },
    {
      id: 'rIdNumbering',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
      doel: 'numbering.xml'
    },
    {
      id: 'rIdSettings',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
      doel: 'settings.xml'
    },
    {
      id: 'rIdHeader',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
      doel: 'header1.xml'
    },
    {
      id: 'rIdFooter',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
      doel: 'footer1.xml'
    }
  ];
  let volgendeRel = 0;

  ctx.voegHyperlinkToe = (url) => {
    const bestaand = relaties.find((r) => r.external && r.doel === url);
    if (bestaand) return bestaand.id;
    const id = `rIdLink${volgendeRel++}`;
    relaties.push({
      id,
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      doel: url,
      external: true
    });
    return id;
  };

  let drawingId = 1;
  ctx.volgendeDrawingsId = () => ++drawingId;

  const media = [];
  ctx.voegAfbeeldingToe = (beeld) => {
    if (!beeld || !beeld.bytes) throw new Error(`Afbeelding ontbreekt of is leeg (${beeld?.naam || 'onbekend'}).`);
    const bestaand = afbeeldingen.get(beeld.naam);
    if (bestaand) return bestaand.relId;
    // Een bewegend beeld staat in Word stil: daar gebruiken we het eerste beeld
    // van de animatie. Zonder dit zou er een gif in een png-bestand belanden en
    // weigert Word het hele document.
    const bron = beeld.stil && beeld.stil.bytes ? beeld.stil : beeld;
    const extensie = bron.formaat === 'jpeg' ? 'jpg' : bron.formaat === 'gif' ? 'gif' : 'png';
    const bestandsnaam = `media/beeld${afbeeldingen.size + 1}.${extensie}`;
    const relId = `rIdImg${afbeeldingen.size + 1}`;
    afbeeldingen.set(beeld.naam, { relId, bestandsnaam, bytes: bron.bytes });
    relaties.push({
      id: relId,
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      doel: bestandsnaam
    });
    media.push({ naam: `word/${bestandsnaam}`, data: bron.bytes });
    return relId;
  };

  /* --- figuren voorbereiden --- */
  const figuren = new Map();
  for (const figuur of opties.afbeeldingen || []) {
    figuren.set(figuur.naam, figuur);
  }

  const figurenTeller = { n: 0 };
  const gebruikteAfbeeldingen = new Set();

  const figuurXml = (beeld, caption, ctx2) => {
    figurenTeller.n += 1;
    gebruikteAfbeeldingen.add(beeld.naam);
    const beschikbaar = ctx2.tekstBreedteCm;
    const maxHoogteCm = 19.5;
    const breedteCm = Math.min(beschikbaar * (opties.afbeeldingBreedte ?? 1), beschikbaar);
    let schaal = breedteCm / beeld.breedteCm;
    if (beeld.hoogteCm * schaal > maxHoogteCm) schaal = maxHoogteCm / beeld.hoogteCm;
    const tekening = afbeeldingRun(ctx2, beeld, schaal);
    const label = caption && caption.trim() ? caption.trim() : beeld.titel || beeld.alt || '';
    return `
  <w:p><w:pPr><w:pStyle w:val="Figuur"/></w:pPr><w:r>${tekening}</w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Bijschrift"/></w:pPr>${runs(`${ctx2.labels.figuur} ${figurenTeller.n} — ${label}`.trim(), ctx2)}</w:p>`;
  };

  const blokNaarXml = (blok) => {
    switch (blok.type) {
      case 'heading':
        return `<w:p><w:pPr><w:pStyle w:val="heading 1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr>${runs(blok.tekst, ctx)}</w:p>`;
      case 'subheading':
        // Een tussenkop uit de tekst is een echte Word-kop (Kop 2 of Kop 3),
        // maar zonder nummer: de nummering hoort bij de sectie-indeling.
        return `<w:p><w:pPr><w:pStyle w:val="heading ${blok.niveau === 2 ? 2 : 3}"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr>${runs(blok.tekst, ctx)}</w:p>`;
      case 'paragraph':
        return paragraaf(blok.tekst, 'BodyText', ctx);
      case 'code':
        return codeBlokXml(blok.tekst, ctx);
      case 'callout':
        return calloutXml(blok, ctx);
      case 'table':
        return tabelXml(blok, ctx);
      case 'list': {
        const items = blok.items
          .map((item) => {
            const niveau = Math.min(item.niveau || 0, 2);
            const teken = item.genummerd ? '' : '• ';
            const pr = `<w:numPr><w:ilvl w:val="${niveau}"/><w:numId w:val="0"/></w:numPr><w:ind w:left="${340 + niveau * 340}" w:hanging="227"/><w:spacing w:before="0" w:after="60"/>`;
            const prefix = item.genummerd ? '' : teken;
            return `<w:p><w:pPr><w:pStyle w:val="LijstItem"/>${pr}</w:pPr>${prefix ? `<w:r><w:t xml:space="preserve">${esc(prefix)}</w:t></w:r>` : ''}${runs(item.tekst, ctx)}</w:p>`;
          })
          .join('');
        return items;
      }
      case 'figure': {
        const beeld = figuren.get(blok.ref);
        if (!beeld) {
          return `<w:p><w:pPr><w:pStyle w:val="Bijschrift"/></w:pPr>${runs(`[ontbrekende afbeelding: ${blok.ref}]`, ctx)}</w:p>`;
        }
        return figuurXml(beeld, blok.caption, ctx);
      }
      case 'hr':
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C6CEDA"/></w:pBdr><w:spacing w:after="200"/></w:pPr></w:p>';
      default:
        return '';
    }
  };

  /* --- document opbouwen --- */
  const romp = [];

  if (opties.omslag !== false) {
    // De sectie-eigenschappen van de omslag horen achter de omslag zelf: een
    // alinea met een sectPr erin sluit de sectie af. Stond dit blok vóór de
    // omslag, dan begon het document met een lege pagina en viel de omslag in
    // de hoofdsectie, waardoor de kop- en voettekst ook op de omslag stonden.
    const margeOmslag = opties.marges || {};
    const sectPrOmslag = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:titlePg/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${Math.round((margeOmslag.boven ?? 2.5) * TWIPS_PER_CM)}" w:right="${Math.round((margeOmslag.rechts ?? 2.5) * TWIPS_PER_CM)}" w:bottom="${Math.round((margeOmslag.onder ?? 2.5) * TWIPS_PER_CM)}" w:left="${Math.round((margeOmslag.links ?? 2.5) * TWIPS_PER_CM)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
    romp.push(omslagXml(ctx, project, sectPrOmslag));
  }

  if (opties.inhoudsopgave !== false && (project.secties || []).length > 0) {
    romp.push(inhoudsopgaveXml(ctx));
    romp.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }

  const sectielijst = project.secties || [];
  for (const sectie of sectielijst) {
    // De koppen zijn echte Word-koppen (Kop 1, Kop 2, Kop 3). Het nummer komt
    // uit de nummering die aan die stijlen hangt, dus niet als tekst erbij:
    // anders staat het er twee keer en klopt de inhoudsopgave niet meer.
    if (sectie.niveau > 1) {
      const stijl = sectie.niveau === 2 ? 'heading 2' : 'heading 3';
      romp.push(`<w:p><w:pPr><w:pStyle w:val="${stijl}"/></w:pPr>${runs(sectie.titel, ctx)}</w:p>`);
    } else {
      romp.push(`<w:p><w:pPr><w:pStyle w:val="heading 1"/></w:pPr>${runs(sectie.titel, ctx)}</w:p>`);
    }
    for (const blok of sectie.blokken || []) {
      romp.push(blokNaarXml(blok));
    }
  }

  if (opties.bronnen !== false && (project.bronnen || []).length) {
    romp.push(`<w:p><w:pPr><w:pStyle w:val="heading 1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr>${runs(ctx.labels.bronnen, ctx)}</w:p>`);
    for (const bron of project.bronnen) {
      romp.push(paragraaf(bron.tekst, 'Bron', ctx));
    }
  }

  /* --- sectie-eigenschappen: staande sectie + eventueel extra --- */
  const marge = opties.marges || {};
  const sectPrStaand = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${Math.round((marge.boven ?? 2.5) * TWIPS_PER_CM)}" w:right="${Math.round((marge.rechts ?? 2.5) * TWIPS_PER_CM)}" w:bottom="${Math.round((marge.onder ?? 2.5) * TWIPS_PER_CM)}" w:left="${Math.round((marge.links ?? 2.5) * TWIPS_PER_CM)}" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
${romp.join('\n')}
    ${sectPrStaand}
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relaties
  .map(
    (rel) =>
      `  <Relationship Id="${rel.id}" Type="${rel.type}" Target="${escAttr(rel.doel)}"${rel.external ? ' TargetMode="External"' : ''}/>`
  )
  .join('\n')}
</Relationships>`;

  const bestanden = [
    { naam: '[Content_Types].xml', data: contentTypes },
    { naam: '_rels/.rels', data: rootRels },
    { naam: 'word/document.xml', data: documentXml },
    { naam: 'word/_rels/document.xml.rels', data: docRels },
    { naam: 'word/styles.xml', data: stylesXml(ctx) },
    { naam: 'word/numbering.xml', data: numberingXml(ctx) },
    { naam: 'word/settings.xml', data: settingsXml(ctx) },
    { naam: 'word/header1.xml', data: koptekstXml(ctx, project) },
    { naam: 'word/footer1.xml', data: voettekstXml(ctx) },
    { naam: 'docProps/core.xml', data: coreXml(project) },
    { naam: 'docProps/app.xml', data: appXml() },
    ...media
  ];

  const buffer = maakZip(bestanden);
  return {
    buffer,
    statistiek: {
      figuren: figurenTeller.n,
      afbeeldingen: media.length,
      secties: (project.secties || []).length,
      bytes: buffer.length
    }
  };
}

export { bouwDocx, esc, kleur, donkerder };
