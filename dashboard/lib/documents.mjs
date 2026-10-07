/**
 * Document-inbox.
 *
 * Bewaart bestanden die je bij je portfolio wilt gebruiken, met een koppeling
 * naar leeruitkomsten en opdrachten. Puur lokaal: er gaat niets naar Canvas of
 * Portflow vandaan.
 *
 * Bestanden komen in dashboard/documents/, de index in dashboard/documents.json.
 * Bestandsnamen op schijf worden ge-unicodeerd en ge-hasht, zodat twee
 * bestanden met dezelfde naam ("versie 2 definitief.docx") elkaar niet
 * overschrijven en een kwaadaardige naam niet buiten de map kan schrijven.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/** Extensions that are never worth storing here, and risky to hand back. */
const BLOCKED = new Set(['.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs', '.js']);

export function createDocumentStore({ dir, indexFile }) {
  const filesDir = path.join(dir, 'documents');

  async function ensure() {
    await mkdir(filesDir, { recursive: true });
  }

  async function readIndex() {
    if (!existsSync(indexFile)) return { version: 1, documents: [] };
    try {
      const parsed = JSON.parse(await readFile(indexFile, 'utf8'));
      return {
        version: 1,
        documents: Array.isArray(parsed?.documents) ? parsed.documents : [],
      };
    } catch {
      // A corrupt index must not take the inbox down.
      return { version: 1, documents: [] };
    }
  }

  async function writeIndex(index) {
    await ensure();
    await writeFile(indexFile, JSON.stringify(index, null, 2), 'utf8');
    return index;
  }

  /**
   * Turn an arbitrary upload name into something safe on disk.
   * Keeps the extension (it drives how the file opens) and appends a short hash
   * so identical names cannot collide.
   */
  function safeName(original) {
    const ext = path.extname(original).toLowerCase().slice(0, 12);
    const stem = path
      .basename(original, path.extname(original))
      .normalize('NFKD')
      // Strip accents and anything that is not a safe filename character.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 ._-]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'bestand';
    const hash = createHash('sha1').update(original + Date.now() + Math.random()).digest('hex').slice(0, 8);
    return { diskName: `${stem}-${hash}${ext}`, ext, stem };
  }

  return {
    dir: filesDir,
    maxBytes: MAX_BYTES,

    async list() {
      const index = await readIndex();
      const alive = [];
      for (const doc of index.documents) {
        const full = path.join(filesDir, doc.diskName);
        if (!existsSync(full)) continue; // file removed behind our back
        alive.push(doc);
      }
      if (alive.length !== index.documents.length) await writeIndex({ version: 1, documents: alive });
      return alive;
    },

    async filePathFor(id) {
      const index = await readIndex();
      const doc = index.documents.find((d) => d.id === id);
      if (!doc) return null;
      const full = path.join(filesDir, doc.diskName);
      if (!existsSync(full)) return null;
      return { doc, full };
    },

    async add({ bytes, filename, title, note, loCodes, assignmentId, courseId }) {
      const reject = (message) => {
        const error = new Error(message);
        error.status = 400; // client error, not an upstream failure
        return error;
      };

      if (!bytes?.length) throw reject('geen bestandsinhoud ontvangen');
      if (bytes.length > MAX_BYTES) {
        throw reject(`bestand groter dan ${Math.round(MAX_BYTES / 1_048_576)} MB`);
      }

      const ext = path.extname(filename || '').toLowerCase();
      if (BLOCKED.has(ext)) throw reject(`bestandstype ${ext} wordt niet geaccepteerd`);

      await ensure();
      const { diskName, ext: cleanExt } = safeName(filename || 'bestand');
      await writeFile(path.join(filesDir, diskName), bytes);

      const doc = {
        id: `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        title: (title || path.basename(filename || 'bestand', path.extname(filename || ''))).slice(0, 200),
        originalName: filename || null,
        diskName,
        ext: cleanExt || null,
        size: bytes.length,
        note: (note || '').slice(0, 4000),
        loCodes: Array.isArray(loCodes) ? loCodes.filter(Boolean).slice(0, 20) : [],
        assignmentId: assignmentId != null ? Number(assignmentId) : null,
        courseId: courseId != null ? Number(courseId) : null,
        addedAt: new Date().toISOString(),
      };

      const index = await readIndex();
      index.documents.unshift(doc);
      await writeIndex(index);
      return doc;
    },

    async update(id, patch) {
      const index = await readIndex();
      const doc = index.documents.find((d) => d.id === id);
      if (!doc) return null;
      if (typeof patch.title === 'string') doc.title = patch.title.slice(0, 200);
      if (typeof patch.note === 'string') doc.note = patch.note.slice(0, 4000);
      if (Array.isArray(patch.loCodes)) doc.loCodes = patch.loCodes.filter(Boolean).slice(0, 20);
      if ('assignmentId' in patch) {
        doc.assignmentId = patch.assignmentId != null ? Number(patch.assignmentId) : null;
      }
      // Where this document ended up in Portflow, once it has been sent.
      if ('portflow' in patch) {
        doc.portflow = patch.portflow && typeof patch.portflow === 'object' ? patch.portflow : null;
      }
      doc.updatedAt = new Date().toISOString();
      await writeIndex(index);
      return doc;
    },

    async remove(id) {
      const index = await readIndex();
      const at = index.documents.findIndex((d) => d.id === id);
      if (at === -1) return false;
      const [doc] = index.documents.splice(at, 1);
      try {
        await unlink(path.join(filesDir, doc.diskName));
      } catch {
        /* already gone; the index entry is what matters */
      }
      await writeIndex(index);
      return true;
    },

    async stats() {
      const docs = await this.list();
      const totalBytes = docs.reduce((sum, d) => sum + (d.size || 0), 0);
      return {
        count: docs.length,
        totalBytes,
        unlinked: docs.filter((d) => !d.loCodes?.length && d.assignmentId == null).length,
      };
    },

    async exists() {
      try {
        await stat(filesDir);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Parse a multipart/form-data body without a dependency.
 *
 * This is deliberately narrow: it only needs to cope with what the dashboard's
 * own drop zone sends (one file plus a few text fields), so it does not attempt
 * nested multiparts or quoted-printable encodings.
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = match?.[1] || match?.[2];
  if (!boundary) throw new Error('geen multipart-boundary in Content-Type');

  const delim = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;

  let cursor = buffer.indexOf(delim);
  if (cursor === -1) throw new Error('multipart-body bevat de boundary niet');

  while (cursor !== -1) {
    let start = cursor + delim.length;
    // "--" right after the boundary marks the end of the body.
    if (buffer.slice(start, start + 2).toString() === '--') break;
    // Skip the CRLF that follows the boundary line.
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;

    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;

    const rawHeaders = buffer.slice(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = buffer.indexOf(delim, bodyStart);
    if (next === -1) break;

    // The CRLF before the next boundary belongs to the delimiter, not the data.
    let bodyEnd = next;
    if (buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;

    const disposition = /content-disposition:([^\r\n]+)/i.exec(rawHeaders)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1]?.trim();

    if (name && filename) {
      file = { field: name, filename, contentType: type ?? null, data: buffer.slice(bodyStart, bodyEnd) };
    } else if (name) {
      fields[name] = buffer.slice(bodyStart, bodyEnd).toString('utf8');
    }

    cursor = next;
  }

  return { fields, file };
}
