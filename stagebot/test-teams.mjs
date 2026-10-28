#!/usr/bin/env node
/**
 * Test de Teams-koppeling zonder Teams.
 *
 * Er gaat geen bericht naar Microsoft: deze test start een nepserver die doet
 * alsof hij een webhook is, en controleert wat er precies gepost wordt. Ook de
 * veiligheidskant zit erin — een URL die niet van Microsoft is moet geweigerd
 * worden, want de server post naar wat het formulier aanlevert.
 *
 *   node stagebot/test-teams.mjs
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.CAVASCP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stagebot-teams-'));
process.env.TEAMS_EXTRA_HOSTS = '127.0.0.1';

const { isTeamsUrl, maakTeamsBericht, verstuurTeams, bewaarTeamsWebhook, verwijderTeamsWebhook, vindTeamsWebhook } =
  await import('./lib/teams.mjs');

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

/* ─────────────────────────── de nep-webhook ───────────────────────────── */

const ontvangen = [];
let antwoordCode = 202;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (brok) => (body += brok));
  req.on('end', () => {
    ontvangen.push({ headers: req.headers, body });
    res.writeHead(antwoordCode, { 'Content-Type': 'text/plain' });
    res.end(antwoordCode === 202 ? '' : 'nope');
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const poort = server.address().port;
const nepUrl = `http://127.0.0.1:${poort}/webhook`;

/* ─────────────────────────────── tests ────────────────────────────────── */

console.log("\n1) Welke URL's accepteren we?");

check('een Power Automate-URL is goed', () => {
  assert.equal(isTeamsUrl('https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?x=1'), true);
});

check('een powerplatform-URL is goed', () => {
  assert.equal(isTeamsUrl('https://default123.environment.api.powerplatform.com/flow'), true);
});

check('een willekeurige site wordt geweigerd', () => {
  assert.equal(isTeamsUrl('https://kwaadaardig.example/webhook'), false);
});

check('http in plaats van https wordt geweigerd', () => {
  assert.equal(isTeamsUrl('http://prod-12.westeurope.logic.azure.com/workflows/x'), false);
});

check('iets dat geen URL is wordt geweigerd', () => {
  assert.equal(isTeamsUrl('javascript:alert(1)'), false);
});

check('een subdomein van een Microsoft-host mag', () => {
  assert.equal(isTeamsUrl('https://iets.logic.azure.com/x'), true);
});

check('een host die erop lijkt maar het niet is, mag niet', () => {
  assert.equal(isTeamsUrl('https://logic.azure.com.kwaad.example/x'), false);
});

console.log('\n2) De kaart');

const kaart = maakTeamsBericht({
  titel: 'Mail verstuurd: Daemen ICT',
  tekst: 'Stage infrastructuur en security',
  feiten: [['Naar', 'info@daemen.nl']],
});

check('de titel staat erin', () => assert.equal(kaart.Title, 'Mail verstuurd: Daemen ICT'));

check('het is een Adaptive Card-bericht', () => {
  assert.equal(kaart.type, 'message');
  assert.equal(kaart.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(kaart.attachments[0].content.type, 'AdaptiveCard');
});

check('de feiten staan als FactSet in de kaart', () => {
  const feiten = kaart.attachments[0].content.body.find((blok) => blok.type === 'FactSet');
  assert.deepEqual(feiten.facts[0], { title: 'Naar', value: 'info@daemen.nl' });
});

console.log('\n3) Versturen');

ontvangen.length = 0;
const uitkomst = await verstuurTeams(kaart, { url: nepUrl });

check('het versturen lukt', () => assert.equal(uitkomst.ok, true));

check('er is één verzoek aangekomen', () => assert.equal(ontvangen.length, 1));

check('het content-type is JSON', () => {
  assert.match(ontvangen[0].headers['content-type'], /application\/json/);
});

check('het lichaam is de kaart', () => {
  const lichaam = JSON.parse(ontvangen[0].body);
  assert.equal(lichaam.Title, 'Mail verstuurd: Daemen ICT');
  assert.equal(lichaam.attachments[0].content.type, 'AdaptiveCard');
});

console.log('\n4) Als Teams iets anders antwoordt');

antwoordCode = 500;
let fout = null;
try {
  await verstuurTeams(kaart, { url: nepUrl });
} catch (e) {
  fout = e;
}

check('een 500 geeft een echte fout', () => {
  assert.ok(fout, 'verwacht een fout');
  assert.match(fout.message, /HTTP 500/);
});

antwoordCode = 202;

console.log('\n5) De koppeling bewaren');

check('een verkeerde URL wordt geweigerd', () => {
  assert.throws(() => bewaarTeamsWebhook('https://example.com/x'), /geen Teams-webhook-URL/i);
});

check('een goede URL wordt bewaard', () => {
  bewaarTeamsWebhook('https://prod-1.westeurope.logic.azure.com/workflows/abc');
  const webhook = vindTeamsWebhook();
  assert.equal(webhook.url, 'https://prod-1.westeurope.logic.azure.com/workflows/abc');
  assert.equal(webhook.meldingen, true);
});

check('ontkoppelen haalt hem weg', () => {
  verwijderTeamsWebhook();
  assert.equal(vindTeamsWebhook(), null);
});

server.close();

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);
process.exit(fouten.length === 0 ? 0 : 1);
