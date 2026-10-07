/**
 * Portflow API-client.
 *
 * Praat met de INTERNE API van de Portflow-app (portfolio.drieam.app/api/v1).
 * Dit is niet de publieke API van developer.portflow.app — die kan alleen
 * analytics, goals en reviews lezen. Deze API is wat de app zelf gebruikt, en
 * heeft de capability `evidence_creation`.
 *
 * Twee dingen die je moet weten voordat je hier iets aan verandert:
 *
 * 1. De directe URL https://portfolio.drieam.app werkt niet op zichzelf. Het
 *    toegangstoken wordt vers uitgegeven bij elke LTI-launch en is kortlevend.
 *    Daarom lopen we altijd via de Canvas-toolpagina.
 *
 * 2. De API eist twee headers die de app zelf meestuurt: `authorization:
 *    Bearer <lti-jwt>` en `x-csrf-token`. Zonder die twee krijg je 401, ook al
 *    is je sessie prima. We lezen ze eenmalig uit de echte requests van de app
 *    en hergebruiken ze daarna — er wordt niets gekopieerd naar schijf.
 *
 * Het portfolio-id staat niet in de URL, de opslag of de cookies; de app kent
 * het uit de launch. We leiden het af uit de requests die de app zelf doet.
 */

import { CONFIG } from './config.mjs';

export class Portflow {
  constructor(page) {
    this.page = page;
    this.frame = null;
    this.auth = null; // { authorization, csrf }
    this.portfolioId = null;
  }

  /**
   * Open Portflow via de Canvas LTI-launch, wacht tot de app zijn eigen API
   * aanroept, en pik daar het portfolio-id en de auth-headers op.
   */
  async connect() {
    await this.page.goto(CONFIG.portfolioLaunch, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    // Capture the headers and the portfolio id from the app's own traffic.
    const captured = { authorization: null, csrf: null, portfolioIds: new Set() };
    this.page.on('request', (request) => {
      const url = request.url();
      if (!url.includes(CONFIG.portflowHost)) return;
      const headers = request.headers();
      if (headers.authorization?.startsWith('Bearer ')) {
        captured.authorization = headers.authorization;
        captured.csrf = headers['x-csrf-token'] ?? captured.csrf;
      }
      const m = url.match(/\/portfolios\/(\d+)\//);
      if (m) captured.portfolioIds.add(Number(m[1]));
    });

    for (let i = 0; i < 60; i += 1) {
      await this.page.waitForTimeout(1000);
      this.frame = this.page
        .frames()
        .find((f) => f.url().includes(CONFIG.portflowHost) && f.url().includes('/portfolio'));
      if (this.frame && captured.authorization && captured.portfolioIds.size) break;
    }

    if (!this.frame) {
      throw new Error('Portflow-frame niet gevonden. Is de Canvas-sessie verlopen?');
    }
    if (!captured.authorization) {
      throw new Error(
        'Geen API-authenticatie opgevangen. De app heeft zijn eigen API niet aangeroepen;\n' +
          '  probeer opnieuw, of log opnieuw in met: node recon.mjs',
      );
    }

    this.auth = { authorization: captured.authorization, csrf: captured.csrf };
    this.portfolioId = [...captured.portfolioIds][0] ?? null;

    // Verify the session really works before claiming success.
    const check = await this.call('GET', '/api/v1/users/current');
    if (!check.ok) {
      throw new Error(`Sessie werkt niet: /users/current gaf ${check.status}`);
    }
    this.me = check.data;
    return this.portfolioId;
  }

  /**
   * Voer een request uit binnen het Portflow-iframe, met de auth-headers die de
   * app zelf gebruikt.
   */
  async call(method, path, body = undefined, { raw = false } = {}) {
    if (!this.frame) throw new Error('niet verbonden; roep eerst connect() aan');
    if (!this.auth?.authorization) throw new Error('geen auth-headers; roep eerst connect() aan');

    return this.frame.evaluate(
      async ({ method, path, body, raw, auth }) => {
        const headers = {
          Accept: 'application/json',
          authorization: auth.authorization,
        };
        if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
        const options = { method, credentials: 'include', headers };
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(body);
        }
        const res = await fetch(path, options);
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = raw ? text.slice(0, 4000) : null;
        }
        return {
          ok: res.ok,
          status: res.status,
          contentType: res.headers.get('content-type'),
          data: parsed,
          textPreview: parsed === null ? text.slice(0, 400) : null,
        };
      },
      { method, path, body, raw, auth: this.auth },
    );
  }

  /* ── lezen ───────────────────────────────────────────────────────────── */

  async collections() {
    const res = await this.call('GET', `/api/v1/portfolios/${this.portfolioId}/collections?page=1`);
    return res.data ?? [];
  }

  async sections() {
    const res = await this.call(
      'GET',
      `/api/v1/portfolios/${this.portfolioId}/sections?page=1&per_page=100`,
    );
    return res.data ?? [];
  }

  async backpack({ perPage = 100 } = {}) {
    const res = await this.call(
      'GET',
      `/api/v1/portfolios/${this.portfolioId}/backpack?per_page=${perPage}`,
    );
    return res.data ?? [];
  }

  async capabilities() {
    const res = await this.call('GET', '/api/v1/capabilities');
    return res.data ?? null;
  }

  async goals() {
    const res = await this.call('GET', `/api/v1/portfolios/${this.portfolioId}/goals?page=1`);
    return res.data ?? [];
  }

  /** Bewijs binnen één collectie. */
  async evidenceInCollection(collectionId, { perPage = 100 } = {}) {
    const res = await this.call(
      'GET',
      `/api/v1/portfolios/${this.portfolioId}/collections/${collectionId}/evidence?per_page=${perPage}`,
    );
    return res.data ?? [];
  }

  /** Alle bewijsstukken in de backpack (het losse verzamelbekken). */
  async allEvidence({ perPage = 100 } = {}) {
    const res = await this.call(
      'GET',
      `/api/v1/portfolios/${this.portfolioId}/evidence?per_page=${perPage}`,
    );
    return { ok: res.ok, status: res.status, data: res.data };
  }

  /* ── schrijven: bestand als bewijs toevoegen ──────────────────────────────
     De flow bestaat uit drie stappen, afgekeken van de app zelf:

       1. POST /direct-uploads   → vraagt een uploadplek aan, krijgt signed_id
                                   plus een tijdelijke S3-URL terug
       2. PUT  <S3-URL>          → de bytes gaan rechtstreeks naar S3
       3. POST /evidence         → maakt het bewijsstuk aan met het signed_id

     De checksum in stap 1 is de MD5 van de inhoud, base64-gecodeerd. Zonder
     die waarde weigert de server het blob-record.
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * @param {object} options
   * @param {string} options.filePath   pad naar het bestand op schijf
   * @param {number[]} options.collectionIds  collecties waarin het moet komen
   * @param {string} [options.name]     titel van het bewijsstuk
   * @param {number[]} [options.goalIds]  optioneel: leeruitkomsten koppelen
   */
  async addFileEvidence({ filePath, collectionIds = [], goalIds = [], name, quiet = false }) {
    const { readFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const nodePath = await import('node:path');

    const bytes = await readFile(filePath);
    const filename = nodePath.basename(filePath);
    const checksum = createHash('md5').update(bytes).digest('base64');
    const contentType = guessMime(nodePath.extname(filename));
    const title = name || nodePath.basename(filename, nodePath.extname(filename));

    /* Stap 1: uploadplek aanvragen. */
    const init = await this.call('POST', '/api/v1/direct-uploads', {
      blob: { filename, content_type: contentType, byte_size: bytes.length, checksum },
    });
    if (!init.ok) {
      throw new Error(
        `upload aanvragen mislukt (${init.status}): ${JSON.stringify(init.data ?? init.textPreview).slice(0, 300)}`,
      );
    }

    const signedId = init.data?.signed_id;
    const uploadUrl = init.data?.direct_upload?.url;
    const uploadHeaders = init.data?.direct_upload?.headers ?? {};
    if (!signedId || !uploadUrl) {
      throw new Error(`onvolledig antwoord van /direct-uploads: ${JSON.stringify(init.data).slice(0, 300)}`);
    }

    /* Stap 2: bytes naar S3. Dit gaat buiten de pagina om, rechtstreeks. */
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, ...uploadHeaders },
      body: bytes,
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => '');
      throw new Error(`opslaan in S3 mislukt (${put.status}): ${detail.slice(0, 200)}`);
    }

    /* Stap 3: bewijsstuk aanmaken. */
    const create = await this.call('POST', `/api/v1/portfolios/${this.portfolioId}/evidence`, {
      files: [{ signed_id: signedId, file_name: filename, type: contentType }],
      collection_ids: collectionIds,
      goal_ids: goalIds,
      activity_ids: [],
      version_type: 'file',
      name: title,
    });
    if (!create.ok) {
      throw new Error(
        `bewijs aanmaken mislukt (${create.status}): ${JSON.stringify(create.data ?? create.textPreview).slice(0, 300)}`,
      );
    }

    if (!quiet) {
      console.log(`    geüpload: "${title}" -> evidence ${create.data?.id}`);
    }
    return { evidenceId: create.data?.id ?? null, name: title, size: bytes.length, data: create.data };
  }

  /** Verwijdert een bewijsstuk. Geeft de HTTP-status terug. */
  async deleteEvidence(evidenceId) {
    const res = await this.call(
      'DELETE',
      `/api/v1/portfolios/${this.portfolioId}/evidence/${evidenceId}`,
    );
    return res.status;
  }
}

/** Bestandstype op basis van de extensie. */
function guessMime(ext) {
  const map = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.zip': 'application/zip',
  };
  return map[String(ext).toLowerCase()] ?? 'application/octet-stream';
}
