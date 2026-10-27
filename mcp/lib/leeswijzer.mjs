/**
 * De leeswijzer per map.
 *
 * Een leeswijzer is geen lap tekst. Hij moet een docent in dertig seconden
 * laten zien waar hij moet kijken — en vooral: wat er nog niet is.
 *
 * De opbouw:
 *
 *   Wat zit hier          per bewijsstuk: naam, datum, en wat het is
 *   Welke leeruitkomsten  per LO: welk bewijs het aantoont
 *   Hoe te lezen          welke stukken het belangrijkst zijn
 *   Wat er nog niet is    eerlijk: welke leeruitkomst geen bewijs heeft
 *
 * DAT LAATSTE IS HET BELANGRIJKSTE.
 *
 * Een leeswijzer die doet alsof alles gedekt is, werkt tegen je. Een docent die
 * er zelf achter komt dat een leeruitkomst leeg is, is strenger dan een docent
 * die het van tevoren leest. Dus zegt de generator wat er mist.
 *
 * De uitvoer is Markdown met `##`-koppen, zodat hij door de documentgenerator
 * naar Word gaat en er een inhoudsopgave bij komt.
 */

import { LEERUITKOMSTEN, portflowGoalIdVoor, semesterMappen } from './leeruitkomsten.mjs';

const MAANDEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

/** "8 oktober 2026" — want dat leest prettiger dan 2026-10-08. */
export function nlDatum(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MAANDEN[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Welke leeruitkomst hoort bij dit Portflow-doel-id?
 *
 * Dit gaat via de vastgelegde koppeling, niet via de naam. "Professional
 * Standard" bestaat vier keer in Portflow; op naam zoeken pakt het verkeerde
 * semester.
 */
export function leeruitkomstVoorGoalId(goalId) {
  for (const lo of LEERUITKOMSTEN) {
    if (portflowGoalIdVoor(lo.code) === Number(goalId)) return lo;
  }
  return null;
}

/**
 * Bouwt de leeswijzer voor één map.
 *
 * @param {object} invoer
 * @param {string} invoer.mapNaam         de naam van de map
 * @param {number} invoer.mapId           het Portflow-id
 * @param {object[]} invoer.bewijs        [{ id, naam, gemaakt, goalIds, beschrijving }]
 * @param {string} [invoer.inleiding]     eigen tekst die bovenaan komt
 * @param {string} [invoer.documentTitel] voor de kop
 * @returns {{markdown: string, statistiek: object, ontbrekend: string[]}}
 */
export function maakLeeswijzer({
  mapNaam = 'deze map',
  mapId = null,
  bewijs = [],
  inleiding = '',
  documentTitel = null,
  auteur = '',
  vak = '',
} = {}) {
  const titel = documentTitel ?? `Leeswijzer — ${mapNaam}`;
  const regels = [];

  /* ── Kop ─────────────────────────────────────────────────────────────── */

  regels.push(`# ${titel}`);
  regels.push('');
  if (vak) regels.push(`**Vak:** ${vak}  `);
  if (auteur) regels.push(`**Auteur:** ${auteur}  `);
  regels.push(`**Map:** ${mapNaam}${mapId ? ` (Portflow ${mapId})` : ''}  `);
  regels.push(`**Bijgewerkt:** ${nlDatum(new Date().toISOString())}`);
  regels.push('');
  regels.push(
    inleiding ||
      'Deze leeswijzer beschrijft wat er in deze map staat, welke leeruitkomsten het bewijs ' +
        'aantoont, en hoe u het snel kunt lezen. Onderaan staat wat er nog niet is.',
  );
  regels.push('');

  /* ── Wat zit hier ────────────────────────────────────────────────────── */

  regels.push('## Wat zit hier');
  regels.push('');

  if (!bewijs.length) {
    regels.push('_Deze map is nog leeg. Er zit nog geen bewijsstuk in._');
    regels.push('');
  } else {
    regels.push(`${bewijs.length} bewijsstuk${bewijs.length === 1 ? '' : 'ken'}, nieuwste eerst:`);
    regels.push('');
    const gesorteerd = [...bewijs].sort((a, b) => String(b.gemaakt ?? '').localeCompare(String(a.gemaakt ?? '')));
    for (const stuk of gesorteerd) {
      const datum = nlDatum(stuk.gemaakt);
      const delen = [`**${stuk.naam ?? `bewijs ${stuk.id}`}**`];
      if (datum) delen.push(`(${datum})`);
      regels.push(`- ${delen.join(' ')}`);
      if (stuk.beschrijving) {
        regels.push(`  ${String(stuk.beschrijving).replace(/\s+/g, ' ').trim()}`);
      }
    }
    regels.push('');
  }

  /* ── Welke leeruitkomsten ────────────────────────────────────────────── */

  regels.push('## Welke leeruitkomsten dekt dit');
  regels.push('');

  /*
   * Per leeruitkomst: welk bewijs hangt eraan? Dit is het hart van de
   * leeswijzer. Een leeruitkomst zonder bewijs komt er ook in te staan, met
   * "nog geen bewijs" — dat is informatie die de docent moet hebben.
   */
  const perLo = new Map();
  for (const lo of LEERUITKOMSTEN) perLo.set(lo.code, []);

  for (const stuk of bewijs) {
    for (const goalId of stuk.goalIds ?? []) {
      const lo = leeruitkomstVoorGoalId(goalId);
      if (!lo) continue;
      perLo.get(lo.code).push(stuk);
    }
  }

  const gedekt = [];
  const ontbrekend = [];

  for (const lo of LEERUITKOMSTEN) {
    const stukken = perLo.get(lo.code);
    if (stukken.length) {
      gedekt.push(lo.code);
      regels.push(`### ${lo.code} — ${lo.naam}`);
      regels.push('');
      regels.push(`Bewijs in deze map: ${stukken.length} stuk${stukken.length === 1 ? '' : 'ken'}.`);
      regels.push('');
      for (const s of stukken) {
        regels.push(`- ${s.naam ?? `bewijs ${s.id}`}${s.gemaakt ? ` — ${nlDatum(s.gemaakt)}` : ''}`);
      }
      regels.push('');
      regels.push(`_Waar deze leeruitkomst over gaat:_ ${lo.beschrijving}`);
      regels.push('');
    } else {
      ontbrekend.push(lo.code);
    }
  }

  /* ── Hoe te lezen ────────────────────────────────────────────────────── */

  regels.push('## Hoe dit te lezen');
  regels.push('');

  if (!bewijs.length) {
    regels.push('Er is nog niets te lezen in deze map.');
  } else {
    /*
     * Een suggestie welke stukken het eerst te bekijken zijn: de stukken die de
     * MEESTE leeruitkomsten dekken, want die zeggen het meest in één keer.
     */
    const metAantal = bewijs
      .map((s) => ({ ...s, aantal: (s.goalIds ?? []).filter((g) => leeruitkomstVoorGoalId(g)).length }))
      .sort((a, b) => b.aantal - a.aantal);

    const kern = metAantal.filter((s) => s.aantal >= 2).slice(0, 3);
    if (kern.length) {
      regels.push('Begin bij deze stukken; ze dekken meerdere leeruitkomsten tegelijk:');
      regels.push('');
      for (const s of kern) {
        const los = (s.goalIds ?? [])
          .map((g) => leeruitkomstVoorGoalId(g)?.code)
          .filter(Boolean)
          .join(', ');
        regels.push(`- **${s.naam}** — dekt ${los}`);
      }
      regels.push('');
    } else {
      regels.push('Elk stuk dekt één leeruitkomst. Ze staan hierboven per leeruitkomst gegroepeerd.');
      regels.push('');
    }

    regels.push(
      'De stukken staan per leeruitkomst gegroepeerd, niet op datum. Zo ziet u per ' +
        'leeruitkomst meteen welk bewijs er is.',
    );
  }
  regels.push('');

  /* ── Wat er nog niet is ──────────────────────────────────────────────── */

  regels.push('## Wat er nog niet is');
  regels.push('');

  if (!ontbrekend.length) {
    regels.push('Alle zes leeruitkomsten hebben bewijs in deze map.');
  } else {
    regels.push(
      `Deze leeruitkomst${ontbrekend.length === 1 ? ' heeft' : 'en hebben'} nog geen bewijs in deze map:`,
    );
    regels.push('');
    for (const code of ontbrekend) {
      const lo = LEERUITKOMSTEN.find((l) => l.code === code);
      regels.push(`- **${lo.code} ${lo.naam}**`);
    }
    regels.push('');
    regels.push(
      'Dit staat er bewust in. Beter dat u het hier leest dan dat u er tijdens de ' +
        'beoordeling achter komt.',
    );
  }
  regels.push('');

  /* ── Statistiek ──────────────────────────────────────────────────────── */

  const statistiek = {
    map: mapNaam,
    mapId,
    bewijsstukken: bewijs.length,
    gedekt: gedekt.length,
    ontbrekend: ontbrekend.length,
    perLeeruitkomst: Object.fromEntries(
      LEERUITKOMSTEN.map((lo) => [lo.code, perLo.get(lo.code).length]),
    ),
    zonderDoel: bewijs.filter((s) => !(s.goalIds ?? []).length).length,
    zonderBeschrijving: bewijs.filter((s) => !s.beschrijving).length,
  };

  return { markdown: regels.join('\n'), statistiek, ontbrekend, gedekt };
}

/**
 * Zet een leeswijzer om naar een document dat de generator begrijpt.
 *
 * De Markdown gaat naar `plan.secties[].tekst`; de generator zet dat om naar
 * koppen, lijsten en alinea's.
 */
export function leeswijzerAlsDocument({ markdown, titel, auteur = '', vak = '' }) {
  const nu = new Date().toISOString();
  return {
    titel,
    subtitel: 'Wat er in deze map staat en welke leeruitkomsten het aantoont',
    auteur,
    instelling: 'Fontys Hogeschool ICT',
    vak,
    datum: nu.slice(0, 10),
    versie: '1.0',
    documenttype: 'leeswijzer',
    brief: 'Leeswijzer bij het portfolio: wat er in de map staat, welke leeruitkomsten het dekt, en wat er nog mist.',
    // Eén sectie: de Markdown bevat al de koppen.
    plan: {
      titel,
      ondertitel: '',
      secties: [
        {
          id: 'leeswijzer',
          titel,
          niveau: 1,
          tekst: markdown,
          subsecties: [],
          status: 'klaar',
        },
      ],
    },
    // De koppen in de Markdown beginnen bij #, dus de sectiekop zou dubbel
    // komen. De generator haalt een kop die de sectietitel herhaalt eruit.
    bronnen: [],
    inleveringen: [],
    aangemaakt: nu,
    bijgewerkt: nu,
  };
}

/** De mappen van dit semester, met hun naam. */
export { semesterMappen };

/**
 * Bouwt in één keer leeswijzers voor alle mappen van dit semester.
 *
 * @param {object} pf            de Portflow-brug
 * @param {object} [opties]
 * @param {(msg: string) => void} [opties.log]
 */
export async function leeswijzersVoorSemester(pf, { log = () => {} } = {}) {
  const mappen = semesterMappen();
  const uit = [];

  for (const map of mappen) {
    log(`${map.naam}: bewijs ophalen…`);
    let bewijs = [];
    try {
      bewijs = await pf.evidenceForFreeze(map.portflowCollectionId);
    } catch (error) {
      log(`  mislukt: ${error.message}`);
      uit.push({ map, fout: error.message, leeswijzer: null });
      continue;
    }

    /* De beschrijving per bewijsstuk ophalen, zodat de leeswijzer die kan tonen. */
    for (const stuk of bewijs) {
      try {
        const detail = await pf.call('GET', `/api/v1/portfolios/${pf.portfolioId}/evidence/${stuk.id}`);
        if (detail.ok) {
          stuk.beschrijving = detail.data?.description ?? null;
          stuk.gemaakt = detail.data?.created_at ?? null;
          stuk.naam = detail.data?.name ?? stuk.naam;
        }
      } catch {
        /* zonder beschrijving werkt de leeswijzer ook */
      }
    }

    const resultaat = maakLeeswijzer({
      mapNaam: map.naam,
      mapId: map.portflowCollectionId,
      bewijs,
    });

    log(
      `  ${bewijs.length} bewijsstukken, ${resultaat.gedekt.length} leeruitkomsten gedekt` +
        (resultaat.ontbrekend.length ? `, ${resultaat.ontbrekend.length} nog leeg` : ''),
    );

    uit.push({ map, leeswijzer: resultaat, bewijs });
  }

  return uit;
}
