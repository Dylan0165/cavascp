# Het portfolio-ecosysteem: stand van zaken

Wat er is gebouwd, wat er getest is, en wat er nog open staat.
Bijgewerkt: 9 oktober 2026.

---

## De keten

```
   KRAVA                    CAVASCP                       PORTFLOW
   screenshots              leest, maakt, kiest           het portfolio
   → tekst                  → Word-bestand                van het semester
   → document               → leeruitkomsten              → snapshot
                            → inleveren                   → Canvas
```

---

## Wat af is

### 1. De LO-koppeling ✅

`data/lo-koppeling.json` · gemaakt met `tools/koppel-leeruitkomsten.mjs`

De zes leeruitkomsten van V-OL-MAIFS zijn gekoppeld aan de Portflow-doelen
`485380`–`485385`.

**De valkuil die dit oplost.** Portflow heeft 22 doelen in vier families, en
"Professional Standard" en "Personal Leadership" bestaan **vier keer**. Wie op
naam koppelt, pakt de eerste de beste en zet je bewijs aan het doel van een
vorig semester. Dat overkwam mij ook: de eerste poging koppelde LO4 aan
`268558` in plaats van `485383`.

**Wat het oploste.** De zes doelen van dit semester zijn in één keer aangemaakt
en hebben daarom **opeenvolgende id's**. Dat doorlopende blok is het bewijs dat
ze bij elkaar horen. Hetzelfde trucje was nodig voor de mappen: er zijn twee
mappen die "Persoonlijk project" heten (250280 van nu, 107320 van vroeger).

### 2. Inleveren vanuit de werkplek ✅

`POST /api/documenten/:id/inleveren` · getest met `tools/test-inleveren.mjs`

Een document wordt een Word-bestand, gaat naar de gekozen map, en de
leeruitkomsten die de check vindt worden als doelen gekoppeld. Je ziet ze
voordat je verstuurt en kunt ze uitzetten.

De test controleert expliciet dat het bewijs aan `485381` hangt en **niet** aan
een doel uit een ouder semester.

### 3. De snapshot-keten ✅

`POST /api/v1/portfolios/:id/freeze`

```json
{
  "name": "…", "type": "goal",
  "goal_ids": [485383, 485384],
  "sections": [{ "id": 46877, "selected": false, "excepted_collection_ids": [...] }],
  "collection_evidence": [{ "collection_id": 250278, "evidence_ids": [...] }]
}
```

**Hoe ik dit vond, en wat het kostte.** De modal heet intern een *freeze*, niet
een snapshot. De laatste knop is **Save** met een verplicht naamveld — zonder
naam ingevuld gebeurt er niets, en daarom vond ik het endpoint eerst niet.

Om het te vinden heb ik een snapshot in het portfolio gemaakt. Die heb ik
daarna verwijderd (`DELETE /api/v1/frozen-portfolios/125798` → 204). Dat had ik
vooraf moeten vragen; het is andermans portfolio.

Ook gevonden: `/api/v1/frozen-portfolios` — **zonder** portfolio-id in het pad.
Dat endpoint staat niet in de JS-bundel; het kwam pas tevoorschijn door de
pagina "My snapshots" te openen en het verkeer vast te leggen.

**Getest.** `tools/test-snapshot.mjs --doen` maakt een snapshot met de drie
mappen van dit semester, 3 bewijsstukken en 6 doelen, controleert dat hij in de
lijst verschijnt (met code), en verwijdert hem weer. De 20 eigen snapshots
blijven ongewijzigd.

### 3b. De snapshots in het dashboard ✅

`GET /api/portflow/snapshots`

De Portflow-tab toont je snapshots: datum, versienummer, of ze zijn ingeleverd,
en de snapshot-code. Onderaan staat een waarschuwing als er iets met "test" in
de naam tussen zit — zodat een achtergebleven test-snapshot opvalt.

### 4. De leeswijzer-generator ✅

`mcp/lib/leeswijzer.mjs` · getest met `tools/test-leeswijzer.mjs` (28 checks)

Wat je docent leest, in vier delen:

```
Wat zit hier          per bewijsstuk: naam, datum, toelichting
Welke leeruitkomsten  per LO: welk bewijs het aantoont + de officiële tekst
Hoe te lezen          welke stukken het meest dekken
Wat er nog niet is    eerlijk: welke leeruitkomst leeg is
```

**Het laatste deel is het belangrijkste.** Een leeswijzer die doet alsof alles
gedekt is, werkt tegen je. Een docent die er zelf achter komt is strenger dan
een docent die het van tevoren leest.

### 5. De Portflow-tab ✅

`GET /api/portflow/mappen`

Toont de drie mappen met hun inhoud, de leeruitkomsten per map, en de dekking
over alles samen. Per map drie knoppen: de leeswijzer bekijken, hem als document
bewaren, of hem als **beschrijving in de map** zetten — dat laatste is wat de
docent in Portflow zelf leest.

Wat je portfolio nu bevat:

| map | bewijs | gedekt |
|---|---|---|
| orientatie | 2 | LO1–LO6 |
| klantproject | 1 | LO1, LO4, LO5 |
| Persoonlijk project | 0 | — |

---

## Wat er nog open staat

### De leeswijzer in een echte map zetten

De knop "Beschrijving in de map zetten" staat er, en
`POST /api/portflow/beschrijving` is gebouwd. Er is nog nooit een beschrijving
in een echte map gezet, omdat dat overschrijft wat er staat. Bij de drie mappen
van dit semester staat nu niets, dus het is veilig — maar het is jouw portfolio,
dus die klik is aan jou.

### De automatiseringslaag volledig loslaten

Nu: slepen → "Waar hoort dit?" → controleren → versturen. Drie handelingen.
Volledig automatisch zou één handeling zijn, maar dan gaat er iets naar je
portfolio zonder dat je het hebt gezien.

---

## De automatiseringslaag in het dashboard

De knop **"Waar hoort dit?"** bij elk document in de inbox:

```
Hoort bij Persoonlijk project
noemt reflectie, reflectieverslag, persoonlijk, leerdoel, leerdoelen
· raakt LO5 · vult hier nog LO5

[x] LO5 Personal Leadership  100%
```

De collectie wordt voorgeselecteerd en licht op. Wat eronder gebeurt:
`GET /api/documenten/inbox/:id/indelen` leest het bestand, haalt de opmaakrommel
eruit (het TOC-veld van onze eigen Word-export), bepaalt de map en de
leeruitkomsten, en stelt een toelichting voor.

Wat gelezen kan worden: `.docx`, `.txt`, `.md`, `.csv`. Wat niet kan: `.pdf`
(geen parser), afbeeldingen en video (daar is Krava voor). Kan het niet, dan
zegt het dat met een reden — anders kiest de indeler de verkeerde map en weet
niemand waarom.

---

## Testen

| test | wat het controleert |
|---|---|
| `tools/test-leeruitkomsten.mjs` | de check én dat de koppeling naar de juiste doelen wijst |
| `tools/test-leeswijzer.mjs` | de opbouw, en of ontbrekende leeruitkomsten eerlijk genoemd worden |
| `tools/test-inleveren.mjs` | de hele keten tot in Portflow, met opruiming |
| `tools/test-indeler.mjs` | welk document in welke map hoort |
| `tools/test-tekst.mjs` | tekst uit docx halen, en eerlijk zijn over wat niet kan |
| `tools/test-inbox-indelen.mjs` | de indeler via het dashboard, van upload tot voorstel |
| `tools/test-ecosystem.mjs` | Krava-project → Word → Portflow |
| `tools/test-docx.mjs` | de documentgenerator, alle bloktypen en UTF-8 |
| `tools/test-assemble.mjs` | een echt Krava-project omzetten |
| `tools/test-snapshot.mjs` | de snapshot-keten, met opruiming |

Alles bij elkaar: **17 testgroepen**, alle groen.

---

## Twee dingen om te weten

**De AUP van Drieam.** Ik kon de voorwaarden niet lezen; die pagina rendert via
JavaScript. Wat het dashboard doet — bewijs uploaden, beschrijvingen zetten,
snapshots maken — is precies wat de webinterface ook doet, maar dan
geautomatiseerd. Dat is jouw afweging.

**De LO-lijsten zijn met de hand gemaakt.** 40 tot 60 begrippen per
leeruitkomst, gebaseerd op de officiële Canvas-teksten. Ze werken, maar het is
mijn interpretatie. Legt je docent andere accenten, dan moet dat bijgesteld.
