/**
 * Mail versturen via Gmail.
 *
 * WAAROM SMTP EN GEEN OAUTH
 *
 * De Gmail-API is netter op papier, maar vraagt een Google Cloud-project, een
 * OAuth-client, een consent-scherm en een refresh-token. Voor één gebruiker die
 * vanaf zijn eigen adres mailt is dat een hoop configuratie die stuk kan.
 *
 * Een app-wachtwoord is één string van zestien tekens die je in je Google-
 * account aanmaakt, en die je hier in .env zet. Geen browser, geen token dat
 * verloopt, geen cloudproject. Het werkt met dezelfde SMTP-server die Gmail
 * zelf gebruikt.
 *
 * WAT JE NODIG HEBT
 *
 *   1. tweestapsverificatie aan op je Google-account (verplicht voor
 *      app-wachtwoorden)
 *   2. https://myaccount.google.com/apppasswords → nieuw wachtwoord
 *   3. dat wachtwoord in .env:
 *
 *        GMAIL_USER=dylanschuurman04@gmail.com
 *        GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
 *
 * Het wachtwoord is je wachtwoord niet: het werkt alleen voor mail en je kunt
 * het met één klik intrekken.
 *
 * WAAROM ZELF SMTP EN GEEN PAKKET
 *
 * Het project heeft geen npm-afhankelijkheden, en dat wil ik zo houden: dit is
 * een klein protocol (groeten, inloggen, MAIL FROM, RCPT TO, DATA) dat je in
 * honderd regels kunt schrijven. Een pakket zou hier meer onderhoud toevoegen
 * dan het wegneemt.
 */

import tls from 'node:tls';
import net from 'node:net';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync, statSync } from 'node:fs';
import { inData, inProject, vindEnv } from '../../mcp/lib/paden.mjs';
import path from 'node:path';

const SMTP_HOST = process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com';
const SMTP_POORT = Number(process.env.GMAIL_SMTP_PORT || 465);
const TIMEOUT_MS = 45_000;

/**
 * Waar staan de inloggegevens?
 *
 * Eerst de omgeving, dan de koppeling uit het scherm, dan een .env-bestand.
 * Zie de uitleg in de functie zelf.
 */
export function vindGmailSleutels() {
  /*
   * Drie bronnen, in deze volgorde:
   *   1. de omgeving — expliciet meegegeven wint altijd (tests, systemd)
   *   2. de koppeling uit het scherm (data/stagebot/gmail.json)
   *   3. een .env-bestand, voor als je het met de hand hebt ingesteld
   */
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return {
      gebruiker: process.env.GMAIL_USER,
      wachtwoord: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
      bron: 'omgeving',
      alleenLeesbaarVoorJou: true,
    };
  }

  if (existsSync(KOPPEL_PAD)) {
    try {
      const data = JSON.parse(readFileSync(KOPPEL_PAD, 'utf8'));
      if (data.gebruiker && data.wachtwoord) {
        return {
          gebruiker: data.gebruiker,
          wachtwoord: data.wachtwoord,
          bron: 'het scherm',
          alleenLeesbaarVoorJou: (statSync(KOPPEL_PAD).mode & 0o077) === 0,
        };
      }
    } catch {
      /* stuk bestand: val terug op .env */
    }
  }

  const kandidaten = [vindEnv(), inProject('.env'), path.join(process.env.HOME ?? '', '.dsh', '.env')].filter(
    Boolean,
  );

  for (const pad of kandidaten) {
    if (!existsSync(pad)) continue;
    let tekst;
    try {
      tekst = readFileSync(pad, 'utf8');
    } catch {
      continue;
    }
    const velden = {};
    for (const regel of tekst.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(regel);
      if (!match) continue;
      velden[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
    }
    if (velden.GMAIL_USER && velden.GMAIL_APP_PASSWORD) {
      return {
        gebruiker: velden.GMAIL_USER,
        wachtwoord: velden.GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
        bron: pad,
        alleenLeesbaarVoorJou: (statSync(pad).mode & 0o077) === 0,
      };
    }
  }

  return null;
}

export function gmailBeschikbaar() {
  return vindGmailSleutels() !== null;
}

/* ─────────────────────────── opslag van de koppeling ───────────────────── */

const KOPPEL_PAD = inData('stagebot', 'gmail.json');

/**
 * Bewaart de koppeling in data/stagebot/gmail.json (alleen leesbaar voor jou).
 *
 * Waarom niet in .env: dat bestand wordt met de hand bewerkt en door meer
 * onderdelen gelezen. Een apart bestand kan de UI veilig herschrijven zonder
 * dat er per ongeluk iets anders in .env sneuvelt.
 */
export function bewaarGmailSleutels({ gebruiker, wachtwoord }) {
  const schoon = {
    gebruiker: String(gebruiker ?? '').trim(),
    wachtwoord: String(wachtwoord ?? '').replace(/\s+/g, ''),
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(schoon.gebruiker)) {
    throw new Error('Dat lijkt geen e-mailadres.');
  }
  if (schoon.wachtwoord.length < 8) {
    throw new Error('Een app-wachtwoord is langer dan dit. Kopieer hem opnieuw.');
  }

  mkdirSync(path.dirname(KOPPEL_PAD), { recursive: true });
  writeFileSync(
    KOPPEL_PAD,
    JSON.stringify({ versie: 1, ...schoon, gekoppeld: new Date().toISOString() }, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  );
  try {
    chmodSync(KOPPEL_PAD, 0o600);
  } catch {
    /* niet elk bestandssysteem doet dit */
  }
  return { gebruiker: schoon.gebruiker };
}

export function verwijderGmailSleutels() {
  if (existsSync(KOPPEL_PAD)) rmSync(KOPPEL_PAD);
}

/**
 * Controleert de inloggegevens zonder een mail te versturen.
 *
 * Dit is wat de knop "koppelen" doet: pas als Gmail de combinatie accepteert,
 * slaan we hem op. Zo kom je er niet een dag later achter dat het wachtwoord
 * niet klopte toen je twintig mails wilde versturen.
 */
export async function controleerGmailLogin({ gebruiker, wachtwoord, host, port, secure }) {
  const { socket, commando } = await openVerbinding({
    host: host ?? SMTP_HOST,
    port: port ?? SMTP_POORT,
    secure: secure ?? (port ?? SMTP_POORT) === 465,
  });

  try {
    await commando('EHLO stagebot', [250]);
    const auth = await commando('AUTH LOGIN', [334, 235]);
    if (auth.code === 334) {
      await commando(Buffer.from(gebruiker, 'utf8').toString('base64'), [334]);
      await commando(Buffer.from(wachtwoord, 'utf8').toString('base64'), [235]);
    }
    await commando('QUIT', [221, 250]);
    return { ok: true };
  } finally {
    socket.end();
  }
}

/* ─────────────────────────────── MIME ─────────────────────────────────── */

const quoteer = (tekst) => String(tekst).replace(/(["\\])/g, '\\$1');

/**
 * Een onderwerp met rare tekens moet RFC 2047-gecodeerd worden.
 *
 * base64 in stukken van maximaal 75 tekens, want een encoded-word mag niet
 * langer zijn. Zonder dit krijg je "=?UTF-8?B?...?=" als letterlijke tekst in
 * de inbox bij lange onderwerpen of bij een streepje dat net verkeerd valt.
 */
export function codeerOnderwerp(onderwerp) {
  const tekst = String(onderwerp ?? '').replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7E]/.test(tekst)) return tekst;

  const bytes = Buffer.from(tekst, 'utf8');
  const stukken = [];
  const perStuk = 45; // 45 bytes → 60 base64-tekens, ruim onder de 75
  for (let i = 0; i < bytes.length; i += perStuk) {
    stukken.push(`=?UTF-8?B?${bytes.subarray(i, i + perStuk).toString('base64')}?=`);
  }
  return stukken.join('\r\n ');
}

/** De datumregel in RFC 2822-vorm, altijd in het Engels (dat is het protocol). */
export function rfc2822Datum(datum = new Date()) {
  return datum.toUTCString().replace(/GMT$/, '+0000');
}

/** Basistekst netjes op 76 tekens, zoals de standaard wil. */
function vouwBase64(tekst) {
  const base64 = Buffer.from(tekst, 'utf8').toString('base64');
  const regels = [];
  for (let i = 0; i < base64.length; i += 76) regels.push(base64.slice(i, i + 76));
  return regels.join('\r\n');
}

/**
 * Bouwt het volledige bericht.
 *
 * Los van het versturen, zodat de test het kan controleren zonder netwerk.
 */
export function maakMime({ van, vanNaam, aan, onderwerp, tekst, replyTo, messageId }) {
  const domein = String(van).split('@')[1] ?? 'localhost';
  const kop = [
    `Date: ${rfc2822Datum()}`,
    `From: ${vanNaam ? `"${quoteer(vanNaam)}" ` : ''}<${van}>`,
    `To: <${aan}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: ${codeerOnderwerp(onderwerp)}`,
    `Message-ID: ${messageId ?? `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domein}>`}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);

  return `${kop.join('\r\n')}\r\n\r\n${vouwBase64(tekst)}\r\n`;
}

/* ─────────────────────────────── SMTP ─────────────────────────────────── */

/**
 * Een klein SMTP-gesprek.
 *
 * Het protocol is vraag en antwoord: schrijf een regel, lees een antwoord dat
 * met een cijfer begint. Een antwoord kan meerdere regels zijn —
 *
 *   250-eerste regel
 *   250-tweede regel
 *   250 laatste regel
 *
 * — en alleen de laatste regel heeft een spatie na de code. Dat onderscheid is
 * het enige dat je hier echt moet weten.
 */
function openVerbinding({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    socket.setEncoding('utf8');

    let buffer = '';
    const klaar = [];
    const wachtenden = [];
    let afgesloten = false;
    let fout = null;

    const timer = setTimeout(() => {
      fout = new Error('De mailserver antwoordde niet op tijd');
      socket.destroy();
      reject(fout);
    }, TIMEOUT_MS);

    /** Pakt het volgende complete antwoord uit de buffer, of null. */
    const volgendAntwoord = () => {
      const regels = [];
      for (;;) {
        const index = buffer.indexOf('\r\n');
        if (index === -1) return null;
        const regel = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        regels.push(regel);
        if (regel.length >= 4 && regel[3] === '-') continue;
        return { code: Number(regel.slice(0, 3)), tekst: regels.join('\n') };
      }
    };

    /** Deelt antwoorden uit aan wie erop wacht. */
    const pomp = () => {
      for (;;) {
        if (!wachtenden.length) return;
        const antwoord = klaar.length ? klaar.shift() : volgendAntwoord();
        if (!antwoord) return;
        wachtenden.shift()(antwoord);
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk;
      pomp();
    });
    socket.on('error', (error) => {
      if (!fout) reject(error);
    });
    socket.on('close', () => {
      afgesloten = true;
      if (!fout) reject(new Error('De verbinding met de mailserver sloot onverwacht'));
    });

    socket.on(secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);

      const antwoord = () => new Promise((k) => {
        wachtenden.push(k);
        pomp();
      });

      const commando = async (regel, verwacht) => {
        socket.write(`${regel}\r\n`);
        const uit = await antwoord();
        if (!verwacht.includes(uit.code)) {
          fout = new Error(`Mailserver zei ${uit.code}: ${uit.tekst.split('\n').pop()}`);
          socket.destroy();
          throw fout;
        }
        return uit;
      };

      // Eerst de begroeting van de server (220), daarna pas praten.
      antwoord().then((begroeting) => {
        if (begroeting.code !== 220) {
          fout = new Error(`Mailserver begroette met ${begroeting.code}: ${begroeting.tekst}`);
          socket.destroy();
          reject(fout);
          return;
        }
        resolve({ socket, commando, isAfgesloten: () => afgesloten });
      });
    });
  });
}

/**
 * Verstuurt één mail.
 *
 * @returns {Promise<{ok: true, messageId: string, naar: string}>}
 */
export async function verstuurMail({ van, vanNaam, aan, onderwerp, tekst, replyTo, host, port, secure }) {
  const sleutels = vindGmailSleutels();
  if (!sleutels) {
    throw new Error(
      'Geen Gmail-inloggegevens. Zet GMAIL_USER en GMAIL_APP_PASSWORD in .env (zie docs/stagebot.md).',
    );
  }
  if (!aan || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(aan)) {
    throw new Error(`Geen bruikbaar e-mailadres om naar te sturen: ${aan ?? 'leeg'}`);
  }

  const afzender = van ?? sleutels.gebruiker;
  const bericht = maakMime({
    van: afzender,
    vanNaam: vanNaam ?? 'Dylan Schuurman',
    aan,
    onderwerp,
    tekst,
    replyTo: replyTo ?? afzender,
  });
  const messageId = (/^Message-ID: (.+)$/m.exec(bericht) ?? [])[1];

  const { socket, commando } = await openVerbinding({
    host: host ?? SMTP_HOST,
    port: port ?? SMTP_POORT,
    secure: secure ?? (port ?? SMTP_POORT) === 465,
  });

  try {
    await commando('EHLO stagebot', [250]);

    /*
     * Inloggen. AUTH LOGIN stuurt eerst een uitnodiging (334) waarop wij de
     * gebruikersnaam in base64 sturen, dan weer een 334 voor het wachtwoord.
     * Sommige servers accepteren meteen (235) — dat laten we ook toe.
     */
    const auth = await commando('AUTH LOGIN', [334, 235]);
    if (auth.code === 334) {
      await commando(Buffer.from(sleutels.gebruiker, 'utf8').toString('base64'), [334]);
      await commando(Buffer.from(sleutels.wachtwoord, 'utf8').toString('base64'), [235]);
    }

    await commando(`MAIL FROM:<${afzender}>`, [250]);
    await commando(`RCPT TO:<${aan}>`, [250, 251]);
    await commando('DATA', [354]);

    /*
     * Punt-stuffing: een regel die met een punt begint mag niet als einde van
     * de data gelezen worden. En het bericht moet op een eigen regel met een
     * punt eindigen — vandaar de regeleinde-controle.
     */
    const veilig = bericht.replace(/\r\n\./g, '\r\n..');
    const metEinde = veilig.endsWith('\r\n') ? veilig : `${veilig}\r\n`;
    await commando(`${metEinde}.`, [250]);
    await commando('QUIT', [221, 250]);
  } finally {
    socket.end();
  }

  return { ok: true, messageId, naar: aan };
}
