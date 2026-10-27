/**
 * Markdown naar blokken — overgenomen uit Krava.
 *
 * Bron: D:\DOCAto\src\markdown.js
 * Dit bestand is automatisch omgezet van CommonJS naar een ES-module door
 * tools/port-krava.mjs. Pas het niet met de hand aan: draai dat script opnieuw
 * in plaats daarvan, dan blijft het gelijk aan Krava.
 *
 * De generator heeft geen afhankelijkheden behalve ./zip.mjs.
 */

/**
 * Lichtgewicht markdown-ontleder, toegespitst op wat het model teruggeeft:
 * koppen, alinea's, lijsten, codeblokken, callouts, tabellen en figuurmarkers.
 * Inline opmaak wordt pas bij het schrijven van de docx omgezet.
 */

/** Splitst een tabelrij op de buitenste pipes, met respect voor escapes. */
function splitTabelrij(regel) {
  let schoon = regel.trim();
  if (schoon.startsWith('|')) schoon = schoon.slice(1);
  if (schoon.endsWith('|') && !schoon.endsWith('\\|')) schoon = schoon.slice(0, -1);
  const cellen = [];
  let huidig = '';
  for (let i = 0; i < schoon.length; i++) {
    const ch = schoon[i];
    if (ch === '\\' && schoon[i + 1] === '|') {
      huidig += '|';
      i++;
    } else if (ch === '|') {
      cellen.push(huidig.trim());
      huidig = '';
    } else {
      huidig += ch;
    }
  }
  cellen.push(huidig.trim());
  return cellen;
}

function isTabelScheiding(regel) {
  return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(regel) && regel.includes('-');
}

/** Herkent een figuurmarker en geeft { id, caption } terug, of null. */
function leesFiguurMarker(regel, volgendeRegel) {
  const comment = regel.match(/^\s*<!--\s*FIGUUR\s*:\s*([A-Za-z0-9_-]+)(?:\s*\|\s*([^>]*?))?\s*-->\s*$/i);
  if (comment) {
    const caption = comment[2] ? comment[2].trim() : volgendeRegel && volgendeRegel.trim() ? volgendeRegel.trim() : '';
    return { id: comment[1], caption };
  }
  const md = regel.match(/^\s*!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)\s*$/);
  if (md) return { id: md[2].trim(), caption: (md[1] || '').trim() };
  const kaal = regel.match(/^\s*(?:FIGUUR|FIG|AFBEELDING)\s*[:#]?\s*([A-Za-z0-9_-]{2,})\s*$/i);
  if (kaal) return { id: kaal[1], caption: '' };
  return null;
}

/**
 * @param {string} tekst
 * @param {string} [sectiekop]  als meegegeven, wordt een eerste kop die exact
 *                              gelijk is aan de sectiekop overgeslagen (het model
 *                              herhaalt de sectietitel nogal eens als eerste regel).
 * @returns {Array<object>} blokken
 */
function ontleed(tekst, sectiekop) {
  const regels = String(tekst ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blokken = [];
  let i = 0;

  const duw = (blok) => blokken.push(blok);

  while (i < regels.length) {
    const regel = regels[i];

    if (!regel.trim()) { i++; continue; }

    // horizontale lijn
    if (/^\s*([-*_])\1{2,}\s*$/.test(regel)) {
      duw({ type: 'hr' });
      i++;
      continue;
    }

    // codeblok
    const fence = regel.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9+#._-]*)\s*$/);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const taal = (fence[2] || '').toLowerCase();
      i++;
      const inhoud = [];
      while (i < regels.length && !new RegExp(`^\\s*${marker}`).test(regels[i])) {
        inhoud.push(regels[i]);
        i++;
      }
      i++; // sluitende fence
      duw({ type: 'code', taal, tekst: inhoud.join('\n') });
      continue;
    }

    // kop
    const kop = regel.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (kop) {
      const niveau = kop[1].length;
      const tekstVanKop = kop[2].trim();
      const isHerhaling = blokken.length === 0 && sectiekop &&
        tekstVanKop.toLowerCase().replace(/^\d+[.)]\s*/, '') === String(sectiekop).toLowerCase().replace(/^\d+[.)]\s*/, '');
      if (!isHerhaling) {
        // Subkoppen komen uit de sectietekst. Ze horen visueel bij de sectie maar
        // niet in de inhoudsopgave of de kopnummering. Een losse H1 in de tekst
        // wordt ook als subkop behandeld, want de sectiekop wordt apart gezet.
        duw({ type: 'subheading', niveau: niveau <= 2 ? 2 : 3, tekst: tekstVanKop });
      }
      i++;
      continue;
    }

    // tabel
    if (regel.includes('|') && i + 1 < regels.length && isTabelScheiding(regels[i + 1])) {
      const kopRij = splitTabelrij(regel);
      i += 2;
      const rijen = [];
      while (i < regels.length && regels[i].includes('|') && regels[i].trim()) {
        rijen.push(splitTabelrij(regels[i]));
        i++;
      }
      duw({ type: 'table', kop: kopRij, rijen });
      continue;
    }

    // callout
    if (/^\s*>\s*\[!?([A-Za-z]+)\]\s*(.*)$/.test(regel) || /^\s*>\s?/.test(regel)) {
      const eerste = regel.match(/^\s*>\s*\[!?([A-Za-z]+)\]\s*(.*)$/);
      let soort = 'note';
      let titel = '';
      const body = [];
      if (eerste) {
        const sleutel = eerste[1].toLowerCase();
        soort = { note: 'note', info: 'note', tip: 'tip', important: 'important', warning: 'warning', waarschuwing: 'warning', let: 'important', attentie: 'important', definitie: 'note' }[sleutel] || 'note';
        titel = eerste[2].trim();
        i++;
      }
      while (i < regels.length && /^\s*>/.test(regels[i])) {
        body.push(regels[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      duw({ type: 'callout', soort, titel, tekst: body.join('\n').trim() });
      continue;
    }

    // lijst (met nesting)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(regel)) {
      const items = [];
      while (i < regels.length && /^\s*([-*+]|\d+[.)])\s+/.test(regels[i])) {
        const m = regels[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        const niveau = Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        items.push({ niveau, genummerd: /\d/.test(m[2]), tekst: m[3].trim() });
        i++;
      }
      duw({ type: 'list', items });
      continue;
    }

    // figuurmarker
    const figuur = leesFiguurMarker(regel, regels[i + 1]);
    if (figuur) {
      duw({ type: 'figure', ref: figuur.id, caption: figuur.caption });
      i++;
      continue;
    }

    // alinea: verzamel tot een lege regel of een nieuw blok
    const alinea = [];
    while (
      i < regels.length &&
      regels[i].trim() &&
      !/^\s*(#{1,6}\s|>|\||```|~~~|([-*+]|\d+[.)])\s)/.test(regels[i]) &&
      !leesFiguurMarker(regels[i], regels[i + 1]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(regels[i])
    ) {
      alinea.push(regels[i].trim());
      i++;
    }
    if (alinea.length) duw({ type: 'paragraph', tekst: alinea.join(' ') });
    else i++;
  }

  return blokken;
}

/** Verwijdert figuurmarkers en overgebleven placeholders uit lopende tekst. */
function schoonTekst(tekst) {
  return String(tekst ?? '')
    .replace(/<!--\s*FIGUUR\s*:[^>]*-->/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\{\{FIG[^}]*\}\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Maakt een platte-tekstversie (voor het HTML-voorbeeld en voor tellingen). */
function naarPlatteTekst(blokken) {
  const uit = [];
  for (const b of blokken) {
    if (b.type === 'heading' || b.type === 'subheading') uit.push(b.tekst);
    else if (b.type === 'paragraph') uit.push(schoonTekst(b.tekst));
    else if (b.type === 'list') for (const it of b.items) uit.push('- ' + it.tekst);
    else if (b.type === 'code') uit.push(b.tekst);
    else if (b.type === 'callout') uit.push(schoonTekst(b.tekst));
    else if (b.type === 'table') {
      uit.push(b.kop.join(' | '));
      for (const r of b.rijen) uit.push(r.join(' | '));
    } else if (b.type === 'figure') uit.push(b.caption || '');
  }
  return uit.join('\n');
}

function telWoorden(blokken) {
  const tekst = naarPlatteTekst(blokken);
  return (tekst.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).length;
}

export { ontleed, schoonTekst, naarPlatteTekst, telWoorden, splitTabelrij };
