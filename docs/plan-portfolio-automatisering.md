# Plan: het portfolio automatisch opbouwen en inleveren

Dit bouwt voort op `docs/portflow-werking.md` (het onderzoek) en op wat er al
staat: semesterindeling, cursus-intelligentie, announcement-scan en de geteste
Canvas-uploadketen.

Uitgangspunt: **elke fase is af en bruikbaar voordat de volgende begint.** Je
wilde stap voor stap, niet alles tegelijk.

---

## Waar we staan

| Onderdeel | Status |
|---|---|
| Semesters gescheiden, 4-wekenvenster | klaar, getest |
| Cursus-intelligentie (modules, announcements, LO's) | klaar, live getest |
| Canvas inleveren (upload → inlevering) | klaar, getest tot de upload |
| Portflow lezen (mappen, bewijs, doelen) | klaar |
| Portflow bewijs uploaden | klaar |
| Portflow beschrijving/leeswijzer schrijven | route gevonden (204), nog niet in de brug |
| Portflow snapshot maken | **endpoint onbekend** |

De drie mappen van dit semester zijn leeg op één bewijsstuk na. De doelen hangen
goed: elke map aan alle zes MAIFS-leeruitkomsten.

---

## Fase A — De drie mappen bruikbaar maken

Wat je straks kunt: een document in een map zetten, er een beschrijving aan
geven, en het aan **meerdere** leeruitkomsten hangen.

### A1. Schrijfmethodes in de brug

`browser/portflow.mjs` uitbreiden met:

```
setCollectionDescription(collectionId, text)   → PATCH collectie
setCollectionSubtitle(collectionId, text)      → PATCH collectie
setEvidenceDescription(evidenceId, text)       → PATCH bewijs
setEvidenceGoals(evidenceId, goalIds[])        → doelen koppelen (meerdere)
```

`addFileEvidence()` koppelt al aan meerdere doelen; dat blijft de uploadweg.

**Let op:** bij het zetten van doelen wordt de bestaande set *vervangen*, niet
aangevuld. Dat moet expliciet getest worden, anders verlies je koppelingen.

### A2. De drie mappen in het dashboard

Op de Portflow-tab: de mappen van **het gekozen semester**, niet alle twaalf.
Per map zie je:

- hoeveel bewijs erin zit
- of er een leeswijzer is, en hoe oud
- welke van de zes leeruitkomsten gedekt zijn — en welke niet

### A3. Canvas-leeruitkomsten aan Portflow-doelen koppelen

Dit is de schakel die nu ontbreekt. Canvas heeft de zes MAIFS-uitkomsten met
eigen id's; Portflow heeft dezelfde zes met eigen id's (485380–485385). Zonder
koppeling weet het dashboard niet dat jouw criterium "Responsible AI for Society"
hetzelfde is als Portflow-doel 485380.

We leggen die koppeling één keer vast in een bestand, met de zekerheid dat het
klopt:

```
Canvas 15973 LO1 "Responsible AI for Society"  ↔  Portflow goal 485380
```

Daarna kan het dashboard per leeruitkomst zeggen: *hier hangt bewijs aan, en de
Canvas-rubric vraagt dit ervoor.*

**Waarom dit eerst:** alle automatisering hierna leunt erop. Zonder deze
koppeling is "dekt mijn portfolio LO3?" niet te beantwoorden.

**Resultaat van fase A:** je kunt met de hand je portfolio opbouwen vanuit het
dashboard, met beschrijvingen en meervoudige LO-koppelingen, en je ziet per
leeruitkomst wat er nog mist.

---

## Fase B — De leeswijzer

Wat je straks kunt: één klik en de map heeft een leeswijzer voor de docent.

Een leeswijzer is geen lap tekst. Hij moet de docent in dertig seconden laten
zien waar hij moet kijken. Opbouw:

```
Wat zit hier
  per bewijsstuk: naam, datum, één regel wat het is
Welke leeruitkomsten dekt dit
  per LO: welk bewijs het aantoont, en op welk niveau
Hoe te lezen
  welke twee of drie stukken het belangrijkst zijn, en waarom
Wat er nog niet is
  eerlijk: welke LO nog geen bewijs heeft in deze map
```

Het laatste punt is het belangrijkste en het moeilijkste. Een leeswijzer die
doet alsof alles gedekt is, kost je in de review.

### B1. De leeswijzer-generator

Een module die uit de inhoud van een map een leeswijzer maakt. Twee bronnen:

- **wat er feitelijk staat** — namen, datums, LO-koppelingen (uit de API)
- **wat jij erover zegt** — de beschrijving per document

### B2. Beoordelen en aanpassen

De generator toont zijn werk in het dashboard, jij past aan, dan pas opslaan.
Nooit stil schrijven.

### B3. Beschrijving per document

Per bewijsstuk een korte toelichting. Voorstel doen op basis van de bestandsnaam
en de LO-koppelingen, jij corrigeert.

**Resultaat van fase B:** elke map heeft een leeswijzer die klopt en die je kunt
bijstellen.

---

## Fase C — Snapshot en inleveren

Hier zit het ene openstaande punt.

### C1. Het freeze-endpoint vinden

Eén keer een snapshot maken terwijl het netwerk wordt vastgelegd. Dan zie je het
request en is de route bekend. Dit is een aparte stap omdat het de enige is die
ik niet uit het onderzoek kon halen.

Twee manieren:
- jij klikt het in de browser, ik leg het verkeer vast
- of ik doe het via de browserinstructie, stap voor stap, met alles in beeld

### C2. De snapshot-keten in het dashboard

De vijf stappen uit de modal, maar dan als één handeling:

```
welke mappen (de drie van dit semester)
   → welke leeruitkomsten
   → welk bewijs
   → details
   → snapshot
```

Met per stap zichtbaar wat er meegaat.

### C3. Deellink en inlevering

De snapshot-deellink ophalen en koppelen aan de Canvas-opdracht. Inleveren via
de bestaande, geteste uploadketen.

**Belangrijk:** de Canvas-opdracht accepteert alleen `online_upload`, geen link.
Dus de inlevering is een bestand. Wat daar precies in moet — de snapshot als PDF,
of een document met de link — moet blijken uit de pagina "Portflow, hoe werkt
dat?" waar de opdracht naar verwijst. Die pagina staat in de Canvas-cursus en kan
ik lezen zodra we hier zijn.

### C4. Historie

Een snapshot is een bevriezing. Het dashboard laat zien: welke snapshot hoort bij
welke inlevering, en wat er sindsdien is bijgekomen.

**Resultaat van fase C:** je levert in met één handeling, en je ziet wat je
wanneer hebt ingeleverd.

---

## Fase D — Automatiseren

Pas als A tot en met C met de hand soepel werken.

Wat dan kan: een document in de inbox van het dashboard slepen, en de app:

1. bepaalt in welke map het hoort
2. stelt voor aan welke leeruitkomsten het hangt
3. schrijft een beschrijving
4. werkt de leeswijzer van die map bij
5. zegt welk bewijs nog ontbreekt voor de volgende review

Met per stap jouw goedkeuring, tot je zegt dat het zonder mag.

Daarna, zoals je zei, later: After Effects voor uitlegvideo's, en Krava. Nu niet.

---

## Volgorde en waarom

```
A1  schrijfmethodes        klein, alles hangt erop
A3  LO-koppeling           maakt "wat mis ik" mogelijk
A2  mappen in dashboard    nu wordt het bruikbaar
B   leeswijzer             het echte werk voor de docent
C1  freeze-endpoint        het enige onbekende
C2  snapshot-keten         de inlevering
D   automatiseren          als het met de hand werkt
```

A1 en A3 zijn klein en ontgrendelen de rest. Ik stel voor daarmee te beginnen.

---

## Wat ik nodig heb

1. **Akkoord op deze volgorde**, of een andere die jij beter vindt.
2. **Bij fase C1:** één keer een snapshot maken in de browser terwijl ik het
   verkeer vastleg. Dat is de enige stap waar ik jouw handeling voor nodig heb.

---

## Twee dingen die ik blijf bewaken

**De AUP van Drieam.** Ik kon de voorwaarden niet lezen (JavaScript-pagina). Wat
we doen — bewijs uploaden, beschrijvingen zetten, snapshots maken — is precies
wat de webinterface ook doet, maar het is geautomatiseerd. Dat is jouw afweging.
Het dashboard laat elke stap zien voordat hij gebeurt, zodat er niets ongezien
weggaat.

**Eerlijkheid in de leeswijzer.** Een leeswijzer die ontbrekend bewijs verbergt,
werkt tegen je. De generator zegt wat er mist, ook als dat ongemakkelijk is.
