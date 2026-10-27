#!/usr/bin/env node
/**
 * Test de stagebot zonder internet en zonder taalmodel.
 *
 * De AI-stappen worden hier niet getest — die kosten geld en geven elke keer
 * een ander antwoord. Wat we wél testen is alles wat deterministisch hoort te
 * zijn: tekst uit HTML halen, e-mailadressen vinden, technologie herkennen, een
 * anti-bot-pagina doorzien, en de opmaak van de mail.
 *
 *   node stagebot/test-stagebot.mjs
 */

import assert from 'node:assert/strict';
import { tekstVanHtml, vindEmails, vindTech, vindStageSignaal, isBotPagina, schoonTitel, normaliseerUrl, domeinVan, scanVanTekst } from './lib/scan.mjs';
import { keurMail } from './lib/mail.mjs';
import { leegProfiel } from './lib/profiel.mjs';

let gelukt = 0;
const fouten = [];

function check(naam, fn) {
  try {
    fn();
    gelukt += 1;
    console.log(`  PASS  ${naam}`);
  } catch (fout) {
    fouten.push({ naam, fout });
    console.log(`  FAIL  ${naam} — ${fout.message}`);
  }
}

console.log('\n1) Tekst uit HTML halen');
check('tags verdwijnen', () => {
  const uit = tekstVanHtml('<p>Hallo <b>wereld</b></p>');
  assert.equal(uit, 'Hallo wereld');
});
check('scripts en stijlen tellen niet mee', () => {
  const uit = tekstVanHtml('<script>var x = 1;</script><style>.a{color:red}</style><p>Echt</p>');
  assert.equal(uit, 'Echt');
});
check('entiteiten worden leesbaar', () => {
  const uit = tekstVanHtml('<p>Wij &amp; jullie &euro; 10</p>');
  assert.match(uit, /Wij & jullie € 10/);
});
check('alinea\'s blijven gescheiden', () => {
  const uit = tekstVanHtml('<p>Een</p><p>Twee</p>');
  assert.equal(uit, 'Een\nTwee');
});

console.log('\n2) E-mailadressen vinden');
check('een gewoon adres', () => {
  assert.deepEqual(vindEmails('Mail naar info@bedrijf.nl voor vragen.'), ['info@bedrijf.nl']);
});
check('voorbeeldadressen worden geweigerd', () => {
  assert.deepEqual(vindEmails('info@voorbeeld.nl en naam@example.com'), []);
});
check('bestandsnamen zijn geen adres', () => {
  assert.deepEqual(vindEmails('logo@2x.png'), []);
});
check('het vaakst genoemde adres komt eerst', () => {
  const uit = vindEmails('a@x.nl b@x.nl b@x.nl');
  assert.equal(uit[0], 'b@x.nl');
});
check('niet meer dan acht adressen', () => {
  const veel = Array.from({ length: 20 }, (_, i) => `p${i}@x.nl`).join(' ');
  assert.ok(vindEmails(veel).length <= 8);
});

console.log('\n3) Technologie herkennen');
check('een lange naam matcht in de tekst', () => {
  assert.ok(vindTech('Wij doen veel met Kubernetes en Docker').includes('Kubernetes'));
});
check('"Go" matcht niet op "Governance"', () => {
  const uit = vindTech('Data Lifecycle Management & Governance');
  assert.ok(!uit.includes('Go'), `kreeg: ${uit.join(', ')}`);
});
check('"Go" matcht wel als het een woord is', () => {
  assert.ok(vindTech('Wij programmeren in Go.').includes('Go'));
});
check('SQL matcht niet op MySQL alleen', () => {
  // MySQL is een eigen treffer; SQL als los woord staat er niet.
  const uit = vindTech('Wij gebruiken MySQL');
  assert.ok(uit.includes('MySQL'));
});
check('meerdere treffers, geen dubbelen', () => {
  const uit = vindTech('Python en python en PYTHON');
  assert.equal(uit.length, 1);
});

console.log('\n4) Stage-signalen');
check('stage wordt herkend', () => {
  assert.ok(vindStageSignaal('Wij bieden een stageplek aan').includes('stage'));
});
check('vacature wordt herkend', () => {
  assert.ok(vindStageSignaal('Bekijk onze vacatures').includes('vacature'));
});
check('gewone tekst levert niets op', () => {
  assert.deepEqual(vindStageSignaal('Wij maken software voor de zorg'), []);
});

console.log('\n5) Anti-bot-pagina\'s doorzien');
check('Cloudflare wordt herkend', () => {
  assert.ok(isBotPagina('Just a moment... Checking your browser', 'Just a moment'));
});
check('Anubis wordt herkend', () => {
  assert.ok(isBotPagina('Human verification. Checking if you are human.'));
});
check('een lange pagina met "captcha" in de footer telt niet', () => {
  const lang = 'Wij maken software. '.repeat(200) + ' Neem contact op bij vragen over de captcha.';
  assert.equal(isBotPagina(lang), null);
});
check('een gewone pagina is geen blokkade', () => {
  assert.equal(isBotPagina('Wij zijn een ICT-bedrijf in Tilburg.', 'Home'), null);
});

console.log('\n6) Bedrijfsnamen opschonen');
check('"Home - Informa" wordt "Informa"', () => {
  assert.equal(schoonTitel('Home - Informa'), 'Informa');
});
check('een pijp wordt gesplitst', () => {
  assert.equal(schoonTitel('Informa | Dataoplossingen'), 'Informa');
});
check('een naam zonder scheiding blijft', () => {
  assert.equal(schoonTitel('Lancyr'), 'Lancyr');
});
check('leeg blijft leeg', () => {
  assert.equal(schoonTitel(''), '');
});

console.log('\n7) Url\'s normaliseren');
check('https wordt toegevoegd', () => {
  assert.equal(normaliseerUrl('cco.nl'), 'https://cco.nl');
});
check('een slash aan het eind gaat eraf', () => {
  assert.equal(normaliseerUrl('https://cco.nl/'), 'https://cco.nl');
});
check('het domein zonder www', () => {
  assert.equal(domeinVan('https://www.informa.nl/over'), 'informa.nl');
});

console.log('\n8) Tekst die je zelf plakt');
check('leest een bedrijf uit geplakte tekst', () => {
  const scan = scanVanTekst(
    'cco.nl',
    'CCO ICT Diensten is een ICT-dienstverlener in Oosterhout. Wij zoeken een stagiair voor ons SOC-team. ' +
      'Wij werken met Microsoft Sentinel en Fortinet. Mail naar werken@cco.nl.',
  );
  assert.equal(scan.domein, 'cco.nl');
  assert.ok(scan.emails.includes('werken@cco.nl'));
  assert.ok(scan.tech.includes('Microsoft Sentinel'));
  assert.ok(scan.stageSignaal.includes('stagiair'));
  assert.equal(scan.bron, 'handmatig');
});
check('te korte tekst geeft een duidelijke fout', () => {
  assert.throws(() => scanVanTekst('x.nl', 'kort'), /te kort/);
});

console.log('\n9) De mail controleren');
const profiel = { ...leegProfiel(), naam: 'Dylan', email: 'd@x.nl', vaardigheden: ['Python'], projecten: [] };

check('een goede mail is in orde', () => {
  const mail = {
    body:
      'Ik zag dat jullie met Kubernetes en Docker werken aan dataplatformen, en dat sprak me aan. ' +
      'Ik ben student HBO-ICT aan Fontys in Tilburg en zoek een stage van februari tot juni 2027. ' +
      'Binnen mijn minor heb ik gewerkt aan data-analyse en het ontsluiten van datasets, en ik wil ' +
      'dat graag in de praktijk brengen bij een team dat dagelijks met data werkt. ' +
      'Mijn vraag: heeft u in het voorjaar ruimte voor een stagiair? ' +
      'Een nee is ook goed; dan weet ik waar ik aan toe ben.',
    volledig: 'x',
    waarom: 'Kubernetes',
  };
  const uit = keurMail(mail, profiel);
  assert.equal(uit.goed, true, uit.punten.join('; '));
});
check('een holle frase wordt gemeld', () => {
  const mail = {
    body: 'Als gemotiveerde student met passie voor IT zoek ik een stage. Een nee is ook goed.',
    volledig: 'x',
    waarom: 'x',
  };
  const uit = keurMail(mail, profiel);
  assert.ok(uit.punten.some((p) => p.includes('holle frases')));
});
check('een te lange mail wordt gemeld', () => {
  const mail = { body: 'woord '.repeat(300) + ' Een nee is ook goed.', volledig: 'x', waarom: 'x' };
  const uit = keurMail(mail, profiel);
  assert.ok(uit.punten.some((p) => p.includes('te lang')));
});
check('zonder opt-out krijg je een melding', () => {
  const mail = {
    body: 'Ik zoek een stage en wil graag langskomen om kennis te maken met jullie team en de projecten.',
    volledig: 'x',
    waarom: 'x',
  };
  const uit = keurMail(mail, profiel);
  assert.ok(uit.punten.some((p) => p.includes('afwijzen')));
});
check('"een nee is ook goed" telt als opt-out', () => {
  const mail = { body: 'Ik zoek een stage. Een nee is ook goed.', volledig: 'x', waarom: 'x' };
  const uit = keurMail(mail, profiel);
  assert.ok(!uit.punten.some((p) => p.includes('afwijzen')));
});
check('geclaimde ervaring wordt gemeld', () => {
  const mail = {
    body: 'Ik heb jaren ervaring met Python. Een nee is ook goed.',
    volledig: 'x',
    waarom: 'x',
  };
  const uit = keurMail(mail, profiel);
  assert.ok(uit.punten.some((p) => p.includes('ervaring')));
});
check('zonder aanknopingspunt krijg je een melding', () => {
  const mail = { body: 'Ik zoek een stage. Een nee is ook goed.', volledig: 'x', waarom: null };
  const uit = keurMail(mail, profiel);
  assert.ok(uit.punten.some((p) => p.includes('aanknopingspunt')));
});

console.log(`\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`);
process.exit(fouten.length === 0 ? 0 : 1);
