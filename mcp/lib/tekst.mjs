/**
 * Tekst uit een document halen.
 *
 * De document-inbox bewaart bestanden; de indeler heeft tekst nodig. Dit haalt
 * de tekst eruit zonder afhankelijkheden.
 *
 * Wat wel kan: .docx (het is een ZIP met XML), .pptx (idem), en platte tekst.
 * Wat niet kan: PDF. Daar is een echte parser voor nodig en die hebben we niet.
 * Dat zeggen we dan ook, in plaats van een lege tekst terug te geven waar de
 * indeler niets mee kan.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { leesZip } from './zip.mjs';

/** XML naar platte tekst, met alinea's op eigen regels. */
function xmlNaarTekst(xml) {
  return String(xml)
    // Alinea's en regeleindes worden nieuwe regels.
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    // Alles tussen haakjes weg, dan blijven de tekstdelen over.
    .replace(/<[^>]+>/g, '')
    // De vijf XML-entiteiten die in Word voorkomen.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    // Witruimte opruimen maar regeleindes houden.
    .split('\n')
    .map((r) => r.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Haalt de tekst uit een bestand.
 *
 * @param {string} pad
 * @returns {{tekst: string, soort: string, tekens: number, gelukt: boolean, reden?: string}}
 */
export function tekstUitBestand(pad) {
  if (!existsSync(pad)) {
    return { tekst: '', soort: 'onbekend', tekens: 0, gelukt: false, reden: 'bestand niet gevonden' };
  }

  const ext = path.extname(pad).toLowerCase();

  try {
    /* Platte tekst. */
    if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
      const tekst = readFileSync(pad, 'utf8');
      return { tekst, soort: ext.slice(1), tekens: tekst.length, gelukt: true };
    }

    /* Word en PowerPoint zijn ZIP-bestanden met XML erin. */
    if (ext === '.docx' || ext === '.pptx') {
      const onderdelen = leesZip(readFileSync(pad));
      const sleutels =
        ext === '.docx'
          ? ['word/document.xml']
          : [...onderdelen.keys()].filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));

      if (!sleutels.length) {
        return { tekst: '', soort: ext.slice(1), tekens: 0, gelukt: false, reden: 'geen tekstonderdeel in het bestand' };
      }

      const delen = sleutels
        .map((k) => xmlNaarTekst(onderdelen.get(k)?.toString('utf8') ?? ''))
        .filter(Boolean);

      const tekst = delen.join('\n\n');
      return {
        tekst,
        soort: ext.slice(1),
        tekens: tekst.length,
        gelukt: tekst.length > 0,
        reden: tekst.length ? undefined : 'het bestand bevat geen leesbare tekst',
      };
    }

    if (ext === '.pdf') {
      /*
       * PDF kan niet zonder parser. We melden het eerlijk: de indeler heeft dan
       * geen tekst, en de gebruiker moet zelf kiezen of een beschrijving typen.
       */
      return {
        tekst: '',
        soort: 'pdf',
        tekens: 0,
        gelukt: false,
        reden: 'PDF kan niet gelezen worden zonder extra gereedschap; kies zelf een map of typ een toelichting',
      };
    }

    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.mp4', '.mov'].includes(ext)) {
      return {
        tekst: '',
        soort: ext.slice(1),
        tekens: 0,
        gelukt: false,
        reden: `${ext.slice(1)} bevat geen tekst; gebruik Krava om er tekst van te maken`,
      };
    }

    return { tekst: '', soort: ext.slice(1) || 'onbekend', tekens: 0, gelukt: false, reden: `type ${ext} wordt niet gelezen` };
  } catch (error) {
    return { tekst: '', soort: ext.slice(1), tekens: 0, gelukt: false, reden: `lezen mislukt: ${error.message}` };
  }
}
