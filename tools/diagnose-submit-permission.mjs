#!/usr/bin/env node
/**
 * Mag dit account überhaupt inleveren?
 *
 * De upload werkt, maar POST /submissions geeft 403 "user not authorized".
 * Dat kan twee dingen betekenen:
 *   a. de opdracht is gesloten (inleverperiode voorbij) — dan is het logisch
 *   b. het account mist de bevoegdheid — dan kan geen enkele inleverknop werken
 *
 * Dit script probeert het op meerdere opdrachten, waaronder één die nog open is,
 * en kijkt naar de kenmerken die Canvas zelf teruggeeft (lock, grading period,
 * pogingen). Er wordt alleen geprobeerd; mislukken is een geldige uitkomst.
 */

import { loadEnvFile, createCanvas } from '../mcp/lib/canvas.mjs';
import { ENV_PAD } from '../mcp/lib/paden.mjs';

const env = await loadEnvFile(ENV_PAD);
const canvas = createCanvas({ baseUrl: env.CANVAS_BASE_URL, token: env.CANVAS_TOKEN });

const me = await canvas.get('/api/v1/users/self');
console.log(`account: ${me?.name} (id ${me?.id})`);
console.log('');

const kandidaten = [
  { course: 14094, assignment: 244979, label: 'OUD · "Deze inleveropdracht niet gebruiken."', magTesten: true },
  { course: 15973, assignment: 278562, label: 'NU · V-OL-MAIFS portfolio review', magTesten: false },
  { course: 15833, assignment: 276310, label: 'NU · INTERN5 portfolio review', magTesten: false },
];

for (const k of kandidaten) {
  console.log('='.repeat(76));
  console.log(`${k.label}  (${k.course}/${k.assignment})`);
  console.log('='.repeat(76));

  let info = null;
  try {
    info = await canvas.get(`/api/v1/courses/${k.course}/assignments/${k.assignment}`, {
      'include[]': ['submission'],
    });
    console.log(`  naam            : ${info?.name}`);
    console.log(`  inlevervormen   : ${(info?.submission_types ?? []).join(', ')}`);
    console.log(`  pogingen        : ${info?.allowed_attempts}`);
    console.log(`  locked_for_user : ${info?.locked_for_user}`);
    console.log(`  unlock_at       : ${info?.unlock_at ?? '—'}`);
    console.log(`  lock_at         : ${info?.lock_at ?? '—'}`);
    console.log(`  due_at          : ${info?.due_at ?? '—'}`);
    console.log(`  in_closed_period: ${info?.in_closed_grading_period ?? '—'}`);
    console.log(`  state           : ${info?.submission?.workflow_state ?? '?'}`);
    if (info?.lock_explanation) console.log(`  uitleg slot     : ${String(info.lock_explanation).slice(0, 120)}`);
  } catch (error) {
    console.log(`  opdrachtinfo mislukt: ${error.message.slice(0, 120)}`);
  }

  /* De daadwerkelijke poging. We doen dit ALLEEN op een opdracht die zich
     er zelf voor leent, nooit op echt werk: een geslaagde test schrijft een
     inlevering weg, en die wil je niet in je portfolio hebben. */
  if (!k.magTesten) {
    console.log('  INLEVEREN       : overgeslagen (dit is echt werk van je)');
    console.log('');
    continue;
  }

  try {
    const result = await canvas.post(`/api/v1/courses/${k.course}/assignments/${k.assignment}/submissions`, {
      submission_type: 'online_text_entry',
      body: 'cavascp bevoegdheidstest',
    });
    console.log(`  INLEVEREN       : GELUKT — status ${result?.workflow_state}, poging ${result?.attempt}`);
    if (result?.id) {
      console.log(`  (testinlevering id ${result.id}; je kunt hem in Canvas verwijderen)`);
    }
  } catch (error) {
    const msg = error.message.replace(/^Canvas gaf \d+ op POST [^:]+:\s*/, '');
    console.log(`  INLEVEREN       : geweigerd → ${msg.slice(0, 110)}`);
  }

  console.log('');
}
