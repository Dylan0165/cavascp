#!/usr/bin/env node
/**
 * Test het versturen zonder echt te versturen.
 *
 * Er gaat geen mail de deur uit: deze test start een nepserver op een vrije
 * poort die het SMTP-protocol nabootst, en controleert wat de client precies
 * stuurt. Dat is de enige manier om dit te testen zonder je eigen adres te
 * gebruiken — en zonder te hopen dat het goed gaat.
 *
 * Wat er getest wordt:
 *   - het hele gesprek (EHLO, inloggen, MAIL FROM, RCPT TO, DATA, QUIT)
 *   - een onderwerp met Nederlandse tekens (RFC 2047)
 *   - de body: base64, en na decoderen precies de tekst die je meegaf
 *   - een regel die met een punt begint (punt-stuffing)
 *   - een geweigerd wachtwoord: dan moet er een fout komen, geen stille "ok"
 */

import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';

// Eigen datamap: de test mag nooit de echte Gmail-koppeling tegenkomen.
process.env.CAVASCP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stagebot-smtp-'));

const { verstuurMail, codeerOnderwerp, maakMime } = await import('./lib/gmail.mjs');

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

/* ─────────────────────────── de nepserver ─────────────────────────────── */

/**
 * Start een SMTP-server die doet alsof.
 *
 * `wachtwoordGoed` op false laat hem het wachtwoord weigeren, zodat we kunnen
 * zien of de client dat als fout behandelt.
 */
function startNepServer({ wachtwoordGoed = true } = {}) {
  const ontvangen = {
    inlog: {},
    van: null,
    naar: null,
    data: '',
    volgorde: [],
  };

  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let stap = 0; // 0 = wachten op EHLO, 1 = wachten op gebruikersnaam, 2 = wachtwoord

    socket.setEncoding('utf8');
    socket.write('220 test.local ESMTP nep\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf('\r\n');
        if (index === -1) break;
        const regel = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (regel === '.') {
            inData = false;
            ontvangen.volgorde.push('DATA-EINDE');
            socket.write('250 2.0.0 OK queued\r\n');
          } else {
            ontvangen.data += `${regel}\r\n`;
          }
          continue;
        }

        const commando = regel.split(' ')[0]?.toUpperCase();
        ontvangen.volgorde.push(commando);

        if (commando === 'EHLO' || commando === 'HELO') {
          socket.write('250-test.local\r\n250-SIZE 35882577\r\n250 AUTH LOGIN\r\n');
        } else if (commando === 'AUTH') {
          stap = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (stap === 1) {
          ontvangen.inlog.gebruiker = Buffer.from(regel, 'base64').toString('utf8');
          stap = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (stap === 2) {
          ontvangen.inlog.wachtwoord = Buffer.from(regel, 'base64').toString('utf8');
          stap = 3;
          socket.write(
            wachtwoordGoed ? '235 2.7.0 Accepted\r\n' : '535 5.7.8 Username and Password not accepted\r\n',
          );
        } else if (commando === 'MAIL') {
          ontvangen.van = /<(.*)>/.exec(regel)?.[1] ?? null;
          socket.write('250 2.1.0 OK\r\n');
        } else if (commando === 'RCPT') {
          ontvangen.naar = /<(.*)>/.exec(regel)?.[1] ?? null;
          socket.write('250 2.1.5 OK\r\n');
        } else if (commando === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (commando === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('500 5.5.2 Command not recognized\r\n');
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, poort: server.address().port, ontvangen });
    });
  });
}

/* ─────────────────────────── de tests ─────────────────────────────────── */

console.log('\n1) Onderwerp coderen');

check('gewone tekst blijft zoals hij is', () => {
  assert.equal(codeerOnderwerp('Stage bij Informa'), 'Stage bij Informa');
});

check('een lange regel met accenten wordt in stukken gesplitst', () => {
  const onderwerp = 'Stage bij Daemen ICT — infrastructuur, cybersecurity en automatisering in West-Brabant';
  const gecodeerd = codeerOnderwerp(onderwerp);
  // Elk stuk moet op zijn eigen regel staan, anders is het geen geldige header.
  const stukken = gecodeerd.split('\r\n ');
  assert.ok(stukken.length > 1, 'verwacht meerdere stukken');
  const terug = stukken
    .map((s) => Buffer.from(/=\?UTF-8\?B\?(.*)\?=/.exec(s)[1], 'base64').toString('utf8'))
    .join('');
  assert.equal(terug, onderwerp);
});

check('regeleinden in een onderwerp worden vlak gemaakt', () => {
  assert.equal(codeerOnderwerp('a\r\nb'), 'a b');
});

console.log('\n2) Het bericht zelf');

check('een mail heeft de verplichte headers', () => {
  const mime = maakMime({
    van: 'test@example.com',
    vanNaam: 'Dylan Schuurman',
    aan: 'info@bedrijf.nl',
    onderwerp: 'Stage',
    tekst: 'Hallo',
  });
  assert.match(mime, /^Date: .+$/m);
  assert.match(mime, /^From: "Dylan Schuurman" <test@example\.com>$/m);
  assert.match(mime, /^To: <info@bedrijf\.nl>$/m);
  assert.match(mime, /^MIME-Version: 1\.0$/m);
  assert.match(mime, /^Content-Type: text\/plain; charset=UTF-8$/m);
  assert.match(mime, /^Content-Transfer-Encoding: base64$/m);
});

console.log('\n3) Het gesprek met de mailserver');

{
  const nep = await startNepServer();
  const uitkomst = await verstuurMail({
    van: 'test@example.com',
    vanNaam: 'Dylan Schuurman',
    aan: 'info@bedrijf.nl',
    onderwerp: 'Stage bij Daemen ICT',
    tekst: 'Beste team,\n\nEen nee is ook goed.\n\nGroet,\nDylan',
    host: '127.0.0.1',
    port: nep.poort,
    secure: false,
  });

  check('versturen meldt succes met een message-id', () => {
    assert.equal(uitkomst.ok, true);
    assert.match(uitkomst.messageId, /^<.+@example\.com>$/);
  });

  check('er is ingelogd met de gebruiker uit .env', () => {
    assert.equal(nep.ontvangen.inlog.gebruiker, 'test@example.com');
    assert.equal(nep.ontvangen.inlog.wachtwoord, 'abcdefghijklmnop');
  });

  check('de afzender en ontvanger staan in het gesprek', () => {
    assert.equal(nep.ontvangen.van, 'test@example.com');
    assert.equal(nep.ontvangen.naar, 'info@bedrijf.nl');
  });

  check('de inhoud komt aan, base64 en al', () => {
    const body = nep.ontvangen.data.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const gedecodeerd = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(gedecodeerd, /Beste team,/);
    assert.match(gedecodeerd, /Een nee is ook goed\./);
  });

  check('het gesprek eindigt met QUIT', () => {
    assert.equal(nep.ontvangen.volgorde.at(-1), 'QUIT');
  });

  nep.server.close();
}

console.log('\n4) Een regel die met een punt begint');

{
  const nep = await startNepServer();
  await verstuurMail({
    van: 'test@example.com',
    aan: 'info@bedrijf.nl',
    onderwerp: 'Punt-test',
    tekst: 'Regel een.\n.regel twee begint met een punt.\nRegel drie.',
    host: '127.0.0.1',
    port: nep.poort,
    secure: false,
  });

  /*
   * De body gaat base64 de deur uit, en in base64 komt geen punt voor. De
   * punt-stuffing in de client is dus een vangnet voor het geval de codering
   * ooit verandert — wat we hier controleren is dat de regel met de punt
   * ongeschonden aankomt.
   */
  check('na decoderen staat er weer één punt', () => {
    const body = nep.ontvangen.data.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const gedecodeerd = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(gedecodeerd, /^\.regel twee/m);
  });

  nep.server.close();
}

console.log('\n5) Een geweigerd wachtwoord');

{
  const nep = await startNepServer({ wachtwoordGoed: false });
  let fout = null;
  try {
    await verstuurMail({
      van: 'test@example.com',
      aan: 'info@bedrijf.nl',
      onderwerp: 'Test',
      tekst: 'Hallo',
      host: '127.0.0.1',
      port: nep.poort,
      secure: false,
    });
  } catch (e) {
    fout = e;
  }

  check('een 535 geeft een echte fout, geen stille ok', () => {
    assert.ok(fout, 'verwacht een fout');
    assert.match(fout.message, /535/);
  });

  nep.server.close();
}

console.log(
  `\n${fouten.length === 0 ? 'ALLES OK' : `${fouten.length} CHECK(S) MISLUKT`}  (${gelukt} geslaagd)\n`,
);
process.exit(fouten.length === 0 ? 0 : 1);
