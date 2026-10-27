#!/usr/bin/env node
/**
 * Welke bestandstypes accepteert Portflow?
 *
 * Dit bepaalt of een Word-document direct naar Portflow kan of eerst omgezet
 * moet worden. Krava maakt .docx en .pptx; Portflow kan daar strenger in zijn.
 *
 * We vragen alleen een uploadplek aan (stap 1 van de driestaps-upload). Dat is
 * goedkoop: Portflow antwoordt met een signed_id en upload-URL, of weigert.
 * Er wordt niets geüpload en niets aangemaakt.
 *
 *   node probe-portflow-types.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { Portflow } from './portflow.mjs';

const { chromium } = await import(CONFIG.playwrightUrl);
const OUT = path.resolve('out');
await mkdir(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(CONFIG.profileDir, {
  ...(CONFIG.chromePath ? { executablePath: CONFIG.chromePath } : {}),
  headless: true,
  viewport: CONFIG.viewport,
  userAgent: CONFIG.userAgent,
  locale: 'nl-NL',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = context.pages()[0] ?? (await context.newPage());
const pf = new Portflow(page);

const TYPES = [
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 24000],
  ['pdf', 'application/pdf', 90000],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 22000],
  ['doc', 'application/msword', 24000],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 12000],
  ['png', 'image/png', 40000],
  ['jpg', 'image/jpeg', 40000],
  ['txt', 'text/plain', 500],
  ['md', 'text/markdown', 500],
  ['zip', 'application/zip', 40000],
  ['mp4', 'video/mp4', 4000000],
  ['link', 'text/uri-list', 40],
];

try {
  await pf.connect();
  console.log(`verbonden: portfolio ${pf.portfolioId}`);
  console.log('');
  console.log('Uploadplek aanvragen per bestandstype (er wordt niets geüpload):');
  console.log('');

  const uitkomsten = [];
  for (const [ext, mime, grootte] of TYPES) {
    const { createHash } = await import('node:crypto');
    // Een neppe checksum is genoeg: Portflow controleert die pas bij de upload.
    const checksum = createHash('md5').update(`probe-${ext}`).digest('base64');
    const res = await pf.call('POST', '/api/v1/direct-uploads', {
      blob: { filename: `probe.${ext}`, content_type: mime, byte_size: grootte, checksum },
    });

    const ok = res.status === 200 || res.status === 201;
    const heeftUrl = Boolean(res.data?.direct_upload?.url);
    const detail = ok && heeftUrl ? 'toegestaan' : JSON.stringify(res.data ?? res.textPreview).slice(0, 90);
    uitkomsten.push({ ext, status: res.status, ok: ok && heeftUrl, detail });
    console.log(`  ${ok && heeftUrl ? 'JA ' : 'NEE'}  .${ext.padEnd(5)} [${res.status}] ${detail}`);
  }

  const ja = uitkomsten.filter((u) => u.ok).map((u) => u.ext);
  const nee = uitkomsten.filter((u) => !u.ok).map((u) => u.ext);
  console.log('');
  console.log('─'.repeat(66));
  console.log(`  toegestaan : ${ja.join(', ') || '—'}`);
  console.log(`  geweigerd  : ${nee.join(', ') || '—'}`);
  console.log('─'.repeat(66));
  console.log('');
  if (ja.includes('docx')) {
    console.log('  Een Word-document kan rechtstreeks naar Portflow.');
  } else {
    console.log('  Let op: .docx kan NIET rechtstreeks. Er is een omzetting nodig.');
  }

  await writeFile(
    path.join(OUT, 'portflow-types.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), uitkomsten }, null, 2),
    'utf8',
  );
} catch (error) {
  console.error(`FOUT: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
