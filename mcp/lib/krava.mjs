/**
 * De brug naar Krava.
 *
 * Krava (D:\DOCAto) is het documentgereedschap: screenshots erin, een
 * verzorgd Word- of PowerPoint-bestand eruit. Dit dashboard maakt zelf geen
 * documenten met AI — het haalt ze bij Krava op en brengt ze naar Portflow.
 *
 * Waarom een brug en geen kopie van de app: Krava heeft zijn eigen
 * projectbeheer, AI-stappen en interface. Die nabouwen zou dubbel werk zijn en
 * zou uit elkaar lopen. We gebruiken Krava waar het goed in is en doen zelf de
 * rest van de keten.
 *
 * De documentgenerator zelf (mcp/lib/docx.mjs) is wél overgezet, zodat het
 * dashboard een Word-bestand kan maken zonder dat Krava draait. Dat is handig
 * voor de leeswijzer: die hoeft niet eerst door een AI-stap heen.
 *
 * Alles lokaal: Krava draait op deze computer en accepteert alleen verzoeken
 * van deze computer.
 */

import { existsSync } from 'node:fs';

const STANDAARD_POORT = Number(process.env.KRAVA_PORT ?? 4319);
const STANDAARD_MAP = process.env.KRAVA_DIR ?? 'D:/DOCAto';

/** Waar Krava staat. */
export function kravaPad() {
  return STANDAARD_MAP;
}

export function kravaBasis() {
  return `http://127.0.0.1:${STANDAARD_POORT}`;
}

/**
 * Draait Krava, en mogen we erbij?
 *
 * Krava werkt met accounts. Zodra er gebruikers bestaan, geven de
 * API-endpoints 401 zonder sessie. Dat betekent NIET dat de app stuk is — hij
 * draait, maar wil een login.
 *
 * Daarom onderscheiden we drie toestanden:
 *   - running: false, loginRequired: false  → Krava draait niet
 *   - running: true,  loginRequired: true   → draait, maar de API is dicht
 *   - running: true,  loginRequired: false  → volledige toegang
 *
 * Voor het maken van documenten maakt dat niet uit: daarvoor lezen we de
 * projecten van schijf (zie assemble.mjs) en is geen login nodig. De 401 raakt
 * alleen de HTTP-route.
 */
export async function kravaStatus({ timeoutMs = 2500 } = {}) {
  const map = kravaPad();
  if (!existsSync(map)) {
    return { running: false, installed: false, dir: map, error: `Krava niet gevonden op ${map}` };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${kravaBasis()}/api/projecten`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.status === 401) {
      return {
        running: true,
        installed: true,
        loginRequired: true,
        dir: map,
        basis: kravaBasis(),
        appUrl: `${kravaBasis()}/app`,
        note: 'Krava draait en vraagt een login. Documenten maken kan zonder: we lezen de projecten van schijf.',
      };
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { running: true, installed: true, loginRequired: false, dir: map, error: `Krava antwoordde ${res.status}` };
    }

    const projecten = body?.projecten ?? [];
    return {
      running: true,
      installed: true,
      loginRequired: false,
      dir: map,
      basis: kravaBasis(),
      appUrl: `${kravaBasis()}/app`,
      projectCount: projecten.length,
      projects: projecten.map((p) => ({
        id: p.id,
        titel: p.titel ?? '(zonder titel)',
        bijgewerkt: p.bijgewerkt ?? null,
        documenttype: p.documenttype ?? null,
        vak: p.vak ?? null,
      })),
    };
  } catch (error) {
    const reden = error.name === 'AbortError' ? `geen antwoord binnen ${timeoutMs}ms` : error.message;
    return { running: false, installed: true, dir: map, error: `Krava niet bereikbaar: ${reden}` };
  }
}

/* ─────────── projecten van schijf lezen (geen login nodig) ─────────────── */

/** Waar Krava zijn projecten bewaart. */
export function kravaProjectenMap() {
  return `${kravaPad()}/data/projects`;
}

/**
 * Leest alle projecten rechtstreeks van schijf.
 *
 * Dit is de route die werkt zonder login. Krava bewaart elk project als één
 * JSON-bestand; wij lezen dat en maken er zelf een document van met dezelfde
 * generator. Zo is er geen sessie, geen wachtwoord en geen draaiende Krava
 * nodig om een document te maken.
 */
export async function kravaProjectenVanSchijf({ minTekens = 0 } = {}) {
  const { readdirSync, readFileSync } = await import('node:fs');
  const map = kravaProjectenMap();
  if (!existsSync(map)) return [];

  const uit = [];
  for (const bestand of readdirSync(map)) {
    if (!bestand.endsWith('.json')) continue;
    try {
      const project = JSON.parse(readFileSync(`${map}/${bestand}`, 'utf8'));
      const tekens = (project.plan?.secties || []).reduce((n, s) => n + String(s.tekst || '').length, 0);
      if (tekens < minTekens) continue;
      uit.push({
        id: project.id ?? bestand.replace('.json', ''),
        bestand,
        titel: project.titel ?? '(zonder titel)',
        auteur: project.auteur ?? '',
        vak: project.vak ?? '',
        documenttype: project.documenttype ?? '',
        bijgewerkt: project.bijgewerkt ?? null,
        tekens,
        secties: (project.plan?.secties || []).length,
        afbeeldingen: (project.afbeeldingen || []).length,
        bronnen: (project.bronnen || []).length,
        project,
      });
    } catch {
      /* onleesbaar bestand overslaan */
    }
  }
  return uit.sort((a, b) => String(b.bijgewerkt ?? '').localeCompare(String(a.bijgewerkt ?? '')));
}

/** Leest één project van schijf. */
export async function kravaProjectVanSchijf(projectId) {
  const alle = await kravaProjectenVanSchijf();
  const gevonden = alle.find((p) => p.id === projectId || p.bestand === `${projectId}.json`);
  if (!gevonden) throw new Error(`Krava-project ${projectId} niet gevonden op schijf`);
  return gevonden;
}

/** Leest één project uit Krava. */
export async function kravaProject(projectId) {
  const res = await fetch(`${kravaBasis()}/api/projecten/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`Krava gaf ${res.status} voor project ${projectId}`);
  return res.json();
}

/** Maakt een nieuw project aan en geeft het terug. */
export async function kravaNieuwProject() {
  const res = await fetch(`${kravaBasis()}/api/projecten`, { method: 'POST' });
  if (!res.ok) throw new Error(`Krava gaf ${res.status} bij het aanmaken van een project`);
  return res.json();
}

/**
 * Haalt het Word-bestand van een project op.
 *
 * Krava's export-routes zetten het plan om naar secties en blokken
 * (assembleer) en renderen dat met dezelfde generator die in mcp/lib/docx.mjs
 * staat. Daarom gebruiken we deze route in plaats van zelf te assembleren:
 * dan blijft de opbouw gelijk aan wat Krava in de app laat zien.
 */
export async function kravaExportDocx(projectId) {
  const res = await fetch(`${kravaBasis()}/api/projecten/${encodeURIComponent(projectId)}/export/docx`, {
    method: 'POST',
  });

  if (!res.ok) {
    const tekst = await res.text().catch(() => '');
    // Krava geeft bij een leeg project een nette 400 met uitleg.
    let uitleg = tekst.slice(0, 200);
    try {
      uitleg = JSON.parse(tekst).error ?? uitleg;
    } catch {
      /* geen json */
    }
    throw new Error(`export mislukt (${res.status}): ${uitleg}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const naamUitKop = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  return { buffer, filename: naamUitKop ?? 'document.docx', size: buffer.length };
}

/** Hetzelfde voor PowerPoint. */
export async function kravaExportPptx(projectId) {
  const res = await fetch(`${kravaBasis()}/api/projecten/${encodeURIComponent(projectId)}/export/pptx`, {
    method: 'POST',
  });
  if (!res.ok) {
    const tekst = await res.text().catch(() => '');
    let uitleg = tekst.slice(0, 200);
    try {
      uitleg = JSON.parse(tekst).error ?? uitleg;
    } catch {
      /* geen json */
    }
    throw new Error(`PowerPoint-export mislukt (${res.status}): ${uitleg}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const naamUitKop = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  return { buffer, filename: naamUitKop ?? 'presentatie.pptx', size: buffer.length };
}

/**
 * Start Krava als dat nodig is.
 *
 * We gebruiken `spawn` met `detached` en laten de processen los: Krava is een
 * eigen app met een eigen venster, geen onderdeel van deze server. Sluit de
 * gebruiker Krava, dan merkt hij dat hier vanzelf.
 */
export async function startKrava({ wachtMs = 25000 } = {}) {
  const status = await kravaStatus();
  if (status.running) return { started: false, already: true, ...status };
  if (!status.installed) return { started: false, error: status.error };

  const { spawn } = await import('node:child_process');
  const node = process.execPath;
  const script = `${kravaPad()}/src/server.js`;

  const kind = spawn(node, [script], {
    cwd: kravaPad(),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  kind.unref();

  // Wachten tot hij antwoordt. Een koude start kost een paar seconden. Een
  // 401 telt als "staat": dan draait de app en vraagt hij alleen een login.
  const tot = Date.now() + wachtMs;
  while (Date.now() < tot) {
    await new Promise((r) => setTimeout(r, 900));
    const nu = await kravaStatus({ timeoutMs: 1500 });
    if (nu.running) return { started: true, pid: kind.pid, ...nu };
  }
  return { started: false, error: `Krava startte niet binnen ${Math.round(wachtMs / 1000)} seconden` };
}

/**
 * De hele keten: een Krava-project → Portflow.
 *
 * @param {object} opties
 * @param {string} opties.projectId      welk Krava-project
 * @param {object} opties.portflow       de Portflow-brug (browser/portflow.mjs)
 * @param {number} opties.collectionId   naar welke map
 * @param {number[]} opties.goalIds      aan welke leeruitkomsten koppelen
 * @param {string} opties.description    toelichting bij het document
 * @param {'docx'|'pptx'} opties.formaat
 * @param {object} opties.bewaar         waar het bestand tijdelijk heen mag
 */
export async function kravaNaarPortflow({
  projectId,
  portflow,
  collectionId,
  goalIds = [],
  description = '',
  naam = null,
  formaat = 'docx',
  bewaar,
}) {
  const stappen = [];
  const log = (message) => stappen.push({ at: new Date().toISOString(), message });

  log(`document ophalen uit Krava (project ${projectId})`);
  const bestand =
    formaat === 'pptx' ? await kravaExportPptx(projectId) : await kravaExportDocx(projectId);
  log(`${bestand.filename} opgehaald, ${bestand.size} bytes`);

  if (!bewaar) throw new Error('geen plek opgegeven om het bestand te bewaren');
  const { writeFile } = await import('node:fs/promises');
  const pad = typeof bewaar === 'function' ? bewaar(bestand.filename) : `${bewaar}/${bestand.filename}`;
  await writeFile(pad, bestand.buffer);
  log(`bewaard op ${pad}`);

  log(`uploaden naar Portflow-map ${collectionId}${goalIds.length ? ` met ${goalIds.length} leeruitkomst(en)` : ''}`);
  const resultaat = await portflow.addFileEvidence({
    filePath: pad,
    collectionIds: [collectionId],
    goalIds,
    name: naam ?? bestand.filename,
    description,
    quiet: true,
  });
  log(`in Portflow geplaatst${resultaat?.id ? ` als bewijs ${resultaat.id}` : ''}`);

  // De toelichting hoort bij het bewijsstuk, niet bij het bestand. Portflow
  // ondersteunt dat; mislukt het, dan is het bestand er in ieder geval.
  if (description && resultaat?.id) {
    try {
      await portflow.setEvidenceDescription(resultaat.id, description);
      log('toelichting gezet');
    } catch (error) {
      log(`toelichting zetten mislukt: ${error.message}`);
    }
  }

  return { ok: true, stappen, bestand: { ...bestand, pad }, portflow: resultaat };
}
