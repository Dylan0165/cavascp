#!/usr/bin/env node
/**
 * Test het inloggen.
 *
 * Start zijn eigen server met een eigen wachtwoordbestand, zodat er niets aan
 * je echte configuratie verandert. Wat hier getest wordt is precies het stuk
 * dat je niet met het oog controleert: dat je er zonder wachtwoord niet in
 * komt, dat een verkeerd wachtwoord geen sessie oplevert, en dat uitloggen de
 * oude cookie waardeloos maakt.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8798;
const BASIS = `http://127.0.0.1:${PORT}`;

const authBestand = path.join(mkdtempSync(path.join(tmpdir(), 'cavascp-auth-')), 'auth.json');

const kind = spawn(process.execPath, ['server.mjs', '--port', String(PORT)], {
  cwd: HIER,
  stdio: 'ignore',
  env: {
    ...process.env,
    CAVASCP_AUTH_FILE: authBestand,
    CAVASCP_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'cavascp-data-')),
    // Geen echte Canvas-calls doen in een test.
    CANVAS_TOKEN: 'test-token',
  },
});

process.on('exit', () => kind.kill());

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

async function wachtTotOnline() {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      await fetch(BASIS + '/login', { redirect: 'manual' });
      return true;
    } catch {
      /* nog niet */
    }
  }
  return false;
}

const post = (pad, body, headers = {}) =>
  fetch(BASIS + pad, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASIS, ...headers },
    body: JSON.stringify(body ?? {}),
  });

const cookieVan = (respons) => (respons.headers.getSetCookie?.()[0] ?? '').split(';')[0];

if (!(await wachtTotOnline())) {
  console.log('kon de testserver niet starten');
  process.exit(1);
}

console.log('\n1) Zonder wachtwoord');

{
  const status = await (await fetch(BASIS + '/api/auth/status')).json();
  check('de server meldt dat er nog geen wachtwoord is', () => {
    assert.equal(status.heeftWachtwoord, false);
  });

  const stage = await fetch(BASIS + '/stage', { redirect: 'manual' });
  check('de stagepagina stuurt door naar het inlogscherm', () => {
    assert.equal(stage.status, 302);
    assert.equal(stage.headers.get('location'), '/login');
  });

  const api = await fetch(BASIS + '/api/stage', { headers: { Origin: BASIS } });
  check('de API weigert zonder sessie', () => assert.equal(api.status, 401));
}

console.log('\n2) Wachtwoord instellen');

{
  const kort = await post('/api/auth/setup', { wachtwoord: 'kort' });
  check('een te kort wachtwoord wordt geweigerd', () => assert.equal(kort.status, 400));

  const cijfers = await post('/api/auth/setup', { wachtwoord: 'alleenmaarletters' });
  check('een wachtwoord zonder cijfers of leestekens wordt geweigerd', () =>
    assert.equal(cijfers.status, 400),
  );

  const goed = await post('/api/auth/setup', { wachtwoord: 'Koffie-met-7-suikerklontjes' });
  check('een goed wachtwoord wordt geaccepteerd', () => assert.equal(goed.status, 201));

  const cookie = cookieVan(goed);
  check('je bent meteen ingelogd na het instellen', () => assert.ok(cookie.startsWith('cavascp_session=')));

  const bestand = JSON.parse(readFileSync(authBestand, 'utf8'));
  check('het wachtwoord staat niet in het bestand, alleen een hash', () => {
    assert.equal(bestand.hash !== undefined, true);
    assert.equal(JSON.stringify(bestand).includes('Koffie'), false);
  });

  const tweede = await post('/api/auth/setup', { wachtwoord: 'Nog-een-8-wachtwoord' });
  check('een tweede keer instellen kan niet meer', () => assert.equal(tweede.status, 409));
}

console.log('\n3) Inloggen');

{
  const fout = await post('/api/auth/login', { wachtwoord: 'verkeerd-wachtwoord-9' });
  check('een verkeerd wachtwoord geeft 401', () => assert.equal(fout.status, 401));

  const goed = await post('/api/auth/login', { wachtwoord: 'Koffie-met-7-suikerklontjes' });
  check('het juiste wachtwoord geeft een sessie', () => {
    assert.equal(goed.status, 200);
    assert.ok(cookieVan(goed).startsWith('cavascp_session='));
  });

  const cookie = cookieVan(goed);
  const dashboard = await fetch(BASIS + '/dashboard', { headers: { Cookie: cookie }, redirect: 'manual' });
  check('met de sessie kom je op het dashboard', () => assert.equal(dashboard.status, 200));

  const stage = await fetch(BASIS + '/stage', { headers: { Cookie: cookie }, redirect: 'manual' });
  check('met de sessie kom je op de stagepagina', () => assert.equal(stage.status, 200));
}

console.log('\n4) Uitloggen maakt de oude cookie waardeloos');

{
  const login = await post('/api/auth/login', { wachtwoord: 'Koffie-met-7-suikerklontjes' });
  const cookie = cookieVan(login);

  await post('/api/auth/logout', {}, { Cookie: cookie });

  const na = await fetch(BASIS + '/stage', { headers: { Cookie: cookie }, redirect: 'manual' });
  check('de oude cookie werkt niet meer', () => {
    assert.equal(na.status, 302);
    assert.equal(na.headers.get('location'), '/login');
  });
}

console.log('\n5) Wachtwoord wijzigen');

{
  const login = await post('/api/auth/login', { wachtwoord: 'Koffie-met-7-suikerklontjes' });
  const cookie = cookieVan(login);

  const zonderOud = await post('/api/auth/wachtwoord', { nieuw: 'Thee-met-2-klontjes' }, { Cookie: cookie });
  check('zonder het oude wachtwoord kun je niet wijzigen', () => assert.equal(zonderOud.status, 400));

  const metOud = await post(
    '/api/auth/wachtwoord',
    { oud: 'Koffie-met-7-suikerklontjes', nieuw: 'Thee-met-2-klontjes' },
    { Cookie: cookie },
  );
  check('met het oude wachtwoord kan het wel', () => assert.equal(metOud.status, 200));

  const oud = await post('/api/auth/login', { wachtwoord: 'Koffie-met-7-suikerklontjes' });
  check('het oude wachtwoord werkt niet meer', () => assert.equal(oud.status, 401));

  const nieuw = await post('/api/auth/login', { wachtwoord: 'Thee-met-2-klontjes' });
  check('het nieuwe wachtwoord werkt', () => assert.equal(nieuw.status, 200));
}

console.log('\n6) De rem op raden');

{
  let laatste = 0;
  for (let i = 0; i < 12; i += 1) {
    const poging = await post('/api/auth/login', { wachtwoord: `fout-${i}-wachtwoord` });
    laatste = poging.status;
  }
  check('na tien pogingen word je tegengehouden', () => assert.equal(laatste, 429));
}

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);

kind.kill();
process.exit(fouten.length === 0 ? 0 : 1);
