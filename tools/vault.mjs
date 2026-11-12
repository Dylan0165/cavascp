#!/usr/bin/env node
/**
 * De vault bouwen.
 *
 * Een Obsidian-vault is een map met markdown. Deze generator zet de structuur
 * neer die bij dit project hoort: per beoordelingscriterium een notitie met de
 * rubric er al in, de twee collecties van de minor, en een logboek.
 *
 * WAT HET NIET DOET
 *
 * Bestaande notities niet overschrijven. Wat je zelf schrijft blijft staan;
 * met --force wordt alles opnieuw gemaakt (en dat zeg ik van tevoren).
 *
 *   node tools/vault.mjs             # maakt wat ontbreekt
 *   node tools/vault.mjs --force     # overschrijft alles
 *   node tools/vault.mjs --status    # laat zien wat er staat
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HIER, '..', 'vault');

const force = process.argv.includes('--force');
const alleenStatus = process.argv.includes('--status');

/* ────────────────────────────── inhoud ─────────────────────────────────── */

const CRITERIA = [
  {
    nr: '01',
    naam: 'Responsible AI for Society',
    rubric:
      'You analyse the context and sustainable impact of AI solutions from multiple perspectives, taking into account data legislation and the (possible) impacts on society, and reflect on your own choices.',
    let: [
      'Welke wet- en regelgeving raakt jullie oplossing (AVG, AI Act)?',
      'Wie heeft er last van als dit systeem fout zit, en wie heeft er voordeel van?',
      'Welke keuze heb je zelf gemaakt en waarom — en wat had je ook kunnen doen?',
    ],
  },
  {
    nr: '02',
    naam: 'Data & Knowledge Stewardship',
    rubric:
      'You take responsibility for and ownership of data quality by sourcing, analysing, preparing and visualising data based on validated data quality standards.',
    let: [
      'Waar komt de data vandaan en mag je die gebruiken?',
      'Hoe controleer je de kwaliteit (volledigheid, dubbelen, versheid)?',
      'Laat zien hoe je data hebt opgeschoond en waarom op die manier.',
    ],
  },
  {
    nr: '03',
    naam: 'Model Interaction & Adaptation',
    rubric:
      'You develop, validate, and integrate AI solutions following a structured development process, ensuring that the solution meets requirements regarding security, privacy, ethics, and compliance.',
    let: [
      'Welke stappen heb je doorlopen van idee tot werkend onderdeel?',
      'Hoe heb je getest dat het werkt — en wat deed het niet?',
      'Welke eisen op het gebied van privacy en veiligheid heb je ingebouwd?',
    ],
  },
  {
    nr: '04',
    naam: 'Professional Standard',
    rubric:
      'Both individually and in teams, you apply a relevant methodological approach used in the professional field to formulate project goals, involve stakeholders, conduct applied research, provide advice, make decisions, and deliver reports. In doing so, you keep in view the relevant ethical, intercultural, and sustainable aspects.',
    let: [
      'Welke methode gebruik je (design thinking, Scrum, DOT)? En waarom die?',
      'Wie zijn de stakeholders en hoe heb je ze betrokken?',
      'Welk advies heb je gegeven en waar is dat op gebaseerd?',
    ],
  },
  {
    nr: '05',
    naam: 'Personal Leadership',
    rubric:
      'You are aware of your own strengths and weaknesses, both in the field of AI and in your personal development. You choose actions in line with your core values to promote your personal growth and develop your learning attitude.',
    let: [
      'Waar ben je goed in, en waar loop je tegenaan?',
      'Welke keuze heb je gemaakt die bij je waarden past?',
      'Wat heb je geleerd en wat ga je anders doen?',
    ],
  },
  {
    nr: '06',
    naam: 'AI-Augmented Learning',
    rubric:
      'You use conversational AI to learn, plan, critique, and reflect. You set boundaries, cite AI contributions, and demonstrate growth over time.',
    let: [
      'Waar heb je AI gebruikt om te leren of te plannen?',
      'Waar heb je bewust een grens getrokken?',
      'Hoe vermeld je wat AI deed en wat jij deed?',
    ],
  },
];

const kop = (titel) => `---\n${titel}\n---\n`;

function criteriumNotitie(criterium) {
  return `${kop(`criterium: ${criterium.naam}\nvolgorde: ${criterium.nr}\nstatus: open\ntags:\n  - portfolio\n  - criterium`)}
# ${criterium.naam}

> [!quote] Rubric — Advanced (4 pt)
> ${criterium.rubric}

## Waar het over gaat
<!-- Schrijf hier in je eigen woorden wat dit criterium van je vraagt. -->

## Bewijs
Link hier je bewijsstukken met een wikilink, en zeg in één zin wat ze laten zien.

- [ ] bewijs 1 —
- [ ] bewijs 2 —

## Reflectie
${criterium.let.map((vraag) => `- ${vraag}`).join('\n')}

## Feedback
<!-- Wat zei de docent hierover tijdens de vorige review? -->

## Status
- [ ] bewijs verzameld
- [ ] reflectie geschreven
- [ ] nagelezen door iemand anders
`;
}

const ikEnDeMinor = `${kop('collectie: ik en de minor\ntags:\n  - portfolio\n  - collectie')}
# Ik en de minor

> [!info] Waar dit voor is
> Tweede review — V-OL-MAIFS. Deadline 13 november 2026, 22:59.
> In Portflow, collectie **"ik en de minor"**.

## Studieachtergrond
Ik doe HBO-ICT aan Fontys Hogeschool ICT in Tilburg. Binnen de opleiding koos ik
de richting IT-infrastructuur en cybersecurity.
<!-- Vul aan: welke projecten, welke vakken, wat je al kon voordat je hier begon. -->

## Waarom deze minor
<!-- Waarom koos je de minor AI? Wat hoopte je te leren? Wees concreet: niet
     "ik vind AI interessant" maar wat je wilde begrijpen of kunnen. -->

## Thema's die me interesseren
<!-- Kies er twee of drie en leg uit waarom die. Voorbeelden om op te reageren:
     AI en ethiek, modellen begrijpen, data-kwaliteit, automatisering,
     security van AI-systemen. -->

## Wat ik tot nu toe geleerd heb
<!-- Reflectie op de afgelopen periode. Wat wist je niet en nu wel? Wat viel
     tegen? Waar ben je anders over gaan denken? -->

## Nieuwe ideeën over AI
<!-- Is je beeld van AI veranderd? Wat zie je nu anders? -->

## Mogelijkheden voor mijn eigen vakgebied
<!-- Infrastructuur, security en automatisering: waar raakt AI dat? Denk aan
     monitoring, detectie, beheer, kosten. -->

## Onderwerpen die me het meest liggen
<!-- En waarom. Dit mag kort zijn, als het maar specifiek is. -->

## Bewijs
- [[Portfolio/Criteria/06 AI-Augmented Learning|AI-Augmented Learning]]
`;

const klantproject = `${kop('collectie: klantproject\ntags:\n  - portfolio\n  - klantproject')}
# Klantproject

> [!info] Waar dit voor is
> Tweede review — V-OL-MAIFS. Deadline 13 november 2026, 22:59.
> In Portflow, collectie **"Klantproject"**.

## Introductie en doel
<!-- Wat is het project, voor welke klant, en wat moet het opleveren? -->

## De richting die we kozen
<!-- Welke richting heeft de groep gekozen en waarom die en niet een andere? -->

## Aanpak: de stappen tot dusver
<!-- Chronologisch. Per stap: wat deden jullie, wat kwam eruit, wat was jouw
     aandeel? Verwijs met @ naar je bewijsstukken in Portflow. -->

| Wanneer | Stap | Mijn bijdrage | Bewijs |
|---|---|---|---|
|  |  |  |  |

## Tussentijdse conclusies
<!-- Wat weet je nu, halverwege? Wat moet er nog gebeuren? -->

## Posterpresentatie
<!-- Verwijs naar je poster en zeg in één zin wat de kern is. -->

## Bewijs per leeruitkomst
- [[Portfolio/Criteria/01 Responsible AI for Society|Responsible AI for Society]]
- [[Portfolio/Criteria/02 Data & Knowledge Stewardship|Data & Knowledge Stewardship]]
- [[Portfolio/Criteria/03 Model Interaction & Adaptation|Model Interaction & Adaptation]]
- [[Portfolio/Criteria/04 Professional Standard|Professional Standard]]
- [[Portfolio/Criteria/05 Personal Leadership|Personal Leadership]]
- [[Portfolio/Criteria/06 AI-Augmented Learning|AI-Augmented Learning]]
`;

const startHier = `---
tags:
  - index
---
# Start hier

Dit is de vault van Dylan. Het is een map met markdown-bestanden — niets meer,
niets minder. Alles wat je hier schrijft kun je ook lezen zonder Obsidian.

## Waar staat wat

| Map | Wat |
|---|---|
| [[Portfolio/Ik en de minor]] | De collectie voor de tweede review |
| [[Portfolio/Klantproject]] | Het verslag van het klantproject |
| \`Portfolio/Criteria/\` | Eén notitie per beoordelingscriterium, met de rubric erin |
| \`Logboek/\` | Wat je per dag deed. Handig voor je reflectie achteraf |
| \`99 Sjablonen/\` | Sjablonen voor nieuwe notities |

## Wat er morgen af moet
- [ ] [[Portfolio/Ik en de minor]] afmaken
- [ ] [[Portfolio/Klantproject]] afmaken
- [ ] Bewijs per criterium linken in Portflow (met @)
- [ ] Snapshot maken en inleveren

## Cijfers

\`\`\`dataview
TABLE status, length(file.inlinks) AS "keer gelinkt"
FROM "Portfolio/Criteria"
SORT volgorde ASC
\`\`\`

## Openstaande taken

\`\`\`tasks
not done
path includes Portfolio
sort by due
\`\`\`
`;

const sjabloonCriterium = `${kop('tags: [sjabloon]')}
# {{title}}

> [!quote] Rubric
>

## Bewijs
- [ ]

## Reflectie

## Feedback
`;

const sjabloonLogboek = `${kop('tags: [logboek]')}
# {{date:YYYY-MM-DD}}

## Gedaan

## Geleerd

## Morgen
- [ ]
`;

/* ────────────────────────────── schrijven ──────────────────────────────── */

function schrijf(relatief, inhoud) {
  const doel = path.join(VAULT, relatief);
  mkdirSync(path.dirname(doel), { recursive: true });

  if (existsSync(doel) && !force) {
    console.log(`  ·  ${relatief} (bestaat al, overgeslagen)`);
    return;
  }

  writeFileSync(doel, inhoud, 'utf8');
  console.log(`  +  ${relatief}`);
}

function status() {
  if (!existsSync(VAULT)) {
    console.log('  De vault bestaat nog niet. Draai: node tools/vault.mjs');
    return;
  }

  const notities = [];
  const loop = (map) => {
    for (const naam of readdirSync(map)) {
      const pad = path.join(map, naam);
      if (statSync(pad).isDirectory()) loop(pad);
      else if (naam.endsWith('.md')) notities.push(path.relative(VAULT, pad));
    }
  };
  loop(VAULT);

  const plugins = existsSync(path.join(VAULT, '.obsidian', 'plugins'))
    ? readdirSync(path.join(VAULT, '.obsidian', 'plugins'))
    : [];

  console.log(`\n  Vault: ${VAULT}`);
  console.log(`  ${notities.length} notities · ${plugins.length} plugins\n`);
  for (const notitie of notities.sort()) console.log(`     ${notitie}`);
  console.log('');
}

/* ─────────────────────────────── uitvoeren ─────────────────────────────── */

if (alleenStatus) {
  status();
  process.exit(0);
}

console.log(`\n  Vault bouwen in ${VAULT}${force ? ' (alles opnieuw)' : ''}\n`);

mkdirSync(VAULT, { recursive: true });

for (const criterium of CRITERIA) {
  schrijf(`Portfolio/Criteria/${criterium.nr} ${criterium.naam}.md`, criteriumNotitie(criterium));
}

schrijf('Portfolio/Ik en de minor.md', ikEnDeMinor);
schrijf('Portfolio/Klantproject.md', klantproject);
schrijf('00 Start hier.md', startHier);
schrijf('99 Sjablonen/criterium.md', sjabloonCriterium);
schrijf('99 Sjablonen/logboek.md', sjabloonLogboek);

console.log('\n  Klaar. Open de map in Obsidian: "Open folder as vault".\n');
