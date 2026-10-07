/**
 * Canvas REST client — read-only.
 *
 * Deliberately dependency-free: Node's global fetch does everything needed, so
 * the MCP server starts instantly with no npm install and no network at boot.
 *
 * The token is never logged. Callers pass it in from the environment.
 */

const DEFAULT_BASE = 'https://fhict.instructure.com';

/** In-memory cache so one tool call does not refetch the whole account. */
const cache = new Map();

export class CanvasError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'CanvasError';
    this.status = status;
    this.body = body;
  }
}

export function createCanvas({ baseUrl = DEFAULT_BASE, token, timeoutMs = 45000 } = {}) {
  if (!token) {
    throw new CanvasError(
      'Geen Canvas-token. Zet CANVAS_TOKEN in de env van de MCP-server of in D:/cavascp/.env.',
      0,
      null,
    );
  }
  const base = String(baseUrl).replace(/\/+$/, '');

  /**
   * GET a Canvas API path. Follows Canvas' Link-header pagination when asked.
   * Returns parsed JSON.
   */
  async function get(path, query = {}, { paginate = false, maxPages = 20 } = {}) {
    let url = base + path;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, String(item));
      } else {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;

    const results = [];
    let pages = 0;

    while (url && pages < maxPages) {
      pages += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': 'cavascp-mcp/1.0 (+lokaal, read-only)',
          },
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        throw new CanvasError(
          `Canvas niet bereikbaar (${error.name}): ${error.message}`,
          0,
          null,
        );
      } finally {
        clearTimeout(timer);
      }

      const text = await response.text();
      if (!response.ok) {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* non-JSON error body */
        }
        const detail =
          parsed?.errors?.map((e) => e.message).join('; ') || text.slice(0, 200);
        throw new CanvasError(
          `Canvas gaf ${response.status} op ${path}: ${detail}`,
          response.status,
          parsed,
        );
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new CanvasError(`Onverwacht niet-JSON antwoord op ${path}`, response.status, null);
      }

      if (!paginate) return data;

      if (Array.isArray(data)) results.push(...data);
      else results.push(data);

      url = nextLink(response.headers.get('Link'));
    }

    return results;
  }

  return { base, get, cache };
}

/** Parse the RFC8288 Link header Canvas sends for paginated collections. */
function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Read a KEY=VALUE file. Used to pick up D:/cavascp/.env so the token does not
 * have to be duplicated into the DSH profile.
 */
export async function loadEnvFile(path) {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = await readFile(path, 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
