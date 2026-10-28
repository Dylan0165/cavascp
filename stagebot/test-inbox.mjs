#!/usr/bin/env node
/**
 * Test het lezen van antwoorden — zonder in te loggen bij Gmail.
 *
 * De IMAP-client zelf is lastig te testen zonder echte server; wat hier wél
 * getest wordt is het deel dat de fouten maakt: berichten herkennen, koppelen
 * aan het juiste bedrijf, en een afwijzing onderscheiden van een automatisch
 * antwoord. Plus de twee stukjes die altijd misgaan bij mail: gecodeerde
 * headers en HTML-bodies.
 *
 *   node stagebot/test-inbox.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.CAVASCP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stagebot-inbox-'));

const { soortVanBericht, samenvattingVan, koppelBedrijf } = await import('./lib/inbox.mjs');
const { decodeerHeader, htmlNaarTekst, parseBericht, adresVan } = await import('./lib/imap.mjs');

let gelukt = 0;
const fouten = [];

function check(naam, fn) {
  try {
    fn();
    gelukt += 1;
    console.log(`  PASS  ${naam}`);
  } catch (fout) {
    fouten.push({ naam, fout });
    console.log(`  FAIL  ${naam}`);
    console.log(`        ${fout.message}`);
  }
}

/* ─────────────────────────────── bedrijven ────────────────────────────── */

const bedrijven = [
  { id: 'daemen-ict', titel: 'Daemen ICT', domein: 'daemen-ict.nl', emails: ['info@daemen-ict.nl'] },
  { id: 'nextriq', titel: 'NEXTRIQ', domein: 'nextriq.nl', emails: [] },
  { id: 'informa', titel: 'Informa', domein: 'informa.nl', emails: ['info@informa.nl'] },
];

console.log('\n1) Een bericht aan een bedrijf koppelen');

check('op het e-mailadres', () => {
  const bedrijf = koppelBedrijf({ van: 'info@daemen-ict.nl' }, bedrijven);
  assert.equal(bedrijf?.id, 'daemen-ict');
});

check('op het domein, ook met een subdomein', () => {
  const bedrijf = koppelBedrijf({ van: 'planning@mail.nextriq.nl' }, bedrijven);
  assert.equal(bedrijf?.id, 'nextriq');
});

check('een onbekende afzender hoort bij niemand', () => {
  assert.equal(koppelBedrijf({ van: 'iemand@linkedin.com' }, bedrijven), null);
});

check('zonder afzender geen match', () => {
  assert.equal(koppelBedrijf({ van: null }, bedrijven), null);
});

console.log('\n2) Wat voor bericht is het?');

check('een afwijzing wordt herkend', () => {
  const soort = soortVanBericht({
    van: 'info@daemen-ict.nl',
    onderwerp: 'Re: stage',
    tekst: 'Helaas hebben wij op dit moment geen ruimte voor een stagiair.',
  });
  assert.equal(soort, 'afwijzing');
});

check('een automatisch antwoord gaat voor een afwijzing', () => {
  const soort = soortVanBericht({
    van: 'noreply@daemen-ict.nl',
    onderwerp: 'Automatisch antwoord: afwezig',
    tekst: 'Ik ben afwezig en lees uw mail later. Geen ruimte voor vragen.',
  });
  assert.equal(soort, 'automatisch');
});

check('een uitnodiging is een gewoon antwoord', () => {
  const soort = soortVanBericht({
    van: 'planning@nextriq.nl',
    onderwerp: 'Kennismaken',
    tekst: 'We nodigen je graag uit voor een gesprek over een stageplek.',
  });
  assert.equal(soort, 'stage');
});

check('kort antwoord zonder stagewoord is "antwoord"', () => {
  const soort = soortVanBericht({
    van: 'info@informa.nl',
    onderwerp: 'Re: vraag',
    tekst: 'Bedankt voor je bericht, we nemen contact op.',
  });
  assert.equal(soort, 'antwoord');
});

console.log('\n3) Een samenvatting maken');

check('aangehaalde tekst wordt overgeslagen', () => {
  const tekst = 'Bedankt voor je mail.\n\n> Op 27 okt schreef Dylan:\n> Ik zoek een stage.';
  const samenvatting = samenvattingVan(tekst);
  assert.match(samenvatting, /Bedankt voor je mail/);
  assert.equal(/zoekt een stage/.test(samenvatting), false);
});

check('een lange tekst wordt afgekapt', () => {
  const samenvatting = samenvattingVan('a'.repeat(500));
  assert.ok(samenvatting.length <= 220);
  assert.ok(samenvatting.endsWith('…'));
});

console.log('\n4) Gecodeerde headers');

check('een utf-8 Q-header wordt leesbaar', () => {
  assert.equal(decodeerHeader('=?utf-8?Q?Stage_bij_Breda?='), 'Stage bij Breda');
});

check('een utf-8 B-header met accenten wordt leesbaar', () => {
  const gecodeerd = `=?utf-8?B?${Buffer.from('Stagé bij Breda', 'utf8').toString('base64')}?=`;
  assert.equal(decodeerHeader(gecodeerd), 'Stagé bij Breda');
});

check('een gewone header blijft staan', () => {
  assert.equal(decodeerHeader('Re: stage'), 'Re: stage');
});

console.log('\n5) HTML naar tekst');

check('tags verdwijnen, regeleindes blijven', () => {
  const tekst = htmlNaarTekst('<div>Hallo</div><div>We hebben <b>geen</b> ruimte.</div>');
  assert.match(tekst, /Hallo/);
  assert.match(tekst, /geen ruimte/);
  assert.equal(/<div>/.test(tekst), false);
});

check('entiteiten worden omgezet', () => {
  assert.equal(htmlNaarTekst('<p>a &amp; b</p>'), 'a & b');
});

console.log('\n6) Een heel bericht ontleden');

const ruw = [
  'From: "Daemen ICT" <info@daemen-ict.nl>',
  'Subject: =?utf-8?Q?Re:_stage?=',
  'Date: Tue, 27 Oct 2026 10:00:00 +0100',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Helaas, wij hebben geen ruimte voor een stagiair.',
].join('\r\n');

check('afzender, onderwerp en tekst komen er goed uit', () => {
  const bericht = parseBericht(ruw);
  assert.equal(bericht.van, 'info@daemen-ict.nl');
  assert.match(bericht.vanNaam, /Daemen ICT/);
  assert.equal(bericht.onderwerp, 'Re: stage');
  assert.match(bericht.tekst, /geen ruimte/);
});

check('adresVan pakt het adres tussen haakjes', () => {
  assert.equal(adresVan('"Iemand" <Iemand@Bedrijf.nl>'), 'iemand@bedrijf.nl');
});

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);
process.exit(fouten.length === 0 ? 0 : 1);
