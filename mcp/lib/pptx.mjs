/**
 * PowerPoint-generator — overgenomen uit Krava.
 *
 * Bron: D:\DOCAto\src\pptx.js
 * Dit bestand is automatisch omgezet van CommonJS naar een ES-module door
 * tools/port-krava.mjs. Pas het niet met de hand aan: draai dat script opnieuw
 * in plaats daarvan, dan blijft het gelijk aan Krava.
 *
 * De generator heeft geen afhankelijkheden behalve ./zip.mjs.
 */

/**
 * Dependency-vrije PowerPoint-writer (.pptx).
 *
 * Een .pptx is een zip met OOXML, net als een .docx. We gebruiken één lege
 * slide-layout en zetten alle tekst en beelden zelf neer met vaste posities.
 * Dat geeft volledige controle over de huisstijl en is een stuk eenvoudiger
 * dan werken met placeholders.
 *
 * Diaformaat: 16:9 (12192000 x 6858000 EMU). 1 cm = 360000 EMU.
 */

import { maakZip } from './zip.mjs';

const EMU_PER_CM = 360000;
const BREED = 12192000;
const HOOG = 6858000;
const RAND = 838200; // 2,33 cm

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

const KOP = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

function esc(tekst) {
  return String(tekst ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Stuurtekens mogen niet in XML; die halen we weg.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function cm(waarde) {
  return Math.round(Number(waarde) * EMU_PER_CM);
}

/** Kleur zonder # en in hoofdletters; OOXML wil geen hekje. */
function kleur(waarde, terugval) {
  const schoon = String(waarde || '').replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(schoon) ? schoon.toUpperCase() : terugval;
}

/** Mengt twee kleuren. `deel` is hoeveel van de tweede erbij komt (0 tot 1). */
function meng(a, b, deel) {
  const A = [0, 2, 4].map((i) => parseInt(a.substr(i, 2), 16));
  const B = [0, 2, 4].map((i) => parseInt(b.substr(i, 2), 16));
  return A.map((v, i) => Math.round(v + (B[i] - v) * deel).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* ------------------------------------------------------------------ *
 * Tekst
 * ------------------------------------------------------------------ */

/**
 * Eén tekstvak. `alineas` is een lijst van:
 *   { tekst, grootte, vet, cursief, kleur, niveau, opsomming, ruimteVoor, uitlijnen }
 */
function tekstVak({ id, naam, x, y, cx, cy, alineas, anker = 't', wrap = 'square' }) {
  // Een tekstvak moet altijd minstens één alinea hebben; een leeg txBody is een
  // schemainbreuk en dan weigert PowerPoint het hele bestand.
  const regels = alineas && alineas.length ? alineas : [{ tekst: '', grootte: 12 }];
  const body = regels
    .map((a) => {
      const niveau = Number(a.niveau) || 0;
      // Volgorde is voorgeschreven door het schema: eerst de kleur, dan het teken.
      const opsomming = a.opsomming
        ? `<a:buClr><a:srgbClr val="${kleur(a.kleur, '333333')}"/></a:buClr><a:buChar char="${esc(a.opsomming === true ? '•' : a.opsomming)}"/>`
        : '<a:buNone/>';
      const ruimte = a.ruimteVoor ? `<a:spcBef><a:spcPts val="${Math.round(a.ruimteVoor * 100)}"/></a:spcBef>` : '';
      const regels = a.regelafstand ? `<a:lnSpc><a:spcPct val="${Math.round(a.regelafstand * 100000)}"/></a:lnSpc>` : '';
      return `<a:p>
        <a:pPr lvl="${niveau}" marL="${niveau * 228600 + (a.opsomming ? 228600 : 0)}" indent="${a.opsomming ? -228600 : 0}" algn="${a.uitlijnen || 'l'}">
          ${regels}${ruimte}${opsomming}
        </a:pPr>
        <a:r>
          <a:rPr lang="nl-NL" sz="${Math.round((Number(a.grootte) || 18) * 100)}" b="${a.vet ? 1 : 0}" i="${a.cursief ? 1 : 0}" dirty="0">
            <a:solidFill><a:srgbClr val="${kleur(a.kleur, '1A1A1A')}"/></a:solidFill>
            <a:latin typeface="${esc(a.font || 'Calibri')}"/>
          </a:rPr>
          <a:t>${esc(a.tekst)}</a:t>
        </a:r>
      </a:p>`;
    })
    .join('');

  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="${esc(naam || `Tekst ${id}`)}"/>
      <p:cNvSpPr txBox="1"/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="${wrap}" anchor="${anker}"><a:normAutofit/></a:bodyPr>
      <a:lstStyle/>
      ${body}
    </p:txBody>
  </p:sp>`;
}

/** Een simpele rechthoek, bijvoorbeeld een accentbalk. */
function balk({ id, naam, x, y, cx, cy, kleur: c }) {
  // Altijd door kleur() halen: een ontbrekende token mag nooit tot
  // val="undefined" leiden, want dan weigert PowerPoint het hele bestand.
  const vulling = kleur(c, 'CCCCCC');
  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="${esc(naam || `Vlak ${id}`)}"/>
      <p:cNvSpPr/><p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="${vulling}"/></a:solidFill>
      <a:ln><a:noFill/></a:ln>
    </p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
  </p:sp>`;
}

/**
 * Een kader met afgeronde hoeken: het vlak waar de inhoud op staat. Zonder zo'n
 * vlak is een dia een leeg wit blad met wat losse regels, en dat ziet er karig
 * uit — ook als de tekst goed is.
 */
function kaart({ id, naam, x, y, cx, cy, vulling, rand, hoek = 9000, dikte = 9525 }) {
  const vlak = vulling ? kleur(vulling, 'FFFFFF') : null;
  const lijnKleur = kleur(rand, 'DDDDDD');
  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="${esc(naam || `Kader ${id}`)}"/>
      <p:cNvSpPr/><p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
      <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${hoek}"/></a:avLst></a:prstGeom>
      ${vlak ? `<a:solidFill><a:srgbClr val="${vlak}"/></a:solidFill>` : '<a:noFill/>'}
      <a:ln w="${dikte}"><a:solidFill><a:srgbClr val="${lijnKleur}"/></a:solidFill></a:ln>
    </p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
  </p:sp>`;
}

/**
 * De voetregel: een haarstreep, de documenttitel links en het dianummer rechts.
 * Op een donkere dia moeten de lijn en de tekst meelichten, anders valt de
 * voetregel weg tegen de achtergrond.
 */
function voetRegel({ id, ctx, nummer, donker = false }) {
  const { accent, subKleur } = ctx.stijl;
  const lijnKleur = donker ? ctx.stijl.lijnDonker : ctx.stijl.lijn;
  const tekstKleur = donker ? ctx.stijl.donkerSub : subKleur;
  const y = HOOG - cm(1.15);
  return [
    balk({ id: id++, naam: 'Voetlijn', x: RAND, y, cx: BREED - RAND * 2, cy: 9525, kleur: lijnKleur }),
    tekstVak({
      id: id++, naam: 'Voettekst', x: RAND, y: y + cm(0.12), cx: BREED - RAND * 2 - cm(2), cy: cm(0.7),
      alineas: [{ tekst: ctx.voettekst, grootte: 9.5, kleur: tekstKleur, font: ctx.font.tekst }]
    }),
    tekstVak({
      id: id++, naam: 'Dianummer', x: BREED - RAND - cm(2), y: y + cm(0.12), cx: cm(2), cy: cm(0.7),
      alineas: [{ tekst: String(nummer), grootte: 9.5, vet: true, kleur: accent, font: ctx.font.tekst, uitlijnen: 'r' }]
    })
  ].join('');
}

/** Een afbeelding op een vaste plek. */
function beeldVak({ id, naam, x, y, cx, cy, relId, rand = 'D8DCE3' }) {
  return `<p:pic>
    <p:nvPicPr>
      <p:cNvPr id="${id}" name="${esc(naam || 'Afbeelding')}"/>
      <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
      <p:nvPr/>
    </p:nvPicPr>
    <p:blipFill>
      <a:blip r:embed="${relId}"/>
      <a:stretch><a:fillRect/></a:stretch>
    </p:blipFill>
    <p:spPr>
      <a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:ln><a:solidFill><a:srgbClr val="${kleur(rand, 'D8DCE3')}"/></a:solidFill><a:w val="9525"/></a:ln>
    </p:spPr>
  </p:pic>`;
}

/**
 * Een kort messing streepje. Dit is het enige versieringselement dat steeds
 * terugkomt: het zet een titel, een cijfer of een onderschrift vast zonder dat
 * er een kader om de inhoud heen hoeft.
 */
function streepje({ id, x, y, cx = cm(1.6), dikte = 38100, kleur: c }) {
  return balk({ id, naam: 'Streepje', x, y, cx, cy: dikte, kleur: c });
}

/* ------------------------------------------------------------------ *
 * Dia's
 * ------------------------------------------------------------------ */

/**
 * Bouwt de shapes voor één dia.
 * Soorten: titel, sectie, bullets, kaarten, cijfer, tijdlijn, quote, beeld,
 * beeld-met-tekst, slot.
 */
function bouwDia(dia, ctx) {
  const shapes = [];
  const { accent, accentVlak, accentDof, tekstKleur, subKleur, kaartVulling, kaartRand, bandKleur, bandInkt, bandSub } = ctx.stijl;
  const fontKop = ctx.font.kop;
  const fontTekst = ctx.font.tekst;
  // De groep in de spTree heeft al id 1; shape-id's moeten uniek zijn.
  let id = 2;

  const kop = dia.titel || '';
  const metKop = ['bullets', 'kaarten', 'cijfer', 'tijdlijn', 'beeld', 'beeld-met-tekst'].includes(dia.soort);
  const heeftKop = Boolean(kop) && metKop;
  const lijn = ctx.stijl.lijn;
  const lijnZacht = ctx.stijl.lijnZacht;

  if (heeftKop) {
    // Een smal messing blokje naast de titel geeft de dia een herkenbaar merk.
    // De titel zelf staat in inkt, niet in messing: messing is voor accenten, en
    // een titel in de accentkleur leest op elke dia hetzelfde en dus als ruis.
    shapes.push(balk({ id: id++, naam: 'Merkblok', x: RAND, y: cm(1.02), cx: cm(0.3), cy: cm(1.05), kleur: accent }));
    shapes.push(tekstVak({
      id: id++, naam: 'Titel', x: RAND + cm(0.72), y: cm(0.88), cx: BREED - RAND * 2 - cm(0.72), cy: cm(1.5),
      alineas: [{ tekst: kop, grootte: 30, vet: true, kleur: tekstKleur, font: fontKop }]
    }));
    shapes.push(balk({ id: id++, naam: 'Titellijn', x: RAND, y: cm(2.62), cx: BREED - RAND * 2, cy: 9525, kleur: lijnZacht }));
  }

  const inhoudY = heeftKop ? cm(3.25) : cm(1.2);
  const inhoudH = HOOG - inhoudY - cm(1.9);
  // Alles op een dia wordt verticaal gecentreerd. Tegen de bovenkant plakken laat
  // de onderste helft leeg, en dat is precies wat een dia karig laat voelen —
  // ook als de inhoud zelf goed is.
  const midden = (h) => inhoudY + Math.max(0, (inhoudH - h) / 2);

  /** Hoeveel regels tekst wordt dit bij deze breedte? Een ruwe schatting volstaat. */
  const regelTal = (tekst, breedteCm) =>
    Math.max(1, Math.ceil(String(tekst || '').length / Math.max(16, breedteCm / 0.19)));

  if (dia.soort === 'titel') {
    // Omslag: één donker vlak over de hele dia. Dat geeft de presentatie een
    // gezicht en zorgt voor ritme: donker openen, licht werken, donker sluiten.
    shapes.push(balk({ id: id++, naam: 'Achtergrond', x: 0, y: 0, cx: BREED, cy: HOOG, kleur: bandKleur }));
    shapes.push(balk({ id: id++, naam: 'Merkblok', x: RAND, y: cm(4.35), cx: cm(2.6), cy: 50800, kleur: accent }));

    const voet = [dia.opleiding, dia.instelling].filter(Boolean).join('  ·  ');
    const regels = [];
    if (dia.ondertitel) regels.push({ tekst: dia.ondertitel, grootte: 18, kleur: bandSub, font: fontTekst, ruimteVoor: 24 });
    shapes.push(tekstVak({
      id: id++, naam: 'Hoofdtitel', x: RAND, y: cm(5.15), cx: BREED - RAND * 2 - cm(2.4), cy: cm(5.4),
      alineas: [
        { tekst: kop, grootte: 44, vet: true, kleur: bandInkt, font: fontKop, regelafstand: 1.02 },
        ...regels
      ]
    }));

    // De gegevens onderin, met een haarstreep erboven zodat het geen losse
    // regels onderaan een leeg vlak zijn.
    shapes.push(balk({ id: id++, naam: 'Scheiding', x: RAND, y: HOOG - cm(3.4), cx: BREED - RAND * 2, cy: 9525, kleur: ctx.stijl.lijnDonker }));
    shapes.push(tekstVak({
      id: id++, naam: 'Gegevens', x: RAND, y: HOOG - cm(2.9), cx: BREED - RAND * 2, cy: cm(2.1),
      alineas: [
        ...(dia.auteur ? [{ tekst: dia.auteur, grootte: 15, vet: true, kleur: bandInkt, font: fontKop }] : []),
        ...((voet || dia.datum)
          ? [{ tekst: [voet, dia.datum].filter(Boolean).join('  ·  '), grootte: 11.5, kleur: bandSub, font: fontTekst, ruimteVoor: 7 }]
          : [])
      ]
    }));
  } else if (dia.soort === 'sectie') {
    // Tussenblad: ook donker, zodat het de hoofdstukken van elkaar scheidt.
    shapes.push(balk({ id: id++, naam: 'Achtergrond', x: 0, y: 0, cx: BREED, cy: HOOG, kleur: bandKleur }));
    // Een groot, dof messing cijfer rechtsonder geeft het tussenblad gewicht
    // zonder om aandacht te schreeuwen.
    shapes.push(tekstVak({
      id: id++, naam: 'Achtergrondcijfer', x: BREED - RAND - cm(13), y: HOOG - cm(9.6), cx: cm(13), cy: cm(8.6),
      alineas: [{ tekst: String(dia.nummer || ''), grootte: 190, vet: true, kleur: accentDof, font: fontKop, uitlijnen: 'r' }]
    }));
    shapes.push(balk({ id: id++, naam: 'Merkblok', x: RAND, y: cm(6.35), cx: cm(2.4), cy: 50800, kleur: accent }));
    shapes.push(tekstVak({
      id: id++, naam: 'Sectietitel', x: RAND, y: cm(7.05), cx: BREED - RAND * 2 - cm(6), cy: cm(3.2),
      alineas: [{ tekst: kop, grootte: 38, vet: true, kleur: bandInkt, font: fontKop, regelafstand: 1.05 }]
    }));
  } else if (dia.soort === 'kaarten') {
    const punten = (dia.punten || []).slice(0, 4);
    const n = Math.max(1, punten.length);
    const tussen = cm(0.7);
    const breedte = (BREED - RAND * 2 - tussen * (n - 1)) / n;
    // De kaders krijgen de hoogte die de inhoud nodig heeft. Een vast hoge kaart
    // met lege ruimte erin ziet er onaf uit.
    const nodigeRegels = Math.max(
      ...punten.map((p) => (p.titel ? 1 : 0) + regelTal(p.tekst, breedte / EMU_PER_CM - 1.7)),
      1
    );
    const hoogte = Math.min(inhoudH, cm(2.85) + nodigeRegels * cm(0.6));
    const y = midden(hoogte);
    punten.forEach((punt, i) => {
      const x = RAND + i * (breedte + tussen);
      shapes.push(kaart({ id: id++, naam: `Kaart ${i + 1}`, x, y, cx: breedte, cy: hoogte, vulling: kaartVulling, rand: kaartRand }));
      // Een messing streepje met een klein nummer eronder, in plaats van een
      // gevuld cijferblok. Dat laatste is het standaardsjabloon; dit leest als
      // een streep in een tijdschrift.
      shapes.push(streepje({ id: id++, x: x + cm(0.85), y: y + cm(0.85), cx: cm(1.5), kleur: accent }));
      shapes.push(tekstVak({
        id: id++, naam: `Kaartnummer ${i + 1}`, x: x + cm(0.85), y: y + cm(1.22), cx: breedte - cm(1.7), cy: cm(0.7),
        alineas: [{ tekst: String(i + 1).padStart(2, '0'), grootte: 11, vet: true, kleur: accent, font: fontTekst }]
      }));
      shapes.push(tekstVak({
        id: id++, naam: `Kaarttekst ${i + 1}`, x: x + cm(0.85), y: y + cm(1.92), cx: breedte - cm(1.7), cy: hoogte - cm(2.3),
        alineas: [
          { tekst: punt.titel || punt.tekst || '', grootte: 17, vet: true, kleur: tekstKleur, font: fontKop, regelafstand: 1.12 },
          ...(punt.tekst && punt.titel ? [{ tekst: punt.tekst, grootte: 12.5, kleur: subKleur, font: fontTekst, ruimteVoor: 9, regelafstand: 1.3 }] : [])
        ]
      }));
    });
  } else if (dia.soort === 'cijfer') {
    const punten = (dia.punten || []).slice(0, 3);
    const n = Math.max(1, punten.length);
    // Drie kolommen over de volle breedte, met een scheidingslijn ertussen.
    //
    // HIER GING HET ÉÉN KEER MIS
    // Ik wilde de lege rechterkant opvullen en rekende de tussenruimte uit als
    // "de breedte min twaalf centimeter, gedeeld door het aantal kolommen". Bij
    // drie kolommen werd de tussenruimte daardoor groter dan de kolom zelf: het
    // cijfer "40%" viel buiten zijn vak en het label eronder liep er dwars
    // doorheen. Een verdeelsleutel hoort de kolom nooit kleiner te maken dan wat
    // de inhoud nodig heeft. Daarom nu een vaste verhouding: de kolommen krijgen
    // samen 84% van de breedte, de rest is tussenruimte.
    const tussen = Math.round(((BREED - RAND * 2) * 0.16) / Math.max(1, n - 1));
    const breedte = (BREED - RAND * 2 - tussen * (n - 1)) / n;
    const blokHoogte = cm(6.6);
    const y = midden(blokHoogte);
    punten.forEach((punt, i) => {
      const x = RAND + i * (breedte + tussen);
      // Een haarstreep tussen de kolommen doet het werk dat drie kaders zouden
      // doen, zonder dat het druk wordt.
      if (i > 0) {
        shapes.push(balk({
          id: id++, naam: `Scheiding ${i}`, x: x - tussen / 2, y: y + cm(0.7),
          cx: 9525, cy: blokHoogte - cm(1.4), kleur: lijnZacht
        }));
      }
      shapes.push(tekstVak({
        id: id++, naam: `Cijfer ${i + 1}`, x, y: y + cm(0.1), cx: breedte, cy: cm(3.7),
        alineas: [{ tekst: punt.cijfer || punt.tekst || '', grootte: 72, vet: true, kleur: accent, font: fontKop, uitlijnen: 'ctr' }]
      }));
      shapes.push(tekstVak({
        id: id++, naam: `Cijfertekst ${i + 1}`, x: x + cm(0.4), y: y + cm(4.05), cx: breedte - cm(0.8), cy: cm(2.2),
        alineas: [{ tekst: punt.label || '', grootte: 12.5, kleur: subKleur, font: fontTekst, uitlijnen: 'ctr', regelafstand: 1.34 }]
      }));
    });
  } else if (dia.soort === 'tijdlijn') {
    const punten = (dia.punten || []).slice(0, 4);
    const n = Math.max(1, punten.length);
    const blokHoogte = cm(5.4);
    const y = midden(blokHoogte);
    const lijnY = y + cm(3.6);
    shapes.push(balk({ id: id++, naam: 'Tijdlijn', x: RAND + cm(1.4), y: lijnY, cx: BREED - RAND * 2 - cm(2.8), cy: 19050, kleur: kaartRand }));
    punten.forEach((punt, i) => {
      const stap = (BREED - RAND * 2 - cm(2.8)) / Math.max(1, n - 1);
      const x = RAND + cm(1.4) + i * stap;
      shapes.push(kaart({
        id: id++, naam: `Knoop ${i + 1}`, x: x - cm(0.42), y: lijnY - cm(0.42), cx: cm(0.84), cy: cm(0.84),
        vulling: accent, rand: accent, hoek: 50000
      }));
      // De fase staat boven de knoop, de uitleg eronder: zo leest de tijdlijn
      // als een reeks en niet als vier losse blokken.
      shapes.push(tekstVak({
        id: id++, naam: `Tijdlijnkop ${i + 1}`, x: x - cm(2.4), y: y, cx: cm(4.8), cy: cm(3.4),
        alineas: [
          { tekst: punt.titel || '', grootte: 17, vet: true, kleur: tekstKleur, font: fontKop, uitlijnen: 'ctr' },
          ...(punt.tekst ? [{ tekst: punt.tekst, grootte: 12, kleur: subKleur, font: fontTekst, uitlijnen: 'ctr', ruimteVoor: 10, regelafstand: 1.3 }] : [])
        ]
      }));
    });
  } else if (dia.soort === 'quote') {
    const blokHoogte = cm(8);
    const y = midden(blokHoogte);
    // Het aanhalingsteken staat OP de marge en het citaat begint er direct naast.
    //
    // Eerst stond het citaat 3,4 cm ingesprongen om ruimte te maken voor een
    // aanhalingsteken van 120 punten. Dat kostte een derde van de breedte aan
    // een leeg gat links, en juist bij een citaat wil je de regel zo lang
    // mogelijk hebben. Het teken is nu kleiner en het citaat schuift maar een
    // klein stukje op.
    const tekenBreedte = cm(1.7);
    shapes.push(tekstVak({
      id: id++, naam: 'Aanhalingsteken', x: RAND, y: y - cm(0.5), cx: tekenBreedte, cy: cm(3),
      alineas: [{ tekst: '\u201C', grootte: 96, vet: true, kleur: accent, font: fontKop }]
    }));
    shapes.push(tekstVak({
      id: id++, naam: 'Citaat',
      x: RAND + tekenBreedte + cm(0.5),
      y: y + cm(1.0),
      cx: BREED - RAND * 2 - tekenBreedte - cm(0.5),
      cy: cm(5.4),
      alineas: [{ tekst: kop || (dia.punten || [])[0]?.tekst || '', grootte: 26, cursief: true, kleur: tekstKleur, font: fontKop, regelafstand: 1.28 }]
    }));
    if (dia.onderschrift) {
      const bronX = RAND + tekenBreedte + cm(0.5);
      shapes.push(streepje({ id: id++, x: bronX, y: y + cm(6.35), cx: cm(1.1), dikte: 25400, kleur: accent }));
      shapes.push(tekstVak({
        id: id++, naam: 'Bron', x: bronX + cm(1.6), y: y + cm(6.15),
        cx: BREED - RAND - bronX - cm(1.6), cy: cm(1.2),
        alineas: [{ tekst: dia.onderschrift, grootte: 12.5, kleur: subKleur, font: fontTekst }]
      }));
    }
  } else if (dia.soort === 'beeld') {
    const b = dia.beeld;
    // Een figuur krijgt bijna de volle dia, niet de kolombreedte van de tekst.
    //
    // WAAROM DAT ANDERS IS DAN HET LIJKT
    // Eerst kreeg de afbeelding dezelfde marge als de tekst: 2,33 cm aan elke
    // kant. Op een dia van 33,87 cm is dat 4,7 cm aan wit, en omdat een
    // schermafbeelding meestal breder is dan hoog, viel er ook nog eens ruimte
    // boven en onder. Het beeld stond dan als een postzegel in het midden.
    // De marge voor tekst is er om regels leesbaar te houden; een figuur heeft
    // die reden niet. Wat overblijft is de inspringing van het onderschrift,
    // zodat dat wel op de tekstlijn van de andere dia's blijft.
    const margeBeeld = cm(1.15);
    const ruimteBoven = inhoudY;
    const ruimteOnder = Boolean(dia.onderschrift) ? cm(2.5) : cm(1.1);
    const maxH = HOOG - ruimteBoven - ruimteOnder;
    const maxB = BREED - margeBeeld * 2;
    const verhouding = b.breedteCm && b.hoogteCm ? b.breedteCm / b.hoogteCm : 1.6;
    let cx = maxB;
    let cy = cx / verhouding;
    if (cy > maxH) {
      cy = maxH;
      cx = cy * verhouding;
    }
    const bx = (BREED - cx) / 2;
    const by = ruimteBoven + (maxH - cy) / 2;
    shapes.push(beeldVak({ id: id++, naam: b.naam || 'Afbeelding', x: bx, y: by, cx, cy, relId: b.relId, rand: kaartRand }));
    if (dia.onderschrift) {
      // Het onderschrift houdt de gewone marge, ook als het beeld breder is.
      // Anders springt de tekstregel op deze dia ineens naar links.
      shapes.push(streepje({ id: id++, x: RAND, y: HOOG - cm(1.85), cx: cm(1.1), dikte: 25400, kleur: accent }));
      shapes.push(tekstVak({
        id: id++, naam: 'Onderschrift', x: RAND + cm(1.6), y: HOOG - cm(2.08),
        cx: BREED - RAND * 2 - cm(1.6), cy: cm(1.1),
        alineas: [{ tekst: dia.onderschrift, grootte: 11.5, cursief: true, kleur: subKleur, font: fontTekst }]
      }));
    }
  } else if (dia.soort === 'beeld-met-tekst') {
    const b = dia.beeld;
    const verhouding = b.breedteCm && b.hoogteCm ? b.breedteCm / b.hoogteCm : 1.6;
    // De tekstkolom wordt op de regellengte gehouden, niet op een deel van de
    // dia. 36% van 28,3 cm is 10,2 cm: dat is ongeveer veertien tekens per regel
    // bij 15 punten, en dan breekt elke zin in vier stukken. Een kolom van 12 cm
    // leest wel, en het beeld krijgt de rest — dat is toch het onderwerp.
    const tekstBreedte = cm(12);
    const tussenruimte = cm(1.4);
    const beeldBreedte = BREED - RAND * 2 - tekstBreedte - tussenruimte;
    let cx = beeldBreedte;
    let cy = cx / verhouding;
    if (cy > inhoudH) {
      cy = inhoudH;
      cx = cy * verhouding;
    }
    const bx = BREED - RAND - cx;
    const by = inhoudY + (inhoudH - cy) / 2;
    shapes.push(beeldVak({ id: id++, naam: b.naam || 'Afbeelding', x: bx, y: by, cx, cy, relId: b.relId, rand: kaartRand }));
    // De tekst staat vrij naast het beeld: geen kader eromheen, wel een streepje
    // dat de lijst vastzet.
    shapes.push(streepje({ id: id++, x: RAND, y: inhoudY + cm(0.35), cx: cm(1.5), kleur: accent }));
    shapes.push(tekstVak({
      id: id++, naam: 'Tekst', x: RAND, y: inhoudY + cm(0.95), cx: tekstBreedte, cy: inhoudH - cm(1.2),
      alineas: (dia.punten || []).slice(0, 5).map((p, i) => ({
        tekst: typeof p === 'string' ? p : p.tekst,
        grootte: 16, kleur: tekstKleur, font: fontTekst,
        opsomming: '•', ruimteVoor: i === 0 ? 0 : 16, niveau: 0, regelafstand: 1.24
      }))
    }));
  } else if (dia.soort === 'slot') {
    // Spiegel van de omslag, zodat de presentatie sluit zoals hij opent.
    shapes.push(balk({ id: id++, naam: 'Achtergrond', x: 0, y: 0, cx: BREED, cy: HOOG, kleur: bandKleur }));
    shapes.push(balk({ id: id++, naam: 'Merkblok', x: RAND, y: cm(4.3), cx: cm(2.4), cy: 50800, kleur: accent }));
    shapes.push(tekstVak({
      id: id++, naam: 'Slottitel', x: RAND, y: cm(5.0), cx: BREED - RAND * 2, cy: cm(3),
      alineas: [{ tekst: kop || 'Vragen?', grootte: 44, vet: true, kleur: bandInkt, font: fontKop }]
    }));
    shapes.push(tekstVak({
      id: id++, naam: 'Slotregels', x: RAND, y: cm(8.3), cx: BREED - RAND * 2, cy: cm(3.2),
      alineas: (dia.punten || []).map((p, i) => ({
        tekst: typeof p === 'string' ? p : p.tekst,
        grootte: 15, kleur: bandSub, font: fontTekst, ruimteVoor: i === 0 ? 0 : 9
      }))
    }));
  } else {
    // bullets: geen kader om de tekst heen. Een bleek vlak met een haarrand om
    // elke lijst is precies wat een dia sjabloonachtig maakt; witruimte en
    // grotere letters doen hetzelfde werk beter.
    //
    // TWEE KOLOMMEN ALS DE LIJST LANG IS
    // Een dia is 33,87 cm breed. Eén kolom met vier punten van twintig punten
    // vult daar ongeveer een derde van: de rest is leeg, en dat leest niet als
    // rust maar als een half afgemaakte dia. Bij vier punten of meer gaat de
    // lijst daarom in twee kolommen, net als op een echte dia. Bij drie of
    // minder blijft het één kolom, want dan zou de tweede kolom juist leeg zijn.
    const punten = dia.punten || [];
    const tweeKoloms = punten.length >= 4;
    const kolomBreedte = tweeKoloms
      ? Math.round(((BREED - RAND * 2) - cm(1.6)) / 2)
      : cm(19);

    const helft = Math.ceil(punten.length / 2);
    const kolommen = tweeKoloms ? [punten.slice(0, helft), punten.slice(helft)] : [punten];

    const teksten = (lijst) => lijst.map((p, i) => ({
      tekst: typeof p === 'string' ? p : p.tekst,
      grootte: typeof p === 'string' ? 20 : Number(p.grootte) || 20,
      niveau: typeof p === 'string' ? 0 : Number(p.niveau) || 0,
      vet: typeof p === 'string' ? false : Boolean(p.vet),
      kleur: tekstKleur, font: fontTekst,
      opsomming: true,
      ruimteVoor: i === 0 ? 0 : 18,
      regelafstand: 1.18
    }));

    const regelsPerKolom = Math.max(...kolommen.map((lijst) =>
      lijst.reduce((som, p) => som + regelTal(typeof p === 'string' ? p : p.tekst, kolomBreedte / EMU_PER_CM - 1), 0)
    ));
    const hoogte = Math.min(inhoudH, cm(1.5) + regelsPerKolom * cm(0.78));
    const y = midden(hoogte);

    // Het messing streepje boven de lijst loopt mee met de kolommen. Bij één
    // kolom is het een kort accent; bij twee kolommen wordt het een lijn over de
    // volle breedte, zodat de bovenkant van de dia ook gevuld is.
    shapes.push(streepje({
      id: id++, x: RAND, y: y - cm(1.15),
      cx: tweeKoloms ? BREED - RAND * 2 : cm(1.6),
      kleur: accent
    }));

    kolommen.forEach((lijst, k) => {
      if (!lijst.length) return;
      shapes.push(tekstVak({
        id: id++, naam: `Punten ${k + 1}`,
        x: RAND + k * (kolomBreedte + cm(1.6)),
        y,
        cx: kolomBreedte,
        cy: hoogte,
        anker: 't',
        alineas: teksten(lijst)
      }));
    });
  }

  // Voetregel met het dianummer, behalve op de omslag en de slotdia.
  if (dia.soort !== 'titel' && dia.soort !== 'slot') {
    shapes.push(voetRegel({ id: 900, ctx, nummer: ctx.nummer, donker: dia.soort === 'sectie' }));
  }

  return shapes.join('');
}

function diaXml(dia, ctx) {
  // Het dianummer staat in de voetregel van elke dia.
  const eigen = { ...ctx, nummer: dia.__nummer || 1 };
  return `${KOP}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${bouwDia(dia, eigen)}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function notesXml(tekst, ctx) {
  const alineas = String(tekst || '')
    .split(/\n+/)
    .filter((r) => r.trim())
    .map((r) => ({ tekst: r.trim(), grootte: 12, kleur: '1A1A1A', font: ctx.font.tekst, ruimteVoor: 6, opsomming: r.trim().startsWith('- ') ? '•' : false }));

  const body = alineas.length
    ? alineas
        .map(
          (a) =>
            `<a:p><a:pPr lvl="0"${a.opsomming ? ' marL="228600" indent="-228600"' : ''}/>${
              a.opsomming ? `<a:r><a:rPr lang="nl-NL" sz="1200" dirty="0"/><a:t>${a.opsomming} </a:t></a:r>` : ''
            }<a:r><a:rPr lang="nl-NL" sz="1200" dirty="0"/><a:t>${esc(a.tekst.replace(/^- /, ''))}</a:t></a:r></a:p>`
        )
        .join('')
    : '<a:p><a:r><a:rPr lang="nl-NL" sz="1200" dirty="0"/><a:t></a:t></a:r></a:p>';

  return `${KOP}<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Dianummer"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="1031888" y="104775"/><a:ext cx="2743200" cy="228600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{B9A5B2C1-0000-4000-8000-000000000001}" type="slidenum"><a:rPr lang="nl-NL" sz="1200"/><a:t>1</a:t></a:fld></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Notities"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="685800" y="685800"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>${body}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:notes>`;
}

/* ------------------------------------------------------------------ *
 * Vaste onderdelen
 * ------------------------------------------------------------------ */

function contentTypes(aantalDias, aantalNotities, media) {
  const extensies = new Set(media.map((m) => {
    const punt = m.naam.lastIndexOf('.');
    return punt >= 0 ? m.naam.slice(punt + 1).toLowerCase() : 'png';
  }));
  return `${KOP}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${extensies.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : ''}
  ${extensies.has('jpg') ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ''}
  ${extensies.has('gif') ? '<Default Extension="gif" ContentType="image/gif"/>' : ''}
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${Array.from({ length: aantalDias }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n  ')}
  ${Array.from({ length: aantalNotities }, (_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('\n  ')}
</Types>`;
}

function rootRels() {
  return `${KOP}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function coreXml(titel, auteur) {
  const nu = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `${KOP}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(titel)}</dc:title>
  <dc:creator>${esc(auteur || 'Krava')}</dc:creator>
  <cp:lastModifiedBy>${esc(auteur || 'Krava')}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nu}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nu}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(aantalDias) {
  return `${KOP}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Krava</Application>
  <Slides>${aantalDias}</Slides>
  <Company></Company>
</Properties>`;
}

function themeXml(stijl, font) {
  const accent = kleur(stijl.accent, 'B08127');
  const donker = kleur(stijl.tekstKleur, '1A1A1A');
  const licht = 'FFFFFF';
  return `${KOP}<a:theme xmlns:a="${A}" name="Krava">
  <a:themeElements>
    <a:clrScheme name="Krava">
      <a:dk1><a:srgbClr val="${donker}"/></a:dk1>
      <a:lt1><a:srgbClr val="${licht}"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="${accent}"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="${accent}"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Krava">
      <a:majorFont><a:latin typeface="${esc(font.kop || 'Calibri')}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="${esc(font.tekst || 'Calibri')}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Krava">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/></a:schemeClr></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;
}

function legeSpTree() {
  return `<p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>`;
}

function slideMasterXml() {
  return `${KOP}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    ${legeSpTree()}
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="2800" b="1"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;
}

function slideMasterRels() {
  return `${KOP}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

function slideLayoutXml() {
  return `${KOP}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1">
  <p:cSld name="Leeg">${legeSpTree()}</p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function slideLayoutRels() {
  return `${KOP}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
}

function notesMasterXml() {
  return `${KOP}<p:notesMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    ${legeSpTree()}
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle>
</p:notesMaster>`;
}

function notesMasterRels() {
  // Let op: de notesMaster krijgt een eigen thema. Wijs je hem hetzelfde thema
  // als de slideMaster, dan weigert PowerPoint het hele bestand met "het bestand
  // is beschadigd". Dat kostte een middag zoeken; daarom staat het hier.
  return `${KOP}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"/>
</Relationships>`;
}

function presPropsXml() {
  return `${KOP}<p:presentationPr xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"/>`;
}

function viewPropsXml() {
  return `${KOP}<p:viewPr xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>
  <p:gridSpacing cx="78028800" cy="78028800"/>
</p:viewPr>`;
}

function tableStylesXml() {
  return `${KOP}<a:tblStyleLst xmlns:a="${A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}

/* ------------------------------------------------------------------ *
 * Opbouw
 * ------------------------------------------------------------------ */

/**
 * @param {object} presentatie  { titel, ondertitel, auteur, opleiding, instelling, datum, dias: [...] }
 * @param {object} opties       { kleuren, font, afbeeldingen }
 */
function bouwPptx(presentatie, opties = {}) {
  const kleuren = opties.kleuren || {};
  const font = opties.font || {};
  const accent = kleur(kleuren.accent, 'B08127');
  const tekstKleur = kleur(kleuren.tekst, '1A1A1A');
  const subKleur = kleur(kleuren.subtekst, '5A6472');
  const wit = 'FFFFFF';

  const stijl = {
    accent,
    tekstKleur,
    subKleur,
    // Afgeleide tinten. Een dia met alleen tekst op wit oogt karig; de kaders en
    // vlakken geven hem rust en diepte zonder dat het druk wordt.
    accentVlak: meng(wit, accent, 0.16),
    kaartVulling: meng(wit, accent, 0.045),
    kaartRand: meng(wit, accent, 0.17),
    lijn: meng(wit, accent, 0.14),
    lijnZacht: meng(wit, accent, 0.08),
    // Het donkere vlak is de inktzwarte basis van de huisstijl, zodat een
    // presentatie en de app als hetzelfde product voelen.
    bandKleur: '131824',
    bandInkt: 'F2F4F8',
    bandSub: 'A9B3C6',
    // Donkere tekst op messing: messing is licht genoeg om leesbaar te zijn.
    opAccent: '16202E',
    // Op een donkere dia moet een streep oplichten in plaats van wegvallen.
    lijnDonker: meng('131824', wit, 0.22),
    // Het grote cijfer op een tussenblad: messing dat net boven het donker uitkomt.
    accentDof: meng('131824', accent, 0.34)
  };

  // Afbeeldingen klaarzetten: alleen wat echt gebruikt wordt.
  const media = [];
  const perNaam = new Map();
  const figuren = new Map((opties.afbeeldingen || []).map((a) => [a.naam, a]));

  const zoekBeeld = (dia) => {
    if (!dia.afbeelding) return null;
    const bron = figuren.get(dia.afbeelding);
    if (!bron || !bron.bytes) return null;
    if (perNaam.has(dia.afbeelding)) return perNaam.get(dia.afbeelding);
    const nummer = media.length + 1;
    // Een bewegend beeld (gif) blijft een gif: PowerPoint speelt hem af in de
    // presentatiemodus. Hem hier omzetten naar png zou de beweging weggooien.
    const extensie = bron.formaat === 'jpeg' ? 'jpg' : bron.formaat === 'gif' ? 'gif' : 'png';
    const naam = `image${nummer}.${extensie}`;
    const relId = `rIdImg${nummer}`;
    const record = { naam: bron.naam || dia.afbeelding, relId, bestandsnaam: naam, bytes: bron.bytes, breedteCm: bron.breedteCm, hoogteCm: bron.hoogteCm };
    perNaam.set(dia.afbeelding, record);
    media.push({ naam: `ppt/media/${naam}`, data: bron.bytes });
    return record;
  };

  const ctx = {
    stijl,
    font: { kop: font.kop || 'Calibri', tekst: font.tekst || 'Calibri' },
    voettekst: presentatie.voettekst || presentatie.titel || ''
  };

  // Eerste dia is altijd een titeldia. Levert de aanlevering er al een, dan
  // vullen we de gegevens van het document erbij in — anders raak je ondertitel,
  // auteur en datum kwijt zodra het model zelf een titeldia maakt.
  const dias = [];
  const vanBuiten = (presentatie.dias || []).find((d) => d.soort === 'titel');
  if (vanBuiten) {
    vanBuiten.ondertitel = vanBuiten.ondertitel || presentatie.ondertitel || '';
    vanBuiten.auteur = vanBuiten.auteur || presentatie.auteur || '';
    vanBuiten.opleiding = vanBuiten.opleiding || presentatie.opleiding || '';
    vanBuiten.instelling = vanBuiten.instelling || presentatie.instelling || '';
    vanBuiten.datum = vanBuiten.datum || presentatie.datum || '';
  } else {
    dias.push({
      soort: 'titel',
      titel: presentatie.titel || 'Presentatie',
      ondertitel: presentatie.ondertitel || '',
      auteur: presentatie.auteur || '',
      opleiding: presentatie.opleiding || '',
      instelling: presentatie.instelling || '',
      datum: presentatie.datum || ''
    });
  }

  // De titeldia van buiten heeft geen 'beeld'-veld; de rest krijgt er een.
  for (const dia of presentatie.dias || []) {
    if (dia.soort === 'titel') {
      dias.push(dia);
      continue;
    }
    const beeld = zoekBeeld(dia);
    if ((dia.soort === 'beeld' || dia.soort === 'beeld-met-tekst') && !beeld) {
      // Afbeelding ontbreekt: dan maar als bullets, anders blijft er een lege dia over.
      dias.push({ soort: 'bullets', titel: dia.titel, punten: dia.punten || [], notities: dia.notities });
      continue;
    }
    dias.push({ ...dia, beeld });
  }

  const aantalDias = dias.length;
  const aantalNotities = dias.filter((d) => String(d.notities || '').trim()).length;

  const bestanden = [];
  bestanden.push({ naam: '[Content_Types].xml', data: contentTypes(aantalDias, aantalNotities, media) });
  bestanden.push({ naam: '_rels/.rels', data: rootRels() });
  bestanden.push({ naam: 'docProps/core.xml', data: coreXml(presentatie.titel, presentatie.auteur) });
  bestanden.push({ naam: 'docProps/app.xml', data: appXml(aantalDias) });
  bestanden.push({ naam: 'ppt/theme/theme1.xml', data: themeXml(stijl, ctx.font) });
  bestanden.push({ naam: 'ppt/theme/theme2.xml', data: themeXml(stijl, ctx.font) });
  bestanden.push({ naam: 'ppt/presProps.xml', data: presPropsXml() });
  bestanden.push({ naam: 'ppt/viewProps.xml', data: viewPropsXml() });
  bestanden.push({ naam: 'ppt/tableStyles.xml', data: tableStylesXml() });
  bestanden.push({ naam: 'ppt/slideMasters/slideMaster1.xml', data: slideMasterXml() });
  bestanden.push({ naam: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: slideMasterRels() });
  bestanden.push({ naam: 'ppt/slideLayouts/slideLayout1.xml', data: slideLayoutXml() });
  bestanden.push({ naam: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: slideLayoutRels() });
  bestanden.push({ naam: 'ppt/notesMasters/notesMaster1.xml', data: notesMasterXml() });
  bestanden.push({ naam: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: notesMasterRels() });

  // Relatie-ids in presentation.xml: eerst master, presProps, notesMaster, dan de dia's.
  const rels = [
    { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', doel: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps', doel: 'presProps.xml' },
    { id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster', doel: 'notesMasters/notesMaster1.xml' },
    { id: 'rIdView', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps', doel: 'viewProps.xml' },
    { id: 'rIdTheme', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', doel: 'theme/theme1.xml' },
    { id: 'rIdTabel', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles', doel: 'tableStyles.xml' }
  ];

  let notitieTeller = 0;
  dias.forEach((dia, i) => {
    const nummer = i + 1;
    dia.__nummer = nummer;
    const relId = `rId${i + 4}`;
    rels.push({ id: relId, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', doel: `slides/slide${nummer}.xml` });

    const diaRels = [{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', doel: '../slideLayouts/slideLayout1.xml' }];

    // Afbeeldingen van deze dia.
    const gebruikteBeelden = [...perNaam.values()].filter((b) => {
      const d = dia.beeld;
      return d && d.relId === b.relId;
    });
    if (gebruikteBeelden.length) {
      for (const b of gebruikteBeelden) {
        diaRels.push({ id: b.relId, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', doel: `../media/${b.bestandsnaam}` });
      }
    }

    if (String(dia.notities || '').trim()) {
      notitieTeller += 1;
      const nRel = `rIdNotes${notitieTeller}`;
      diaRels.push({ id: nRel, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide', doel: `../notesSlides/notesSlide${notitieTeller}.xml` });
      bestanden.push({ naam: `ppt/notesSlides/notesSlide${notitieTeller}.xml`, data: notesXml(dia.notities, ctx) });
      bestanden.push({
        naam: `ppt/notesSlides/_rels/notesSlide${notitieTeller}.xml.rels`,
        data: `${KOP}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${nummer}.xml"/>
</Relationships>`
      });
    }

    bestanden.push({ naam: `ppt/slides/slide${nummer}.xml`, data: diaXml(dia, ctx) });
    bestanden.push({
      naam: `ppt/slides/_rels/slide${nummer}.xml.rels`,
      data: `${KOP}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${diaRels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.doel}"/>`).join('\n  ')}
</Relationships>`
    });
  });

  const presentatieXml = `${KOP}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>
  <p:sldIdLst>
    ${dias.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 4}"/>`).join('\n    ')}
  </p:sldIdLst>
  <p:sldSz cx="${BREED}" cy="${HOOG}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  bestanden.push({ naam: 'ppt/presentation.xml', data: presentatieXml });
  bestanden.push({
    naam: 'ppt/_rels/presentation.xml.rels',
    data: `${KOP}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.doel}"/>`).join('\n  ')}
</Relationships>`
  });

  bestanden.push(...media);

  const buffer = maakZip(bestanden);
  return {
    buffer,
    statistiek: { dias: aantalDias, notities: aantalNotities, afbeeldingen: media.length, bytes: buffer.length }
  };
}

export { bouwPptx, EMU_PER_CM };
