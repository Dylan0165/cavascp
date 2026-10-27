# De automatiseringslaag

Een document binnen, een voorstel eruit: waar het hoort, aan welke
leeruitkomsten het hangt, en welke toelichting erbij past.

`mcp/lib/indeler.mjs` · test: `tools/test-indeler.mjs` (25 checks)
proberen: `node tools/verdeel-document.mjs <document-id>`

---

## Hoe het kiest

Twee dingen wegen mee, en de tweede is belangrijker dan je zou denken.

### 1. Waar het over gaat

De leeruitkomst-check zegt onder welke LO's de tekst valt. Elke map heeft een
eigen profiel met onderwerpen en leeruitkomsten:

| map | waar het over gaat | leeruitkomsten |
|---|---|---|
| orientatie | verkenning, onderzoek, oefeningen: data, modellen, techniek | LO1, LO2, LO3 |
| klantproject | het project voor de opdrachtgever: plan, aanpak, oplevering | LO1, LO4, LO5 |
| Persoonlijk project | je eigen ontwikkeling: reflectie, leerdoelen, eigen onderzoek | LO5, LO6 |

### 2. Wat er mist

**Dit is de correctie die het bruikbaar maakt.** Een map waar de gevonden
leeruitkomst nog leeg is, krijgt voorrang. Zonder dat stapelt alles zich op in de
map die al vol zit en blijven de andere leeg — precies het probleem dat je bij
een review tegenkomt.

Een lege map krijgt ook een klein duwtje, anders blijft hij altijd leeg.

### Wat het niet doet

Het beslist niet. Het doet een voorstel **met de reden erbij**, en jij klikt. Bij
twijfel zegt het dat het twijfelt in plaats van de minst slechte optie te kiezen.

---

## Wat het oplevert

Op een document over data-analyse en modelvalidatie:

```
WAAR HET HOORT
   orientatie
   orientatie past het beste: noemt dataset, data, model, test; raakt LO2, LO3

   alternatieven:
      Persoonlijk project    score 0.08
      klantproject           score 0

WELKE LEERUITKOMSTEN
   [x] LO2  100%  Data & Knowledge Stewardship
   [x] LO3   61%  Model Interaction & Adaptation

TOELICHTING
   Data-analyse dataset. Dit stuk laat zien dat ik Data & Knowledge Stewardship
   en Model Interaction & Adaptation beheers. Het hoort bij orientatie.
   Ik heb de dataset opgeschoond en gevalideerd op volledigheid.

NA HET INLEVEREN
   orientatie dekt dan 6 van 6 leeruitkomsten
```

---

## De toelichting

Geen AI. Wat we zeker weten: de titel, de map, de leeruitkomsten die eraan
hangen, en de eerste bruikbare zin uit de tekst.

Dat is genoeg voor een bruikbare regel, en het is **eerlijk** — er staat niets in
wat niet klopt. Een gegenereerde samenvatting zou kunnen zeggen dat het document
iets aantoont wat er niet in staat, en dat is precies het soort claim dat je bij
een review terugkrijgt.

---

## De hele keten

```
document (werkplek of bestand)
   │
   ├─ map bepalen          onderwerp + leeruitkomsten + wat er mist
   ├─ LO's bepalen         de leeruitkomst-check
   ├─ toelichting          titel + map + LO's + eerste zin
   └─ wat er daarna mist   welke LO's die map dan nog niet dekt
            │
            ▼
   inleveren (met --doen, of via de knop in de werkplek)
```

Standaard wordt er **niets verstuurd**. `tools/verdeel-document.mjs` laat alleen
zien wat het zou doen. Met `--doen` levert het ook echt in.

---

## In het dashboard

De knop **"Waar hoort dit?"** staat bij elk document in de inbox. Eén klik en je
ziet:

```
Hoort bij Persoonlijk project
noemt reflectie, reflectieverslag, persoonlijk, leerdoel, leerdoelen
· raakt LO5 · vult hier nog LO5

[x] LO5 Personal Leadership  100%

VOORGESTELDE TOELICHTING
Reflectie op mijn ontwikkeling. Dit stuk laat zien dat ik personal leadership
beheers. Het hoort bij Persoonlijk project. Terugkijkend op deze periode zie
ik dat ik sterk ben in het analyseren van problemen…
```

De collectie wordt **voorgeselecteerd** en licht op. Versturen doe je zelf.

Wat er onder water gebeurt: `GET /api/documenten/inbox/:id/indelen` leest het
bestand, haalt de opmaakrommel eruit, bepaalt de map en de leeruitkomsten, en
stelt een toelichting voor. Er wordt niets verstuurd.

### Wat wel en niet gelezen kan worden

| type | |
|---|---|
| `.docx`, `.txt`, `.md`, `.csv`, `.json` | wel |
| `.pptx` | alleen sprekersnotities |
| `.pdf` | **niet** — daar is een echte parser voor nodig |
| afbeeldingen, zip, video | niet; daar is Krava voor |

Kan het niet, dan zegt het dat **met een reden** in plaats van een lege tekst
terug te geven. Anders kiest de indeler de verkeerde map en weet niemand waarom.

---

## Wat er nog niet is

De keten werkt en is getest. Wat ontbreekt is dat het vanzelf gaat: een bestand
in de inbox slepen en dat de app het daarna zonder vragen afmaakt.

Nu is het: slepen → op "Waar hoort dit?" klikken → controleren → op versturen
drukken. Dat is drie handelingen in plaats van één, maar je houdt de controle.

---

## Twee dingen om te weten

**De profielen zijn met de hand gezet.** Drie mappen, elk met een lijst
onderwerpen. Dat werkt voor dit semester. Komt er een semester bij met andere
mappen, dan moeten die profielen erbij — anders valt alles terug op "geen
profiel bekend".

**De indeler leest alleen tekst.** Een `.docx` met alleen plaatjes levert niets
op om op te sturen. Voor screenshots is Krava er: dat haalt de tekst uit de
beelden, en daarna werkt de indeler wel.
