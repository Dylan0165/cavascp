# Automatische leeruitkomst-check

Bepaalt onder welke van de zes leeruitkomsten een document valt.

`mcp/lib/leeruitkomsten.mjs` · test: `tools/test-leeruitkomsten.mjs` (33 checks)
bekijken: `node tools/toon-leeruitkomsten.mjs`

---

## De zes, met hun officiële tekst

Letterlijk overgenomen uit de Canvas-rubric van V-OL-MAIFS (cursus 15973,
opdracht 278562). Dit is wat een docent beoordeelt, dus dit is de grondslag van
de check.

| | leeruitkomst | de kern van de officiële beschrijving |
|---|---|---|
| LO1 | Responsible AI for Society | context en duurzame impact van AI vanuit meerdere perspectieven, met wetgeving en gevolgen voor de samenleving |
| LO2 | Data & Knowledge Stewardship | verantwoordelijkheid voor datakwaliteit: vinden, analyseren, voorbereiden, visualiseren volgens gevalideerde standaarden |
| LO3 | Model Interaction & Adaptation | ontwikkelen, valideren en integreren van AI-oplossingen in een gestructureerd proces, met security, privacy, ethiek en compliance |
| LO4 | Professional Standard | methodische aanpak, projectdoelen, stakeholders, toegepast onderzoek, advies, besluiten en rapportage |
| LO5 | Personal Leadership | bewust van eigen sterke en zwakke punten, keuzes op basis van kernwaarden, persoonlijke groei |
| LO6 | AI-Augmented Learning | conversationele AI gebruiken om te leren, plannen, bekritiseren en reflecteren — met grenzen en bronvermelding |

---

## Hoe het werkt

Drie signalen, elk met een eigen gewicht.

**1. Zeldzame woorden uit de officiële beschrijving.** "stakeholder" staat in één
beschrijving, "the" in alle zes. Een woord dat maar in één beschrijving staat en
wél in het document, is een sterk signaal. Dat weegt zwaarder (IDF).

**2. Kernbegrippen, gewogen naar specificiteit.** Per leeruitkomst staat een
lijst met begrippen die de kern raken. Elk begrip krijgt een gewicht op basis
van hoeveel leeruitkomsten het gebruiken: "chatgpt" staat in één lijst en weegt
vol, "data" staat in vier lijsten en weegt een kwart.

**3. Dekking**, met een plafond op het beschrijvingsdeel. Waarom dat plafond
nodig was, staat hieronder.

### Twee eisen voordat iets een treffer is

1. De score moet boven een **absolute** ondergrens zitten.
2. Er moeten **minstens twee kernbegrippen** geraakt zijn.

Die tweede eis is de belangrijkste. In een groot document komt bijna elk woord
wel een keer voor. Zonder deze eis kreeg "Personal Leadership" een treffer op
grond van het woord "reflectie" in één bijzin, en dat verscheen dan als
"22% match". Dat suggereert bewijs terwijl er niets staat.

**Eén toevallig woord is geen bewijs. Twee onafhankelijke begrippen uit dezelfde
leeruitkomst is een signaal.**

---

## Vier correcties die nodig bleken

Elk van deze kwam uit een test die eerst misging.

### 1. Specificiteit: "chatgpt" weegt zwaarder dan "analyse"

De eerste versie gaf "AI gebruiken om te leren" als Data & Knowledge
Stewardship. Oorzaak: het woord "analyse" staat toevallig in LO2's beschrijving
("sourcing, analysing, preparing"), en dat ene woord woog zwaarder dan de drie
heel specifieke begrippen chatgpt, chatbot en labels bij elkaar.

Nu weegt elk begrip naar hoeveel leeruitkomsten het gebruiken.

### 2. Samenstellingen: "reflectieverslag" bevat "reflectie"

In het Nederlands plakken we woorden aaneen. Zonder deze regel miste de check
een groot deel van de Nederlandse tekst, want juist in samenstellingen zit de
betekenis. De grens van vijf tekens voorkomt onzin: "dat" zou anders in
"database" matchen.

### 3. Dubbele stammen: "plan" en "planning" telden twee keer

LO4 had beide in de lijst, en ze stammen allebei af naar `plan`. Daardoor
voldeed die leeruitkomst makkelijker aan de tweebegrippeneis. Nu telt elke stam
één keer, met de hoogste weging.

### 4. De titel weegt extra

Een sectie die "Reflectie op het afstudeerproces" heet, is Personal Leadership
— ook als de tekst eronder over het project zelf gaat. De titel wordt daarom
herhaald meegenomen, ongeveer één keer per 1200 tekens.

---

## Wat het oplevert

Op je eigen scriptie "Van reactief naar weerbaar" (30.366 tekens):

```
  LO1  ██████████████████··   89%  Responsible AI for Society
                            via: impact, stakeholder, avg
  LO2  ████████████████████  100%  Data & Knowledge Stewardship
                            via: data, analyse, valid
  LO3  █████████████·······   64%  Model Interaction & Adaptation
                            via: train, implement, validate
  LO4  ████████████████····   82%  Professional Standard
                            via: project, method, objective, scope, stakeholder
  LO5  ████████············   38%  Personal Leadership
                            via: reflect, reflectie
  LO6  █████████████·······   66%  AI-Augmented Learning
                            via: plan, reflect
```

En per sectie zie je waar elk hoofdstuk onder valt — dus ook waar je portfolio
nog dun is.

Als ijkpunt: de lesmateriaal-pagina "Personal Leadership" van Canvas wordt
herkend als LO5, en "Data Understanding" als LO2. De check is het eens met de
docent die dat materiaal geschreven heeft.

---

## Een uitkomst die ik niet moest wegpoetsen

De sectie **"Reflectie op het afstudeerproces"** wordt door de check als
Professional Standard gezien (LO4 100%, LO5 55%), terwijl de titel Personal
Leadership belooft.

Dat is geen fout in de code. De tekst eronder gaat over de aanpak, het project
en de analyse — niet over eigen sterke en zwakke punten of kernwaarden. De check
leest wat er staat, en er staat geen persoonlijke reflectie.

**Dat is precies wat je wilt weten.** Een docent die "Reflectie" ziet staan en
dan een projectverantwoording leest, denkt hetzelfde. De check zegt het alleen
 eerder.

---

## Wat het niet doet

**Het gokt niet.** Onder de drempel zegt het "te weinig signaal" in plaats van
de minst slechte optie te kiezen. Een verkeerde koppeling in je portfolio is
erger dan geen koppeling.

**Het gebruikt geen AI.** Geen netwerk, geen API, geen sleutel. Dit is
rekenwerk dat je kunt uitleggen aan je docent: *dit document noemt impact, AVG
en stakeholder, en dat zijn de begrippen uit LO1.*

**Het is deterministisch.** Dezelfde tekst geeft altijd hetzelfde antwoord.

**Het is een voorstel, geen besluit.** De treffers komen met de geraakte
begrippen erbij, zodat je kunt zien waaróm iets matcht en het kunt overrulen.

---

## Nog te doen

De check werkt en is getest, maar zit nog niet in het dashboard. Wat er moet
komen:

1. **Per document een knop** "welke leeruitkomst?" die de treffers toont.
2. **Bij het inleveren**: automatisch de gevonden leeruitkomsten voorstellen, en
   die met één klik als Portflow-doelen zetten (`setEvidenceGoals`).
3. **Per map**: de leeswijzer vult zich met de leeruitkomsten die er echt in
   zitten, niet met wat je hoopte.

Punt 2 is de grootste winst: dan hoef je nooit meer zelf uit te zoeken welke
vakjes je aanvinkt.
