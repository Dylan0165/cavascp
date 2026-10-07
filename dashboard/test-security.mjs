#!/usr/bin/env node
/**
 * Controleert of het dashboard echt afgeschermd is.
 *
 * Elke test doet precies wat een aanvaller zou proberen: een cross-site
 * request, een request zonder sessie, een request via een vreemde hostnaam.
 * Alles moet geweigerd worden. Daarna controleren we dat het dashboard zelf
 * gewoon werkt.
 *
 * Draait tegen de server op poort 8787.
 *
 *   node test-security.mjs
 */

import { createConnection } from 'node:net';

const PORT = process.env.CAVASCP_PORT || 8787;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Rauwe HTTP-request over een socket.
 *
 * Nodig voor de Host-test: fetch() weigert een zelfgezette Host-header, dus
 * daarmee zou je de verkeerde laag testen en ten onrechte denken dat het goed
 * gaat.
 */
function rawSocketRequest(payload) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('timeout'));
    }, 10_000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Ruwe request zonder cookie, zodat we precies zien wat de server doet. */
async function raw(path, { headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, { method, headers, body, redirect: 'manual' });
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* leeg */
  }
  return { status: res.status, text, headers: res.headers };
}

console.log('1) Het dashboard zonder sessie');
{
  const r = await raw('/api/data', { headers: { Origin: BASE } });
  check('api/data zonder sessiecookie geweigerd', r.status === 401, `status ${r.status}`);
  const parsed = JSON.parse(r.text || '{}');
  check('weigering legt uit wat te doen', Boolean(parsed.hint), parsed.hint?.slice(0, 60));
}

console.log('\n2) Cross-site: een andere website stuurt een request');
{
  // Dit is wat een kwaadaardige pagina zou doen: Origin van een andere site.
  const r = await raw('/api/documents', { headers: { Origin: 'https://kwaadaardig.example' } });
  check('vreemde Origin geweigerd', r.status === 403, `status ${r.status}`);

  const r2 = await raw('/api/state', { headers: { Referer: 'https://kwaadaardig.example/pagina' } });
  check('vreemde Referer geweigerd', r2.status === 403, `status ${r2.status}`);
}

console.log('\n3) Lokaal programma zonder browser: geen sessie, geen herkomst');
{
  // Een script kan wel de Host en de paden namaken, maar krijgt nooit de
  // SameSite=Strict-sessiecookie. Dit is dus de laag die het opvangt.
  const r = await raw('/api/documents', { headers: { Origin: BASE } });
  check('zonder sessiecookie geweigerd', r.status === 401, `status ${r.status}`);
  const r2 = await raw('/api/portflow/collections', { headers: { Origin: BASE } });
  check('Portflow-endpoint ook geweigerd', r2.status === 401, `status ${r2.status}`);
  // Zonder Origin én zonder cookie — zoals curl het doet.
  const r3 = await raw('/api/state');
  check('kale request (zoals curl) geweigerd', r3.status === 401, `status ${r3.status}`);
}

console.log('\n4) Vreemde hostnaam (DNS-rebinding / tunnel)');
{
  // fetch() negeert een zelfgezette Host-header — dat mag niet van de spec — dus
  // dit moet via een ruwe socket, anders test je de verkeerde laag.
  const response = await rawSocketRequest(
    `GET /api/data HTTP/1.1\r\nHost: kwaadaardig.example\r\nOrigin: ${BASE}\r\nConnection: close\r\n\r\n`,
  );
  const status = Number(response.split(' ')[1]);
  check('vreemde Host geweigerd', status === 421, `status ${status}`);
  check('weigering noemt alleen-deze-machine', /alleen verbindingen vanaf deze machine/i.test(response), '');
}

console.log('\n5) Een verzonnen sessiesleutel');
{
  const r = await raw('/api/data', { headers: { Origin: BASE, Cookie: 'cavascp_session=verzonnen' } });
  check('verkeerde sleutel geweigerd', r.status === 401, `status ${r.status}`);
  const r2 = await raw(`/api/documents/x/file?k=verzonnen`, { headers: { Origin: BASE } });
  check('verkeerde sleutel in de url geweigerd', r2.status === 401, `status ${r2.status}`);
}

console.log('\n6) Het dashboard met een geldige sessie');
let sessionCookie = null;
{
  // De bootstrappagina zet de cookie; daarna werken de routes.
  const boot = await raw('/');
  check('bootstrappagina bereikbaar', boot.status === 200, `status ${boot.status}`);
  const setCookie = boot.headers.get('set-cookie') ?? '';
  check('sessiecookie gezet', setCookie.includes('cavascp_session='), setCookie.slice(0, 40) + '…');
  check('cookie is HttpOnly', /HttpOnly/i.test(setCookie));
  check('cookie is SameSite=Strict', /SameSite=Strict/i.test(setCookie));

  const match = setCookie.match(/cavascp_session=([^;]+)/);
  sessionCookie = match ? `cavascp_session=${match[1]}` : null;

  const data = await raw('/api/data', { headers: { Origin: BASE, Cookie: sessionCookie } });
  check('api/data met sessie toegestaan', data.status === 200, `status ${data.status}`);

  const docs = await raw('/api/documents', { headers: { Origin: BASE, Cookie: sessionCookie } });
  check('api/documents met sessie toegestaan', docs.status === 200, `status ${docs.status}`);

  // Een cross-site request mét cookie moet alsnog geweigerd worden.
  const crossWithCookie = await raw('/api/documents', {
    headers: { Origin: 'https://kwaadaardig.example', Cookie: sessionCookie },
  });
  check('cross-site mét cookie alsnog geweigerd', crossWithCookie.status === 403, `status ${crossWithCookie.status}`);
}

console.log('\n7) Beveiligingsheaders');
{
  const r = await raw('/', {});
  const h = r.headers;
  check('Referrer-Policy: no-referrer', h.get('referrer-policy') === 'no-referrer', String(h.get('referrer-policy')));
  check('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff');
  check('X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY');
  check('CORP: same-origin', h.get('cross-origin-resource-policy') === 'same-origin');
  check('X-Robots-Tag noindex', /noindex/.test(h.get('x-robots-tag') ?? ''));
}

console.log('\n8) Path traversal blijft geblokkeerd');
{
  const r = await raw('/api/documents/..%2F..%2Fserver.mjs/file', {
    headers: { Origin: BASE, Cookie: sessionCookie },
  });
  check('geen path traversal', r.status === 404 || r.status === 400, `status ${r.status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALLES OK — het dashboard is afgeschermd' : `${failed.length} CHECK(S) MISLUKT`}`);
process.exit(failed.length === 0 ? 0 : 1);
