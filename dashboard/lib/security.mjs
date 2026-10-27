/**
 * Toegangscontrole voor het dashboard.
 *
 * Lokale server of niet: zonder deze laag kan elke website die je bezoekt
 * stiekem requests naar 127.0.0.1:8787 sturen, en kan elk proces op je machine
 * de API uitlezen. Deze module zet daar vier sloten op.
 *
 * 1. Sessiecookie (HttpOnly, SameSite=Strict)
 *    De server maakt bij het starten één geheim aan. Alleen wie dat geheim
 *    meestuurt, komt binnen. HttpOnly betekent dat JavaScript er niet bij kan;
 *    SameSite=Strict betekent dat een request vanaf een andere site de cookie
 *    niet meekrijgt — dat blokkeert CSRF.
 *
 * 2. Origin- en Referer-controle op elke API-route
 *    Een browser stuurt bij een cross-site request wél een Origin-header. Wijkt
 *    die af van onze eigen oorsprong, dan weigeren we. Dat vangt het geval
 *    waarin de cookie toch meegaat.
 *
 * 3. Host-controle
 *    We accepteren alleen localhost, 127.0.0.1 en [::1]. Zet je later een
 *    tunnel of reverse proxy ervoor, dan stopt de server daarmee tot je dat
 *    bewust toestaat — je dashboard komt niet per ongeluk op straat te staan.
 *
 * 4. Rem op dure routes
 *    Een upload start een browser. Zonder rem kan één script dat honderd keer
 *    doen. Per minuut is er een maximum.
 */

import { timingSafeEqual, randomBytes } from 'node:crypto';

/** Alles wat als "deze machine" telt. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Maakt de beveiligingslaag.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {boolean} [options.allowRemote]  bewust openzetten voor een tunnel
 * @param {number} [options.rateLimit]     dure acties per minuut
 */
export function createSecurity({ port, allowRemote = false, rateLimit = 10 } = {}) {
  /*
   * Het sessietoken is muteerbaar: bij inloggen en uitloggen maken we een
   * nieuwe. Een oude cookie is daarmee in één keer waardeloos — belangrijker
   * dan een aflopende datum, want er is maar één token voor de hele server.
   */
  let sessionToken = randomBytes(32).toString('base64url');
  const cookieName = 'cavascp_session';

  /**
   * Telt dure acties per minuut, per emmer.
   *
   * Twee emmers, niet één: een Portflow-actie start een browser en hoort op
   * tien per minuut te staan. Een stage-scan haalt een paar pagina's op en is
   * veel lichter — twintig daarvan in één run mogen niet dezelfde rem raken,
   * anders zet een dagrun zichzelf na tien bedrijven stil.
   */
  const hits = new Map();
  let lastLimitWarning = 0;

  function constantTimeEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /** Cookie-header uitlezen zonder dependency. */
  function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return null;
  }

  function hostAllowed(req) {
    if (allowRemote) return true;
    const host = (req.headers.host ?? '').toLowerCase();
    // Host kan een poort bevatten: "127.0.0.1:8787".
    const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    return LOCAL_HOSTS.has(name);
  }

  /**
   * Controleert de herkomst van een request.
   *
   * Belangrijk om te weten: bij een same-origin GET stuurt de browser géén
   * Origin-header, en de Referer is dan het volledige pad (/dashboard?k=…),
   * niet de oorsprong. "Geen Origin" betekent dus niet "geen browser" — daar
   * ging een eerdere versie van deze functie mis, met een 403 op elke
   * API-call tot gevolg.
   *
   * De regel is daarom:
   *   - Origin aanwezig en niet van ons        → weigeren (cross-site)
   *   - Origin afwezig, Referer van elders     → weigeren
   *   - Origin afwezig, geen Referer           → doorlaten; de sessiecookie
   *                                              (HttpOnly + SameSite=Strict)
   *                                              is dan de poortwachter
   *
   * Een aanvaller die geen browser is kan geen SameSite=Strict-cookie krijgen,
   * dus die strandt alsnog op de sessiecontrole.
   */
  function originAllowed(req) {
    if (allowRemote) return true;

    const expected = [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
    ];

    const origin = req.headers.origin;
    if (origin) return expected.includes(origin);

    const referer = req.headers.referer;
    if (referer) {
      try {
        return expected.includes(new URL(referer).origin);
      } catch {
        return false;
      }
    }

    return true;
  }

  function hasValidSession(req) {
    if (constantTimeEquals(readCookie(req, cookieName), sessionToken)) return true;
    // Nodig voor downloads: een <a download> kan geen header meesturen.
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    return constantTimeEquals(url.searchParams.get('k'), sessionToken);
  }

  function rateLimitOk({ emmer = 'zwaar', limiet = rateLimit } = {}) {
    const now = Date.now();
    const rij = hits.get(emmer) ?? [];
    while (rij.length && now - rij[0] > 60_000) rij.shift();
    if (rij.length >= limiet) {
      hits.set(emmer, rij);
      return false;
    }
    rij.push(now);
    hits.set(emmer, rij);
    return true;
  }

  /**
   * Controleert een API-request.
   * @returns {{ok: true} | {ok: false, status: number, error: string, hint?: string}}
   */
  /**
   * Alleen host en herkomst controleren, zonder sessie.
   *
   * Nodig voor de loginpagina zelf: die moet werken zonder cookie, maar wel
   * alleen vanaf deze machine en alleen vanaf onze eigen pagina.
   */
  function alleenHerkomst(req) {
    if (!hostAllowed(req)) {
      return {
        ok: false,
        status: 421,
        error: 'Deze server accepteert alleen verbindingen vanaf deze machine.',
        hint: 'Start met --allow-remote als je hem bewust via een tunnel bereikbaar wilt maken.',
      };
    }
    if (!originAllowed(req)) {
      return {
        ok: false,
        status: 403,
        error: 'Verzoek geweigerd: het komt niet uit het dashboard zelf.',
        hint: 'Open het dashboard via http://127.0.0.1:' + port,
      };
    }
    return { ok: true };
  }

  /**
   * Een nieuwe sessiesleutel. Bij inloggen: de oude cookie sterft.
   */
  function vernieuwSessie() {
    sessionToken = randomBytes(32).toString('base64url');
    return sessionToken;
  }

  /**
   * De rem op inlogpogingen.
   *
   * Tien per vijf minuten. Ruim genoeg om een wachtwoord drie keer verkeerd te
   * typen, krap genoeg om raden zinloos te maken.
   */
  const loginPogingen = [];

  /*
   * Alleen mislukte pogingen tellen. Anders zou je jezelf na een paar keer
   * inloggen — laptop, telefoon, een herlaadbeurt — buiten sluiten zonder dat
   * er iemand aan het raden is.
   */
  function loginPogingOk() {
    const nu = Date.now();
    while (loginPogingen.length && nu - loginPogingen[0] > 5 * 60_000) loginPogingen.shift();
    if (loginPogingen.length >= 10) return false;
    return true;
  }

  function loginMislukt() {
    loginPogingen.push(Date.now());
  }

  function loginGelukt() {
    loginPogingen.length = 0;
  }

  function check(req) {
    if (!hostAllowed(req)) {
      return {
        ok: false,
        status: 421,
        error: 'Deze server accepteert alleen verbindingen vanaf deze machine.',
        hint: 'Start met --allow-remote als je hem bewust via een tunnel bereikbaar wilt maken.',
      };
    }

    if (!originAllowed(req)) {
      return {
        ok: false,
        status: 403,
        error: 'Verzoek geweigerd: het komt niet uit het dashboard zelf.',
        hint: 'Open het dashboard via http://127.0.0.1:' + port,
      };
    }

    if (!hasValidSession(req)) {
      return {
        ok: false,
        status: 401,
        error: 'Geen geldige sessie.',
        hint: 'Open het dashboard opnieuw via http://127.0.0.1:' + port + ' — dan wordt de sessiesleutel gezet.',
      };
    }

    return { ok: true };
  }

  /** Waarschuwing bij de start als de rem een keer is geraakt. */
  function noteRateLimit() {
    const now = Date.now();
    if (now - lastLimitWarning > 30_000) {
      lastLimitWarning = now;
      console.warn(`  let op: te veel dure acties binnen een minuut (max ${rateLimit}). Even wachten.`);
    }
  }

  return {
    cookieName,
    check,
    rateLimitOk,
    noteRateLimit,
    allowRemote,
    alleenHerkomst,
    vernieuwSessie,
    loginPogingOk,
    loginMislukt,
    loginGelukt,

    /** Alleen het eerste stukje van het token tonen, om te kunnen vergelijken. */
    get fingerprint() {
      return sessionToken.slice(0, 8);
    },

    get sessionToken() {
      return sessionToken;
    },

    /**
     * Beveiligingsheaders. Deze gelden voor elke response.
     */
    headers() {
      return {
        // Een andere site mag niets met onze responses doen.
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        // Nooit meekijken met zoekmachines of Analytics.
        'X-Robots-Tag': 'noindex, nofollow',
        // Zorgt dat het sessietoken niet via een Referer weglekt.
        'Referrer-Policy': 'no-referrer',
      };
    },

    /**
     * Zet de sessiecookie. De bootstrappagina doet dit, zodat de browser hem
     * heeft voordat de app zijn eerste API-call doet.
     */
    setCookie(res) {
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=${sessionToken}; Path=/; HttpOnly; SameSite=Strict`,
      );
    },

    cookieNameForClient: cookieName,
  };
}
