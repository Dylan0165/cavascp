#!/usr/bin/env node
/** Isolate why submission state comes back as "unsubmitted" for everything. */

import { createCanvas, loadEnvFile } from './lib/canvas.mjs';

const env = await loadEnvFile('D:/cavascp/.env');
const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });

const COURSE = 15973; // V-OL-MAIFS — has "Eerste portfolio" submitted

console.log('--- 1) URLSearchParams encoding of student_ids ---');
const p = new URLSearchParams();
p.append('student_ids', 'self');
p.append('per_page', '100');
console.log('    ' + p.toString());

console.log('\n--- 2) submissions via plain query object ---');
let a;
try {
  a = await canvas.get(`/api/v1/courses/${COURSE}/students/submissions`, {
    student_ids: 'self',
    per_page: 100,
  });
  console.log(`    type=${Array.isArray(a) ? 'array' : typeof a} len=${Array.isArray(a) ? a.length : '?'}`);
  if (Array.isArray(a)) {
    for (const s of a.slice(0, 4)) {
      console.log(`      asg=${s.assignment_id} state=${s.workflow_state} submitted=${s.submitted_at}`);
    }
  }
} catch (error) {
  console.log(`    FOUT: ${error.message}`);
}

console.log('\n--- 3) submissions via array form (what the server uses) ---');
let b;
try {
  b = await canvas.get(`/api/v1/courses/${COURSE}/students/submissions`, {
    student_ids: ['self'],
    per_page: 100,
  });
  console.log(`    type=${Array.isArray(b) ? 'array' : typeof b} len=${Array.isArray(b) ? b.length : '?'}`);
  if (Array.isArray(b)) {
    for (const s of b.slice(0, 4)) {
      console.log(`      asg=${s.assignment_id} state=${s.workflow_state} submitted=${s.submitted_at}`);
    }
  }
} catch (error) {
  console.log(`    FOUT: ${error.message}`);
}

console.log('\n--- 4) with include[] (what probe_evidence used) ---');
let c;
try {
  c = await canvas.get(`/api/v1/courses/${COURSE}/students/submissions`, {
    student_ids: ['self'],
    per_page: 100,
    'include[]': ['assignment'],
  });
  console.log(`    type=${Array.isArray(c) ? 'array' : typeof c} len=${Array.isArray(c) ? c.length : '?'}`);
  if (Array.isArray(c)) {
    for (const s of c.slice(0, 4)) {
      console.log(`      asg=${s.assignment_id} state=${s.workflow_state} submitted=${s.submitted_at}`);
    }
  }
} catch (error) {
  console.log(`    FOUT: ${error.message}`);
}

console.log('\n--- 5) raw fetch, exactly as the server builds it ---');
const url = `https://fhict.instructure.com/api/v1/courses/${COURSE}/students/submissions?student_ids=self&per_page=100`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${env.CANVAS_TOKEN}`, Accept: 'application/json' },
});
const text = await res.text();
console.log(`    status=${res.status} bytes=${text.length}`);
console.log(`    first 300: ${text.slice(0, 300)}`);

console.log('\n--- 6) raw fetch with student_ids[]=self ---');
const url2 = `https://fhict.instructure.com/api/v1/courses/${COURSE}/students/submissions?student_ids%5B%5D=self&per_page=100`;
const res2 = await fetch(url2, {
  headers: { Authorization: `Bearer ${env.CANVAS_TOKEN}`, Accept: 'application/json' },
});
const text2 = await res2.text();
console.log(`    status=${res2.status} bytes=${text2.length}`);
try {
  const parsed = JSON.parse(text2);
  if (Array.isArray(parsed)) {
    for (const s of parsed.slice(0, 6)) {
      console.log(`      asg=${s.assignment_id} state=${s.workflow_state} submitted=${s.submitted_at}`);
    }
  } else {
    console.log(`    ${text2.slice(0, 200)}`);
  }
} catch {
  console.log(`    ${text2.slice(0, 200)}`);
}
