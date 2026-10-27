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
  /**
   * Zet een bestand als bewijsstuk in één of meer mappen.
   *
   * @param {object} opties
   * @param {string} opties.filePath
   * @param {number[]} [opties.collectionIds]  mappen waar het in moet
   * @param {number[]} [opties.goalIds]        leeruitkomsten; meerdere mag
   * @param {string} [opties.name]             titel in Portflow
   * @param {string} [opties.description]      toelichting bij het bewijsstuk
   */
  async addFileEvidence({ filePath, collectionIds = [], goalIds = [], name, description = '', quiet = false }) {
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
      ...(description ? { description } : {}),
    });
    if (!create.ok) {
      throw new Error(
        `bewijs aanmaken mislukt (${create.status}): ${JSON.stringify(create.data ?? create.textPreview).slice(0, 300)}`,
      );
    }

    const evidenceId = create.data?.id ?? null;
    if (!quiet) {
      console.log(`    geüpload: "${title}" -> evidence ${evidenceId}`);
    }
    return { evidenceId, id: evidenceId, name: title, size: bytes.length, data: create.data };
  }

  /* ──────────────────── schrijven: beschrijvingen ──────────────────────── */

  /** Verwijdert een bewijsstuk. Geeft de HTTP-status terug. */
  async deleteEvidence(evidenceId) {
    const res = await this.call(
      'DELETE',
      `/api/v1/portfolios/${this.portfolioId}/evidence/${evidenceId}`,
    );
    return res.status;
  }

  /**
   * Zet de beschrijving van een map — dit is de leeswijzer voor de docent.
   *
   * Portflow accepteert PATCH en PUT op de collectie en antwoordt met 204.
   */
  async setCollectionDescription(collectionId, description) {
    const res = await this.call('PATCH', `/api/v1/portfolios/${this.portfolioId}/collections/${collectionId}`, {
      description: description ?? '',
    });
    if (res.status !== 204 && res.status !== 200) {
      throw new Error(
        `beschrijving zetten mislukt (${res.status}): ${JSON.stringify(res.data ?? res.textPreview).slice(0, 240)}`,
      );
    }
    return { ok: true, collectionId, length: (description ?? '').length };
  }

  /** De ondertitel van een map. */
  async setCollectionSubtitle(collectionId, subtitle) {
    const res = await this.call('PATCH', `/api/v1/portfolios/${this.portfolioId}/collections/${collectionId}`, {
      subtitle: subtitle ?? '',
    });
    if (res.status !== 204 && res.status !== 200) {
      throw new Error(`ondertitel zetten mislukt (${res.status}): ${res.textPreview?.slice(0, 200)}`);
    }
    return { ok: true, collectionId };
  }

  /** De toelichting bij één bewijsstuk. */
  async setEvidenceDescription(evidenceId, description) {
    const res = await this.call('PATCH', `/api/v1/portfolios/${this.portfolioId}/evidence/${evidenceId}`, {
      description: description ?? '',
    });
    if (res.status !== 204 && res.status !== 200) {
      throw new Error(
        `toelichting zetten mislukt (${res.status}): ${JSON.stringify(res.data ?? res.textPreview).slice(0, 240)}`,
      );
    }
    return { ok: true, evidenceId, length: (description ?? '').length };
  }

  /** Welke leeruitkomsten hangen er aan dit bewijsstuk? */
  async evidenceGoals(evidenceId) {
    const res = await this.call('GET', `/api/v1/portfolios/${this.portfolioId}/evidence/${evidenceId}/goals`);
    if (!res.ok) throw new Error(`doelen ophalen mislukt (${res.status})`);
    const lijst = Array.isArray(res.data) ? res.data : [];
    return lijst.map((g) => ({ id: g.id, name: g.name ?? g.nickname ?? String(g.id) }));
  }

  /**
   * Koppelt een bewijsstuk aan leeruitkomsten.
   *
   * LET OP: dit VERVANGT de bestaande koppelingen, het vult niet aan. Geef dus
   * altijd de volledige lijst mee. Wil je er één bijzetten, haal dan eerst de
   * huidige set op met evidenceGoals() en voeg toe.
   */
  async setEvidenceGoals(evidenceId, goalIds = []) {
    const res = await this.call('PATCH', `/api/v1/portfolios/${this.portfolioId}/evidence/${evidenceId}`, {
      goal_ids: goalIds,
    });
    if (res.status !== 204 && res.status !== 200) {
      throw new Error(
        `doelen koppelen mislukt (${res.status}): ${JSON.stringify(res.data ?? res.textPreview).slice(0, 240)}`,
      );
    }
    return { ok: true, evidenceId, goalIds };
  }

  /** Zet er één leeruitkomst bij, zonder de bestaande te verliezen. */
  async addEvidenceGoal(evidenceId, goalId) {
    const huidig = await this.evidenceGoals(evidenceId);
    const ids = new Set(huidig.map((g) => g.id));
    if (ids.has(goalId)) return { ok: true, evidenceId, goalIds: [...ids], alAanwezig: true };
    ids.add(goalId);
    const resultaat = await this.setEvidenceGoals(evidenceId, [...ids]);
    return { ...resultaat, alAanwezig: false };
  }

  /** De mappen waar dit bewijsstuk in zit. */
  async evidenceCollections(evidenceId) {
    const res = await this.call('GET', `/api/v1/portfolios/${this.portfolioId}/evidence/${evidenceId}/collections`);
    if (!res.ok) throw new Error(`mappen ophalen mislukt (${res.status})`);
    const lijst = Array.isArray(res.data) ? res.data : [];
    return lijst.map((c) => ({ id: c.id, name: c.name }));
  }

  /* ───────────────────── snapshots (portfolio-freezes) ─────────────────── */

  /**
   * Alle snapshots van dit portfolio.
   *
   * LET OP het pad: `/api/v1/frozen-portfolios`, ZONDER portfolio-id erin. Dat
   * is gevonden door de pagina "My snapshots" te openen en het verkeer vast te
   * leggen; het staat niet in de JS-bundel en raden levert 404 op.
   */
  async snapshots({ page = 1, perPage = 50 } = {}) {
    const res = await this.call('GET', `/api/v1/frozen-portfolios?page=${page}&per_page=${perPage}`);
    if (!res.ok) throw new Error(`snapshots ophalen mislukt (${res.status})`);
    const data = res.data;
    const lijst = Array.isArray(data) ? data : (data?.data ?? data?.frozen_portfolios ?? []);
    return lijst.map((f) => ({
      id: f.id,
      naam: f.name,
      versie: f.version_number ?? null,
      gemaakt: f.created_at ?? null,
      bijgewerkt: f.updated_at ?? null,
      code: f.snapshot_code ?? null,
      showcaseUrl: f.showcase_url ?? null,
      assessmentUrl: f.assessment_url ?? null,
      inleveringen: Array.isArray(f.lms_assignments) ? f.lms_assignments.length : 0,
      lmsAssignments: f.lms_assignments ?? [],
      bio: f.bio ?? null,
      ruw: f,
    }));
  }

  /** Eén snapshot. */
  async snapshot(id) {
    const alle = await this.snapshots({ perPage: 100 });
    const gevonden = alle.find((s) => Number(s.id) === Number(id));
    if (!gevonden) throw new Error(`snapshot ${id} niet gevonden`);
    return gevonden;
  }

  /** Een snapshot verwijderen. Geeft de HTTP-status terug. */
  async deleteSnapshot(id) {
    const res = await this.call('DELETE', `/api/v1/frozen-portfolios/${id}`);
    return res.status;
  }

  /**
   * Welk bewijs zit er in een map? Nodig om een snapshot op te bouwen.
   *
   * Dit gebruikt het portfolio-freezes-endpoint, het enige dat bewijs MET zijn
   * doelen teruggeeft. Het gewone collectie-endpoint geeft alleen de stukken.
   */
  async evidenceForFreeze(collectionId, { perPage = 200 } = {}) {
    const res = await this.call(
      'GET',
      `/api/v1/portfolios/${this.portfolioId}/portfolio-freezes/collections/${collectionId}/evidence?page=1&per_page=${perPage}`,
    );
    if (!res.ok) throw new Error(`bewijs ophalen voor map ${collectionId} mislukt (${res.status})`);
    const lijst = Array.isArray(res.data) ? res.data : [];
    return lijst.map((item) => {
      const ev = item.evidence ?? item;
      return {
        id: ev.id,
        naam: ev.name,
        goalIds: (ev.goals ?? []).map((g) => g.id ?? g).filter((n) => Number.isFinite(Number(n))),
      };
    });
  }

  /**
   * Een snapshot maken.
   *
   * De vijf stappen uit de modal, in één aanroep. De body is precies zoals de
   * app hem stuurt — dat is afgekeken van het echte verkeer, niet geraden:
   *
   *   {
   *     name, type: 'goal',
   *     goal_ids: [...],
   *     sections: [...],
   *     collection_evidence: [{ collection_id, evidence_ids: [...] }]
   *   }
   *
   * Na het aanmaken duurt het even voordat hij klaar is; Portflow zegt zelf
   * "being finalized". Gebruik wachtOpSnapshot() om te wachten tot hij in de
   * lijst staat.
   */
  async maakSnapshot({
    naam,
    collectionIds = [],
    goalIds = [],
    sections = [],
    type = 'goal',
    alleenDezeMappen = true,
    quiet = false,
  }) {
    if (!naam) throw new Error('een snapshot heeft een naam nodig');
    if (!collectionIds.length) throw new Error('geen mappen opgegeven');

    /* Per map het bewijs ophalen. */
    const collectionEvidence = [];
    for (const cid of collectionIds) {
      const bewijs = await this.evidenceForFreeze(cid);
      collectionEvidence.push({
        collection_id: Number(cid),
        evidence_ids: bewijs.map((b) => Number(b.id)),
      });
      if (!quiet) console.log(`    map ${cid}: ${bewijs.length} bewijsstukken`);
    }

    /*
     * De mappen die NIET meegaan. De app stuurt dit mee in `sections`, met
     * `excepted_collection_ids`. Zonder deze lijst zou een snapshot van het
     * hele portfolio gemaakt worden in plaats van alleen de gekozen mappen.
     */
    let secties = sections;
    if (!secties.length) {
      const alleMappen = await this.collections();
      const gekozen = new Set(collectionIds.map(Number));
      const overige = alleMappen
        .filter((m) => !gekozen.has(Number(m.id)) && m.section_id)
        .map((m) => Number(m.id));
      const perSectie = new Map();
      for (const m of alleMappen) {
        if (!m.section_id || gekozen.has(Number(m.id))) continue;
        if (!perSectie.has(m.section_id)) perSectie.set(m.section_id, []);
        perSectie.get(m.section_id).push(Number(m.id));
      }
      secties = [...perSectie.entries()].map(([id, ids], i) => ({
        id,
        selected: false,
        excepted_collection_ids: ids,
        position: i,
      }));
      if (alleenDezeMappen && !secties.length) {
        // Niets uit te sluiten: dan is één lege sectie genoeg, net als de app.
        secties = [{ selected: false, excepted_collection_ids: [] }];
      }
    }

    const body = {
      name: String(naam).slice(0, 100),
      type,
      sections: secties,
      collection_evidence: collectionEvidence,
      goal_ids: goalIds.map(Number).filter((n) => Number.isFinite(n)),
    };

    if (!quiet) {
      const totaal = collectionEvidence.reduce((n, c) => n + c.evidence_ids.length, 0);
      console.log(`    snapshot "${body.name}": ${collectionEvidence.length} mappen, ${totaal} bewijsstukken, ${body.goal_ids.length} doelen`);
    }

    const res = await this.call('POST', `/api/v1/portfolios/${this.portfolioId}/freeze`, body);
    if (!res.ok) {
      throw new Error(
        `snapshot maken mislukt (${res.status}): ${JSON.stringify(res.data ?? res.textPreview).slice(0, 400)}`,
      );
    }
    return { ok: true, body, antwoord: res.data ?? null };
  }

  /** De samenvatting die de modal toont voordat je opslaat. Handig als controle. */
  async freezeSamenvatting({ collectionIds = [], goalIds = [], sections = [], type = 'goal' }) {
    const collectionEvidence = [];
    for (const cid of collectionIds) {
      const bewijs = await this.evidenceForFreeze(cid);
      collectionEvidence.push({ collection_id: Number(cid), evidence_ids: bewijs.map((b) => Number(b.id)) });
    }
    const res = await this.call('POST', '/api/v1/portfolios/' + this.portfolioId + '/freeze-summary', {
      type,
      sections,
      collection_evidence: collectionEvidence,
      goal_ids: goalIds.map(Number),
    });
    return { ok: res.ok, status: res.status, data: res.data };
  }

  /**
   * Wacht tot een nieuwe snapshot in de lijst staat.
   *
   * Portflow maakt hem op de achtergrond klaar ("being finalized"), dus direct
   * na het aanmaken is hij nog niet zichtbaar. We wachten tot er een snapshot
   * bij staat die er eerst niet was.
   */
  async wachtOpSnapshot({ bekendeIds = [], timeoutMs = 120_000, intervalMs = 4000 } = {}) {
    const begin = Date.now();
    const bekend = new Set(bekendeIds.map(Number));
    while (Date.now() - begin < timeoutMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
      let alle;
      try {
        alle = await this.snapshots({ perPage: 100 });
      } catch {
        continue;
      }
      const nieuw = alle.find((s) => !bekend.has(Number(s.id)));
      if (nieuw) return nieuw;
    }
    return null;
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
