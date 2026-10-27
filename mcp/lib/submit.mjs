/**
 * Inleveren bij Canvas.
 *
 * Canvas kent een driestaps-upload die je niet in één keer kunt doen:
 *
 *   1. Vraag een uploadplek aan. Canvas geeft een URL plus de exacte velden
 *      terug die je moet meesturen (het `upload_params`-object). Die velden
 *      verschillen per instantie, dus ze moeten letterlijk overgenomen worden.
 *   2. POST het bestand als multipart naar die URL. Het antwoord is XML met
 *      daarin het file-id.
 *   3. Meld het file-id aan als inlevering op de opdracht.
 *
 * Dit is de enige plek in het project die naar Canvas schrijft. Alles staat
 * daarom expliciet op één regel per stap, met de status erbij, zodat een
 * verkeerde inlevering terug te vinden is.
 *
 * Het Canvas-token moet de opdracht wel mogen inleveren; is de opdracht
 * gesloten of heb je hem al ingeleverd zonder extra pogingen, dan antwoordt
 * Canvas met 403 en dat geven we door in plaats van te verbergen.
 */

/** Leest een veld uit een XML-antwoord. */
function xmlField(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!match) return null;
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Leest het file-id uit het upload-antwoord.
 *
 * Canvas antwoordt hier niet altijd hetzelfde: het opdracht-specifieke endpoint
 * geeft XML, het algemene /users/self/files geeft JSON. We accepteren beide,
 * want als dit misgaat lijkt de upload mislukt terwijl het bestand er al staat.
 */
function parseUploadResponse(text) {
  const trimmed = String(text ?? '').trim();

  // JSON-variant (het algemene endpoint).
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      const id = json?.id ?? json?.file?.id ?? null;
      return { fileId: id ? String(id) : null, raw: json };
    } catch {
      /* valt door naar XML */
    }
  }

  // XML-variant (het opdracht-specifieke endpoint).
  const id = xmlField(trimmed, 'id');
  return { fileId: id, raw: trimmed };
}

/**
 * Stap 1 en 2: bestand naar Canvas, zonder het aan een opdracht te koppelen.
 *
 * We gebruiken bewust het ALGEMENE bestandsendpoint (/users/self/files) en niet
 * het opdracht-specifieke. Waarom:
 *
 *   Het opdracht-endpoint hanteert de extensie-Whitelist van die opdracht.
 *   V-OL-MAIFS accepteert daar .docx, maar INTERN5 antwoordt met
 *   "bestandstype niet toegestaan" op hetzelfde bestand. Het algemene endpoint
 *   werkt voor beide cursussen.
 *
 * Het bestand komt in je persoonlijke Canvas-bestanden te staan; de koppeling
 * aan de opdracht gebeurt in stap 3 met het file-id. Zo is er één route die
 * overal werkt, in plaats van eentje die per cursus verschilt.
 */
export async function uploadFile(canvas, { filePath, onStep }) {
  const { readFile } = await import('node:fs/promises');
  const nodePath = await import('node:path');

  const bytes = await readFile(filePath);
  const filename = nodePath.basename(filePath);
  const contentType = guessMime(nodePath.extname(filename));

  onStep?.(`uploadplek aanvragen voor ${filename} (${bytes.length} bytes)`);

  const ticket = await canvas.post('/api/v1/users/self/files', {
    name: filename,
    size: bytes.length,
    content_type: contentType,
  });

  const uploadUrl = ticket?.upload_url;
  const uploadParams = ticket?.upload_params ?? {};
  if (!uploadUrl) {
    throw new Error(`Canvas gaf geen upload_url terug: ${JSON.stringify(ticket).slice(0, 240)}`);
  }

  onStep?.(`bestand versturen naar ${new URL(uploadUrl).host}`);

  /* Multipart POST naar de upload-URL met Canvas' eigen velden. */
  const form = new FormData();
  for (const [key, value] of Object.entries(uploadParams)) {
    form.append(key, String(value));
  }
  // Het bestandsveld moet als laatste: Canvas leest de velden ervoor eerst.
  form.append('file', new Blob([bytes], { type: contentType }), filename);

  const upload = await fetch(uploadUrl, { method: 'POST', body: form });
  const text = await upload.text();
  if (!upload.ok) {
    throw new Error(`upload mislukt (${upload.status}): ${text.slice(0, 240)}`);
  }

  const { fileId } = parseUploadResponse(text);
  if (!fileId) {
    throw new Error(`geen file-id in het antwoord: ${text.slice(0, 240)}`);
  }

  onStep?.(`bestand geplaatst, file-id ${fileId}`);
  return { fileId, filename, size: bytes.length, contentType };
}

/**
 * Stap 3: het bestand als inlevering melden.
 *
 * @param {object} options
 * @param {number} options.courseId
 * @param {number} options.assignmentId
 * @param {string} [options.fileId]     uit uploadFileForAssignment
 * @param {string} [options.text]       voor opdrachten met online_text_entry
 * @param {string} [options.url]        voor opdrachten met online_url
 * @param {string} [options.comment]    optioneel commentaar voor de docent
 */
export async function submitAssignment(canvas, options) {
  const { courseId, assignmentId, fileId, text, url, comment } = options;

  const body = { submission_type: null };
  if (fileId) {
    body.submission_type = 'online_upload';
    body.file_ids = [Number(fileId)];
  } else if (text) {
    body.submission_type = 'online_text_entry';
    body.body = text;
  } else if (url) {
    body.submission_type = 'online_url';
    body.url = url;
  } else {
    throw new Error('geen bestand, tekst of link meegegeven om in te leveren');
  }
  if (comment) body.comment = comment;

  return canvas.post(`/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`, body);
}

/**
 * De hele keten in één aanroep.
 *
 * Levert een verslag op van elke stap, zodat de UI kan tonen wat er gebeurde en
 * een fout niet stil verdwijnt.
 */
export async function submitFile(canvas, { courseId, assignmentId, filePath, comment, dryRun = false }) {
  const steps = [];
  const log = (message) => {
    steps.push({ at: new Date().toISOString(), message });
  };

  const upload = await uploadFile(canvas, { filePath, onStep: log });

  if (dryRun) {
    log('droogloop: bestand staat klaar maar is NIET ingeleverd');
    return { ok: true, dryRun: true, steps, upload };
  }

  log('inlevering melden bij Canvas');
  const submission = await submitAssignment(canvas, {
    courseId,
    assignmentId,
    fileId: upload.fileId,
    comment,
  });

  log(`ingeleverd, status ${submission?.workflow_state ?? '?'}`);

  return {
    ok: true,
    dryRun: false,
    steps,
    upload,
    submission: {
      id: submission?.id ?? null,
      state: submission?.workflow_state ?? null,
      submittedAt: submission?.submitted_at ?? null,
      attempt: submission?.attempt ?? null,
      late: Boolean(submission?.late),
    },
  };
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
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
  };
  return map[String(ext).toLowerCase()] ?? 'application/octet-stream';
}
