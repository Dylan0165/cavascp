/**
 * Gmail lezen, zonder pakketten.
 *
 * WAAROM IMAP EN GEEN API
 *
 * De Gmail-API vraagt OAuth: een Google Cloud-project, een client, een
 * consent-scherm. Voor "lees de antwoorden op mijn stage-mails" is dat een
 * omweg met een token dat kan verlopen. IMAP werkt met hetzelfde
 * app-wachtwoord dat al in .env staat voor het versturen — één sleutel voor
 * beide kanten.
 *
 * WAT DIT WEL EN NIET DOET
 *
 * Wel: de INBOX openen, zoeken op datum, en van de gevonden berichten de
 * afzender, het onderwerp en de tekst ophalen. Met BODY.PEEK, zodat een
 * bericht niet meteen als gelezen gemarkeerd wordt — jij moet het nog zelf in
 * je mail zien.
 *
 * Niet: mappen, bijlagen, flaggen, verwijderen. Dit is lezen, verder niets.
 *
 * OVER HET PROTOCOL
 *
 * IMAP is regelgebaseerd, maar met één valkuil: een antwoord kan een literal
 * bevatten — `{1234}` aan het eind van een regel, gevolgd door precies 1234
 * bytes die overal nieuw regels in mogen hebben. Daarom leest deze client
 * niet blind regels, maar houdt hij bij of er een literal volgt.
 */

import tls from 'node:tls';

const HOST = process.env.IMAP_HOST || 'imap.gmail.com';
const POORT = Number(process.env.IMAP_PORT || 993);
const TIMEOUT_MS = 45_000;

/* ────────────────────────────── hulpjes ────────────────────────────────── */

/** IMAP wil datums als `01-Jan-2026`, in het Engels. */
export function imapDatum(datum) {
  const maanden = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const twee = (n) => String(n).padStart(2, '0');
  return `${twee(datum.getDate())}-${maanden[datum.getMonth()]}-${datum.getFullYear()}`;
}

/** Een string tussen aanhalingstekens, met de juiste escapes. */
const quote = (tekst) => `"${String(tekst).replace(/(["\\])/g, '\\$1')}"`;

/** Pakt de header-waarde uit een blok headers. */
export function header(blok, naam) {
  const regels = String(blok ?? '').split(/\r?\n/);
  const uit = [];

  let bezig = false;
  for (const regel of regels) {
    if (/^[A-Za-z-]+:/.test(regel)) {
      bezig = regel.toLowerCase().startsWith(`${naam.toLowerCase()}:`);
      if (bezig) uit.push(regel.slice(regel.indexOf(':') + 1).trim());
    } else if (bezig && /^\s/.test(regel)) {
      uit.push(regel.trim()); // doorgelopen header
    } else {
      bezig = false;
    }
  }

  return uit.join(' ').trim();
}

/**
 * MIME-quoted-printable en base64 weer leesbaar maken.
 *
 * Gmail stuurt de tekst vaak als quoted-printable (`=E2=82=AC` voor €). Zonder
 * decoderen lees je alleen brei.
 */
export function decodeerInhoud(tekst, { charset = 'utf-8', encoding = '' } = {}) {
  let uit = String(tekst ?? '');

  if (/base64/i.test(encoding)) {
    try {
      uit = Buffer.from(uit.replace(/\s+/g, ''), 'base64').toString(
        /iso-8859-1|latin1/i.test(charset) ? 'latin1' : 'utf8',
      );
    } catch {
      /* laat staan wat er staat */
    }
  } else if (/quoted-printable/i.test(encoding) || /=([0-9A-F]{2})/i.test(uit)) {
    uit = uit
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    // De bytes hierboven zijn latin1; opnieuw lezen als utf8 maakt er weer
    // leesbare tekst van.
    uit = Buffer.from(uit, 'latin1').toString(/iso-8859-1|latin1/i.test(charset) ? 'latin1' : 'utf8');
  }

  return uit;
}

/**
 * De leesbare tekst uit een volledig bericht halen.
 *
 * Stap voor stap: headers van de body scheiden, de MIME-grens opzoeken, het
 * text/plain-deel pakken (of html als dat er niet is), en dat decoderen. Zonder
 * die volgorde lees je header-regels als mailtekst.
 */
export function tekstVanMime(bericht) {
  const tekst = String(bericht ?? '');
  const kopEinde = tekst.indexOf('\r\n\r\n');
  const kop = kopEinde === -1 ? '' : tekst.slice(0, kopEinde);
  const body = kopEinde === -1 ? tekst : tekst.slice(kopEinde + 4);

  const grens = /boundary="?([^"\r\n;]+)"?/i.exec(kop);

  const maakLeesbaar = (deel, deelKop) => {
    const leesbaar = decodeerInhoud(deel, {
      charset: charsetVan(deelKop),
      encoding: encodingVan(deelKop),
    });
    return /<(!doctype|html|div|p|table)\b/i.test(leesbaar) ? htmlNaarTekst(leesbaar) : leesbaar;
  };

  if (!grens) return maakLeesbaar(body, kop);

  const delen = body.split(`--${grens[1]}`);
  const kies = (type) => delen.find((deel) => new RegExp(`content-type:\\s*${type}`, 'i').test(deel));
  const deel = kies('text\\/plain') ?? kies('text\\/html') ?? delen[1] ?? body;

  const deelKopEinde = deel.indexOf('\r\n\r\n');
  const deelKop = deelKopEinde === -1 ? '' : deel.slice(0, deelKopEinde);
  const deelBody = deelKopEinde === -1 ? deel : deel.slice(deelKopEinde + 4);

  return maakLeesbaar(deelBody, deelKop || deel);
}

function charsetVan(blok) {
  return (/charset="?([^";\r\n]+)"?/i.exec(blok) ?? [])[1] ?? 'utf-8';
}

function encodingVan(blok) {
  return (/content-transfer-encoding:\s*([^\r\n;]+)/i.exec(blok) ?? [])[1] ?? '';
}

/**
 * Een gecodeerd header-woord leesbaar maken.
 *
 * Onderwerpen en namen komen binnen als `=?utf-8?Q?Mail_van_de_baas?=`. Zonder
 * decoderen lees je dat letterlijk, en dan herken je een afwijzing nooit.
 */
export function decodeerHeader(waarde) {
  const ruw = String(waarde ?? '').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, codering, tekst) => {
    const latin = /iso-8859-1|latin1|windows-1252/i.test(charset);
    if (/B/i.test(codering)) {
      return Buffer.from(tekst, 'base64').toString(latin ? 'latin1' : 'utf8');
    }
    const bytes = tekst
      .replace(/_/g, ' ')
      .replace(/=([0-9A-F]{2})/gi, (__, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'latin1').toString(latin ? 'latin1' : 'utf8');
  });

  // Soms staat er gewoon een HTML-entiteit in een onderwerp.
  return ruw.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
}

/** HTML omzetten naar platte tekst, voor mails zonder text/plain-deel. */
export function htmlNaarTekst(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** "Dylan <dylan@gmail.com>" → "dylan@gmail.com" */
export function adresVan(vanHeader) {
  const tussenHaakjes = /<([^>]+)>/.exec(vanHeader ?? '');
  if (tussenHaakjes) return tussenHaakjes[1].trim().toLowerCase();
  const kaal = String(vanHeader ?? '').trim().toLowerCase();
  return /@/.test(kaal) ? kaal : null;
}

/* ─────────────────────────────── de client ─────────────────────────────── */

/**
 * Een ruw IMAP-bericht splitsen in headers en leesbare tekst.
 *
 * De headers staan vóór de eerste lege regel; daar staat ook de MIME-grens in.
 * Pas daarna kun je de delen uit elkaar houden.
 */
export function parseBericht(ruw) {
  const tekst = String(ruw ?? '');
  const scheiding = tekst.indexOf('\r\n\r\n');
  const kop = scheiding === -1 ? tekst : tekst.slice(0, scheiding);
  const body = scheiding === -1 ? '' : tekst.slice(scheiding + 4);

  const vanHeader = header(kop, 'From');

  return {
    van: adresVan(vanHeader),
    vanNaam: decodeerHeader(vanHeader),
    onderwerp: decodeerHeader(header(kop, 'Subject')),
    datum: header(kop, 'Date'),
    tekst: tekstVanMime(`${kop}\r\n\r\n${body}`).replace(/\r\n/g, '\n').trim().slice(0, 4000),
  };
}

class ImapVerbinding {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.wachters = [];
    this.teller = 0;
    this.fout = null;

    socket.setEncoding('latin1');
    socket.on('data', (brok) => {
      this.buffer += brok;
      this.pomp();
    });
    socket.on('error', (fout) => {
      this.fout = fout;
      this.afronden();
    });
    socket.on('close', () => {
      this.fout = this.fout ?? new Error('IMAP-verbinding gesloten');
      this.afronden();
    });
  }

  /**
   * Leest één regel, en de literal die er eventueel achter staat.
   *
   * Dat is de kern van IMAP: een regel kan eindigen op `{123}`, en dan volgen
   * precies 123 bytes die zelf weer regeleindes bevatten. Wie alleen op
   * regeleindes let, leest de headers van een mail als protocol.
   */
  leesRegel() {
    const regeleinde = this.buffer.indexOf('\r\n');
    if (regeleinde === -1) return null;

    const regel = this.buffer.slice(0, regeleinde);
    let rest = this.buffer.slice(regeleinde + 2);

    const literal = /\{(\d+)\}$/.exec(regel);
    if (!literal) {
      this.buffer = rest;
      return { regel, literal: null };
    }

    const lengte = Number(literal[1]);
    if (rest.length < lengte) return null; // nog niet alles binnen

    const inhoud = rest.slice(0, lengte);
    this.buffer = rest.slice(lengte);
    return { regel, literal: inhoud };
  }

  pomp() {
    for (;;) {
      if (!this.wachters.length) return;
      const record = this.leesRegel();
      if (record === null) return;
      this.wachters.shift()(record);
    }
  }

  afronden() {
    while (this.wachters.length) this.wachters.shift()(null);
  }

  antwoord() {
    if (this.fout) return Promise.reject(this.fout);
    return new Promise((resolve) => {
      this.wachters.push(resolve);
      /*
       * Belangrijk: meteen kijken of er al iets in de buffer staat. De
       * begroeting komt vaak binnen vóórdat wij om een antwoord vragen — zonder
       * deze regel blijft de client daar voor altijd op wachten.
       */
      this.pomp();
    });
  }

  /**
   * Eén commando, tot en met de regel met onze tag.
   *
   * Untagged regels (die met `*`) horen bij het antwoord en gaan mee terug.
   */
  async commando(tekst, { verwachtOk = true } = {}) {
    this.teller += 1;
    const tag = `a${this.teller}`;
    this.socket.write(`${tag} ${tekst}\r\n`);

    let alles = '';
    let laatsteRegel = '';

    for (;;) {
      const record = await this.antwoord();
      if (record === null) throw this.fout ?? new Error('IMAP-verbinding weggevallen');

      alles += `${record.regel}\r\n${record.literal ?? ''}`;
      laatsteRegel = record.regel;

      if (new RegExp(`^${tag}\\s+(OK|NO|BAD)\\b`, 'i').test(record.regel)) break;
    }

    const mis = new RegExp(`^${tag}\\s+(NO|BAD)\\b`, 'i').test(laatsteRegel);
    if (verwachtOk && mis) throw new Error(`IMAP: ${laatsteRegel.slice(0, 200)}`);
    return { tag, tekst: alles, mis };
  }
}

async function verbind({ host = HOST, port = POORT, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('IMAP-server antwoordde niet op tijd'));
    }, timeoutMs);

    socket.once('error', (fout) => {
      clearTimeout(timer);
      reject(fout);
    });

    socket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(new ImapVerbinding(socket));
    });
  });
}

/* ─────────────────────────────── lezen ─────────────────────────────────── */

/**
 * Haalt recente berichten op uit de INBOX.
 *
 * @param {object} opties
 * @param {string} opties.gebruiker
 * @param {string} opties.wachtwoord   app-wachtwoord
 * @param {number} [opties.dagen]      hoeveel dagen terug
 * @param {number} [opties.limiet]     maximaal aantal berichten
 */
export async function haalBerichten({ gebruiker, wachtwoord, dagen = 30, limiet = 40, host, port } = {}) {
  if (!gebruiker || !wachtwoord) throw new Error('IMAP heeft een gebruiker en een app-wachtwoord nodig.');

  const verbinding = await verbind({ host, port });

  try {
    const begroeting = await verbinding.antwoord(); // `* OK Gimap ready...`
    if (!begroeting) throw new Error('IMAP-server stuurde geen begroeting');
    await verbinding.commando(`LOGIN ${quote(gebruiker)} ${quote(wachtwoord)}`);
    await verbinding.commando('SELECT INBOX');

    const sinds = new Date(Date.now() - dagen * 86_400_000);
    const zoek = await verbinding.commando(`UID SEARCH SINCE ${imapDatum(sinds)}`, { verwachtOk: false });

    const uids = (/^\*\s+SEARCH\s+(.*)$/im.exec(zoek.tekst) ?? [])[1]
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);

    if (!uids?.length) return [];

    const laatste = uids.slice(-limiet);
    const berichten = [];

    for (const uid of laatste) {
      /*
       * Het hele bericht ophalen, niet alleen de tekst. De MIME-grens staat in
       * de headers, en die krijg je met BODY[TEXT] niet mee.
       */
      const antwoord = await verbinding.commando(`UID FETCH ${uid} (BODY.PEEK[])`, { verwachtOk: false });

      const marker = /BODY\[\]\s*\{(\d+)\}\r\n/i.exec(antwoord.tekst);
      if (!marker) continue;

      const start = marker.index + marker[0].length;
      const ruw = antwoord.tekst.slice(start, start + Number(marker[1]));

      berichten.push({ uid, ...parseBericht(ruw) });
    }

    await verbinding.commando('LOGOUT', { verwachtOk: false });
    return berichten;
  } finally {
    verbinding.socket.end();
  }
}
