# Het ecosysteem: Krava → cavascp → Portflow

Onderzoeksverslag en ontwerp. Alles hieronder is getest in de echte omgeving.

Datum: 2026-10-07

---

## Wat er nu ligt

Drie gereedschappen, één keten:

```
   KRAVA                      CAVASCP                      PORTFLOW
   screenshots                leest het project            de map van
   → tekst                    maakt het document           het semester
   → document                 stuurt het door              
   D:\DOCAto                  D:\cavascp                   portfolio.drieam.app
```

Wat je doet: in Krava maak je een document van je screenshots. In het dashboard
kies je dat project, kies je de map en de leeruitkomsten, en het document staat
in Portflow — met een toelichting erbij.

**Bewezen werkend**, van begin tot eind, met opruiming achteraf:

```
1) Krava-project lezen (direct van schijf, zonder login)
     "Van reactief naar weerbaar" (30201 tekens)
2) Word-bestand maken
     99886 bytes, 28 secties
3) Naar Portflow sturen
     bewijs aangemaakt in Portflow — evidence 2184867
4) Teruglezen uit Portflow
     staat in de map · toelichting bewaard · gekoppeld aan Professional Standard
5) Opruimen
     verwijderd · map is weer leeg
```

---

## De belangrijkste vondst: geen login nodig

Krava werkt met accounts. Zodra er gebruikers bestaan, geven alle
API-endpoints **401** zonder sessie. Er is geen accountvrije stand.

In plaats van aan Krava's authenticatie te tornen, doet het dashboard iets
beters: **het leest de projecten rechtstreeks van schijf.**

Krava bewaart elk project als één JSON-bestand in `data/projects/`. Daar staat
alles in: de titel, de secties, de tekst als Markdown, de huisstijl, de
bronnen. Het dashboard leest dat bestand en maakt zelf het Word-document — met
dezelfde generator die Krava gebruikt.

Wat dat oplevert:

| | |
|---|---|
| geen wachtwoord nodig | het dashboard hoeft niet in te loggen |
| geen sessie die verloopt | er is niets om te verlopen |
| Krava hoeft niet te draaien | je kunt een document maken zonder de app te starten |
| één bron van waarheid | het bestand op schijf is wat Krava zelf ook gebruikt |

De HTTP-route naar Krava zit er ook in (`krava.mjs`), met het starten van de
app, maar is **niet nodig** voor het maken van documenten. Hij is er voor later,
bijvoorbeeld om vanuit het dashboard een nieuw Krava-project te beginnen.

---

## Wat er is overgezet

Krava's documentgenerator is 91 kB code zonder afhankelijkheden. Die is
overgezet in plaats van nagebouwd — duizend regels opmaakcode overtikken is
vragen om fouten.

| bestand | regels | wat het doet |
|---|---|---|
| `mcp/lib/zip.mjs` | 120 | ZIP schrijven, met de hand. Enige afhankelijkheid van de generator. |
| `mcp/lib/docx.mjs` | 991 | Word: omslag, inhoudsopgave, koppen, lijsten, tabellen, callouts, code, figuren met nummering |
| `mcp/lib/pptx.js` → `pptx.mjs` | 1015 | PowerPoint, inclusief sprekersnotities |
| `mcp/lib/markdown.mjs` | 223 | Markdown naar blokken |
| `mcp/lib/assemble.mjs` | 250 | Het plan platslaan, blokken maken, huisstijl omzetten |

Het overzetten gebeurt **automatisch** met `tools/port-krava.mjs`. Dat script
kiest de imports, zet `module.exports` om naar `export`, en klaagt als er een
afhankelijkheid overblijft die het niet kent. Verandert Krava, dan draai je het
opnieuw en is het dashboard weer gelijk.

De overgezette bestanden hebben een kop die zegt dat je ze niet met de hand
moet aanpassen. Dat is geen formaliteit: anders lopen de twee uit elkaar en
krijg je een document dat er in het dashboard anders uitziet dan in Krava.

---

## De vorm van een Krava-project

Wat ik onderweg tegenkwam, want dit kostte de meeste tijd:

```
project
├── titel, subtitel, auteur, instelling, opleiding, vak, begeleiders
├── huisstijl        → accent, kop2, kop3, fontTekst, kopGrootte, logoNaam
├── opties           → omslag, inhoudsopgave, paginanummer, marges
├── afbeeldingen[]
├── bronnen[]
└── plan
    └── secties[]              ← een BOOM, niet een lijst
        ├── titel, niveau, tekst (Markdown), status
        └── subsecties[]       ← zelfde vorm, een niveau dieper
```

Vijf dingen die me een testronde kostten:

**1. De generator wil `project.secties`, niet `project.plan.secties`.** Het plan
is een boom; de generator wil een platte lijst. `assemble.mjs` doet dat.

**2. Blokken gebruiken Engelse veldnamen: `type`, niet `soort`.** En de
ondersteunde typen zijn: `heading`, `subheading`, `paragraph`, `code`,
`callout`, `table`, `list`, `figure`, `hr`.

**3. Lijst-items zijn objecten, geen strings.** `{tekst, niveau, genummerd}`.
Geef je een string, dan crasht het renderen en **verdwijnt de hele sectie
stil** — geen foutmelding.

**4. Een `tekst`-veld op een sectie wordt niet gerenderd.** De Markdown moet
eerst door `ontleed()` naar blokken. Dat gebeurt in Krava's server, niet in de
generator.

**5. `bouwDocx` geeft geen Buffer maar `{buffer, statistiek}`.** De statistiek
vertelt hoeveel secties en figuren erin zitten — handig om te controleren.

---

## Wat Portflow accepteert

Getest door alleen een uploadplek aan te vragen:

| toegestaan | geweigerd |
|---|---|
| `.docx .pdf .pptx .doc .xlsx .png .jpg .txt .md .zip .mp4` | `.link` |

**Een Word-document kan rechtstreeks naar Portflow.** Dat was de belangrijkste
vraag: er is geen PDF-omzetting nodig, en die is er op deze machine ook niet
(geen LibreOffice).

Dat is goed nieuws, want het scheelt een schakel die had kunnen breken. Krava
maakt `.docx`, Portflow neemt `.docx`, klaar.

---

## De keten in het dashboard

Wat er nu is:

```
mcp/lib/krava.mjs
  kravaStatus()                 draait Krava, en mogen we erbij?
  kravaProjectenVanSchijf()     alle projecten lezen, zonder login
  kravaProjectVanSchijf(id)     één project
  kravaExportDocx(id)           via HTTP, als Krava draait en je ingelogd bent
  kravaNaarPortflow({...})      de hele keten in één aanroep

mcp/lib/assemble.mjs
  projectNaarDocx(project)      Krava-project → Word
  projectNaarPptx(project)      Krava-project → PowerPoint
  projectTekst(project)         alle tekst, voor zoeken en controleren

browser/portflow.mjs
  addFileEvidence({...,description})   uploaden met toelichting
  setCollectionDescription(id, tekst)  de leeswijzer van een map
  setEvidenceDescription(id, tekst)    toelichting bij één document
  setEvidenceGoals(id, goalIds[])      koppelen aan leeruitkomsten
  addEvidenceGoal(id, goalId)          er één bijzetten, zonder verlies
  evidenceGoals(id) / evidenceCollections(id)
```

### Waar het nog niet zit

**De gebruikersinterface.** De keten werkt vanaf de opdrachtregel en is
volledig getest, maar je kunt nog niet in het dashboard op een knop drukken.
Dat is de volgende stap: een tab "Documenten" waarin je je Krava-projecten
ziet, er één kiest, de map en de leeruitkomsten aanwijst, en op versturen
drukt.

**De leeswijzer per map.** De route werkt
(`setCollectionDescription` → 204), maar er is nog geen generator die de tekst
maakt.

**De snapshot.** Nog steeds het ene ontbrekende endpoint; zie
`docs/portflow-werking.md`.

---

## Twee dingen om te weten

**De generator is een kopie, geen verwijzing.** Als je in Krava iets aan de
opmaak verandert, verandert het dashboard niet mee tot je `port-krava.mjs`
opnieuw draait. Dat is bewust — het dashboard moet kunnen werken als Krava er
niet is — maar het is wel iets om te onthouden.

**Krava's app openen vanuit het dashboard vraagt een login.** De app zelf
(`http://127.0.0.1:4319/app`) werkt gewoon, maar je moet inloggen met je eigen
account. Het dashboard heeft dat niet nodig: het leest de projecten van schijf.

---

## Testen

| test | wat het controleert |
|---|---|
| `tools/test-docx.mjs` | 34 checks: Word en PowerPoint, UTF-8, alle bloktypen |
| `tools/test-assemble.mjs` | een echt Krava-project → Word, koppen en bronnen erin |
| `tools/test-ecosystem.mjs` | de hele keten tot in Portflow, met opruiming |
| `browser/probe-portflow-types.mjs` | welke bestandstypen Portflow accepteert |

`test-ecosystem.mjs` stuurt echt iets naar Portflow en **ruimt het daarna op**,
ook als er onderweg iets misgaat. Een test die troep achterlaat in je portfolio
is geen test.
