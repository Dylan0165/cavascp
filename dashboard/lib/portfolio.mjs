/**
 * De catalogus voor de portfolio-pagina.
 *
 * Eén plek die zegt: welk document hoort bij welke collectie, welke beschrijving
 * hoort erbij, en welke leeruitkomst het aantoont. De teksten zelf staan in de
 * vault; hier staan alleen de verwijzingen, zodat er niet twee versies ontstaan.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { inProject } from '../../mcp/lib/paden.mjs';

const VAULT = () => inProject('vault');

/** Een notitie uit de vault lezen, zonder frontmatter en zonder de uitleg-callout. */
export function leesNotitie(relatief) {
  const pad = path.join(VAULT(), relatief);
  if (!existsSync(pad)) return null;

  let tekst = readFileSync(pad, 'utf8');

  // Frontmatter eraf, en de titel eraf: die gebruik je in Portflow niet.
  tekst = tekst
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^>\s*\[!info\][\s\S]*?(?=\n\n)/m, '')
    // Na de frontmatter staat vaak nog een lege regel; die moet eerst weg,
    // anders blijft de titel bovenaan de Portflow-tekst staan.
    .replace(/\s*$/, '')
    .replace(/^\s*#\s+.*\n/, '');

  /*
   * Portflow is een tekstveld, geen markdown. Dus:
   *   - koppen worden een regel met een dubbele punt erachter
   *   - vetverdeling en code-markering verdwijnen
   *   - wikilinks worden gewone woorden
   *   - en de regelafbrekingen van het markdown-bestand gaan eruit, anders
   *     staat er in Portflow een zinnenbreuk midden in een regel.
   */
  const blokken = tekst
    .split(/\n{2,}/)
    .map((blok) => {
      const regels = blok.split('\n').map((regel) => regel.trimEnd());
      const kop = /^#{1,6}\s+(.*)$/.exec(regels[0]);
      const isLijst = regels.every((regel) => /^([-*]|\d+\.)\s+/.test(regel) || regel === '');

      const opgeschoond = regels.map((regel) =>
        regel
          .replace(/^#{1,6}\s+/, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, eerste, tweede) => tweede ?? eerste)
          .replace(/`([^`]+)`/g, '$1'),
      );

      if (kop) return `${opgeschoond[0].replace(/:$/, '')}:`;
      if (isLijst) return opgeschoond.join('\n');

      // Gewone alinea: de harde regeleindes zijn alleen voor de leesbaarheid
      // van het markdown-bestand.
      return opgeschoond.join(' ').replace(/\s{2,}/g, ' ');
    })
    .filter((blok) => blok.trim());

  return blokken.join('\n\n').trim();
}

/** Bestandsgrootte in kB, of null als het bestand er niet is. */
function grote(relatief) {
  const pad = path.join(VAULT(), relatief);
  return existsSync(pad) ? Math.round(statSync(pad).size / 1024) : null;
}

/**
 * De drie collecties zoals ze in Portflow staan, met wat erin hoort.
 *
 * `bewijs` is wat de student zelf in Portflow heeft gezet. Niet elk daarvan
 * hebben wij op schijf: een zip die alleen in Portflow staat kun je hier wel
 * beschrijven, niet downloaden.
 */
export function portfolioCatalogus() {
  const collecties = [
    {
      id: 'orientatie',
      naam: 'orientatie',
      portflow: 'Collectie "orientatie" (in de opdracht: "ik en de minor")',
      leeswijzer: 'Portfolio/Leeswijzer orientatie.md',
      bewijs: [
        {
          titel: 'Flascards.zip',
          wat: 'Broncode van de quiz-webapp',
          bestand: null,
          beschrijving: `Dit is de broncode van Flascards, een quiz-webapp waarin een taalmodel de vragen genereert en de antwoorden controleert. Ik lever de zip in omdat de werking alleen te beoordelen is als je de code ziet: de opbouw van de prompt, het valideren van wat er terugkomt, en de afhandeling als het model iets onbruikbaars teruggeeft. In de zip staat een README die per bestand uitlegt wat het doet en hoe je de app start. Het bewijs hoort bij Model Interaction & Adaptation: ik heb het model niet alleen aangeroepen, maar ook getest en bijgestuurd op het moment dat de uitvoer niet klopte.`,
          leeruitkomst: 'Model Interaction & Adaptation',
        },
        {
          titel: 'RAG-verslag',
          wat: 'Onderzoek naar ophalen, genereren en meten',
          bestand: null,
          beschrijving: `Dit verslag beschrijft hoe ik bronnen heb opgehaald, hoe ik daar een antwoord uit heb laten genereren en hoe ik heb gemeten of dat antwoord op die bronnen gebaseerd was. Ik lever het in omdat het de onderbouwing is onder de keuzes die ik in de app heb gemaakt: welke documenten, welke chunkgrootte, welke prompt, en waarom. Er zit een ethische afweging in over welke data je wel en niet doorstuurt naar een model. Het bewijs hoort bij Data & Knowledge Stewardship en Responsible AI for Society.`,
          leeruitkomst: 'Data & Knowledge Stewardship, Responsible AI for Society',
        },
        {
          titel: 'Over AI-gebruik bij het RAG-verslag',
          wat: 'Toelichting op de samenwerking met het model',
          bestand: null,
          beschrijving: `Ik heb bij het schrijven van het verslag een taalmodel gebruikt om tussenversies te bekritiseren en om mijn eigen formuleringen scherper te krijgen. De opzet, de meting en de conclusies zijn van mij; het model heeft niet bedacht wat er in het verslag staat. Wat ik daarvan heb geleerd is dat je zo'n model het beste kunt inzetten als tegenlezer, niet als schrijver, en dat je dat achteraf moet kunnen laten zien. Dit is het bewijs bij AI-Augmented Learning.`,
          leeruitkomst: 'AI-Augmented Learning',
        },
        {
          titel: 'Slides posterpresentatie',
          wat: 'Presentatie van het werk',
          bestand: null,
          beschrijving: `De slides waarmee ik het werk heb gepresenteerd: de opzet van de app, de meting en de conclusie in het kort. Ze laten zien dat ik het werk aan een ander kan uitleggen zonder de code erbij te hebben.`,
          leeruitkomst: 'Professional Standard',
        },
      ],
      documenten: [
        { titel: 'Ik en de minor', md: 'Portfolio/Ik en de minor.md', docx: 'Portfolio/Ik en de minor.docx', wat: 'Achtergrond, motivatie en wat ik leerde' },
      ],
    },
    {
      id: 'klantproject',
      naam: 'klantproject',
      portflow: 'Collectie "klantproject"',
      leeswijzer: 'Portfolio/Leeswijzer klantproject.md',
      bewijs: [
        {
          titel: 'AI Editor (Studio040)',
          wat: 'De applicatie en de repository',
          bestand: null,
          beschrijving: `De redactietool die ik voor Studio040 heb gebouwd. Eén artikel gaat erin, vier kanalen komen eruit: een pushmelding, een langere tekst, een Engelse versie en een radioscript met tijdcodes. Ik lever de applicatie en de repository in omdat het eindproduct alleen te beoordelen is als je ziet hoe het is opgebouwd: de koppeling met het model, de manier waarop de tekst in blokken wordt geknipt, de zes controles op namen, bedragen en lengte, en de menselijke goedkeuring voordat er iets naar buiten gaat. Het bewijs hoort bij Professional Standard en Model Interaction & Adaptation.`,
          leeruitkomst: 'Professional Standard, Model Interaction & Adaptation',
        },
        {
          titel: 'AI-Editor-Presentatie-DylanSchuurman.pptx',
          wat: 'De presentatie van het project',
          bestand: 'Portfolio/bijlagen/AI-Editor-Presentatie-DylanSchuurman.pptx',
          beschrijving: `De presentatie waarmee ik het project heb toegelicht: het probleem, de oplossing, de architectuur, de afwegingen (Tauri in plaats van Electron, DeepSeek in plaats van een eigen model) en de cijfers van de demo. Ik lever hem in omdat hij laat zien dat ik het werk aan een niet-technische klant kan uitleggen zonder de code erbij te halen. Het bewijs hoort bij Professional Standard en bij Personal Leadership: in de presentatie staat ook de keuze om geen autopilot te bouwen.`,
          leeruitkomst: 'Professional Standard, Personal Leadership',
        },
        {
          titel: 'Reflectie Studio040',
          wat: 'Mijn reflectie op het klantproject',
          bestand: 'Portfolio/Reflectie Studio040.docx',
          beschrijving: `Mijn reflectie op het klantproject: wat ik bouwde, welke ontwerpkeuzes ik maakte, wat ik ervan leerde en wat ik de volgende keer anders doe. Ik lever hem in omdat de beoordeling niet alleen over het product gaat, maar ook over de vraag of ik kan uitleggen waarom ik het zo heb gedaan.`,
          leeruitkomst: 'Personal Leadership, AI-Augmented Learning',
        },
      ],
      documenten: [
        { titel: 'Klantproject (collectietekst)', md: 'Portfolio/Klantproject.md', docx: 'Portfolio/Klantproject.docx', wat: 'Opzet van het verslag, in te vullen met je eigen aandeel' },
      ],
    },
    {
      id: 'persoonlijk-project',
      naam: 'Persoonlijk project',
      portflow: 'Collectie "Persoonlijk project"',
      leeswijzer: 'Portfolio/Leeswijzer persoonlijk project.md',
      bewijs: [
        {
          titel: 'cavascp (repository en dashboard)',
          wat: 'Het project zelf',
          bestand: null,
          beschrijving: `cavascp is een koppeling met Canvas die bijhoudt welke portfolio-opdrachten open staan, welke criteria nog geen bewijs hebben en wat de deadlines zijn, met een dashboard dat ik dagelijks gebruik. Ik lever het in omdat het laat zien dat ik een systeem kan bouwen dat met een externe API werkt, met authenticatie, foutafhandeling en een bron die soms traag of stuk is. Ik heb het project zelf bedacht en afgebakend, en het grootste deel met AI als bouwpartner gemaakt, met de commit-geschiedenis als bewijs van het proces. Het bewijs hoort bij AI-Augmented Learning, Professional Standard en Personal Leadership.`,
          leeruitkomst: 'AI-Augmented Learning, Professional Standard, Personal Leadership',
        },
        {
          titel: 'Reflectie cavascp',
          wat: 'Mijn reflectie op het persoonlijke project',
          bestand: 'Portfolio/Reflectie cavascp.docx',
          beschrijving: `Mijn reflectie op cavascp: waarom ik het bouwde, de vier keuzes die het project bepalen, wat ik ervan leerde en wat ik de volgende keer anders doe. Ik lever hem in omdat het project zonder die uitleg niet te beoordelen is: de keuzes zijn de moeite waard, niet de regels code.`,
          leeruitkomst: 'Personal Leadership, AI-Augmented Learning',
        },
        {
          titel: 'Documentatie cavascp',
          wat: 'Technische verantwoording',
          bestand: 'Documentatie/cavascp documentatie.docx',
          beschrijving: `De documentatie van cavascp: hoe het werkt, welke keuzes ik maakte en wat ik ervoor opgaf, met bronnen en een sectie over wat er niet goed is. Ik lever hem in als onderbouwing bij het project en bij Professional Standard.`,
          leeruitkomst: 'Professional Standard',
        },
      ],
      documenten: [
        { titel: 'Documentatie cavascp (markdown)', md: 'Documentatie/cavascp documentatie.md', docx: null, wat: 'Zelfde inhoud, als tekst' },
      ],
    },
  ];

  for (const collectie of collecties) {
    collectie.tekst = leesNotitie(collectie.leeswijzer);
    collectie.leeswijzerBestand = collectie.leeswijzer.replace(/\.md$/, '.docx');
    collectie.leeswijzerKb = grote(collectie.leeswijzerBestand);

    for (const stuk of collectie.bewijs) {
      stuk.kb = stuk.bestand ? grote(stuk.bestand) : null;
    }

    for (const document of collectie.documenten) {
      document.kb = document.docx ? grote(document.docx) : null;
    }
  }

  return {
    collecties,
    overig: [
      {
        titel: 'Reflectie semester',
        bestand: 'Portfolio/Reflectie semester.docx',
        wat: 'Het hele semester tot nu toe, met de feedback van de eerste review',
        kb: grote('Portfolio/Reflectie semester.docx'),
      },
      {
        titel: 'Bewijsbeschrijvingen',
        bestand: 'Portfolio/Bewijsbeschrijvingen.docx',
        wat: 'Alle beschrijvingen bij elkaar, als naslag',
        kb: grote('Portfolio/Bewijsbeschrijvingen.docx'),
      },
      {
        titel: 'Documentatie Studio040',
        bestand: 'Documentatie/studio040 documentatie.docx',
        wat: 'Technische verantwoording van het klantproject',
        kb: grote('Documentatie/studio040 documentatie.docx'),
      },
      {
        titel: 'AI-Editor-Presentatie (pptx)',
        bestand: 'Portfolio/bijlagen/AI-Editor-Presentatie-DylanSchuurman.pptx',
        wat: 'De presentatie van het klantproject',
        kb: grote('Portfolio/bijlagen/AI-Editor-Presentatie-DylanSchuurman.pptx'),
      },
    ],
  };
}
