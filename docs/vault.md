# De vault

Een Obsidian-vault is een map met markdown-bestanden. Niets meer: je kunt elk
bestand ook in Kladblok openen. Obsidian is de laag eroverheen — links,
backlinks, zoeken, sjablonen.

## Waarom er één is

Het dashboard bezit de *gestructureerde* data: bedrijven, criteria, bewijs.
De vault bezit de *tekst*: reflecties, onderbouwing, feedback. Twee dingen die
elkaar aanvullen maar niet hetzelfde bestand moeten claimen.

## Structuur

```
vault/
  00 Start hier.md            kaart van de vault
  Portfolio/
    Ik en de minor.md         collectie voor de tweede review (V-OL-MAIFS)
    Klantproject.md           verslag van het klantproject
    Criteria/                 één notitie per criterium, met de rubric erin
  02 Logboek/                 wat je per dag deed
  99 Sjablonen/               sjablonen voor nieuwe notities
```

## Opnieuw genereren

```bash
node tools/vault.mjs            # maakt wat ontbreekt, laat bestaande notities staan
node tools/vault.mjs --force    # overschrijft alles (let op: eigen tekst weg)
node tools/vault.mjs --status   # wat staat er
```

## Naar je eigen laptop

In het dashboard staat rechtsboven **Vault**: dat downloadt de hele map als
`cavascp-vault.zip` (ongeveer 1,5 MB, inclusief plugins). Uitpakken, Obsidian
openen, "Open folder as vault" kiezen. Klaar.

## Plugins

Zes, bewust weinig. Elke plugin is code die volledige toegang tot je vault
heeft, dus "alles installeren" is geen goed idee.

| Plugin | Waarom |
|---|---|
| **Dataview** | Tabellen en lijsten uit je eigen notities — de startpagina vraagt ermee naar de status per criterium |
| **Templater** | Sjablonen met datum en variabelen, één sneltoets per notitie |
| **Tasks** | Checkboxes met een deadline die je overal terugziet |
| **Omnisearch** | Zoeken dat ook in PDF's en bijlagen kijkt, met relevantie |
| **QuickAdd** | Snel een taak of notitie vastleggen zonder de vault te verlaten |
| **Style Settings** | Thema-instellingen zonder CSS te schrijven |

Installeren of bijwerken:

```bash
node tools/vault-plugins.mjs            # wat ontbreekt
node tools/vault-plugins.mjs --update   # alles naar de nieuwste versie
node tools/vault-plugins.mjs --lijst    # wat staat er, en waarom
```

De plugins komen als losse bestanden van de releases op GitHub
(`main.js`, `manifest.json`, `styles.css`) en belanden in
`vault/.obsidian/plugins/<id>/`. Die map staat niet in git; het script haalt
hem zo weer op.

## Wat Obsidian zelf al kan

- **Bases** (sinds 1.9): een tabel over je notities, zonder plugin. Staat aan in
  `core-plugins.json`.
- **Dagelijkse notities**: nieuwe notities komen in `02 Logboek`.
- **Zoeken, backlinks, graaf**: standaard.

## Wat er nog bij kan

Een **MCP-server** voor de vault zou betekenen dat ik notities direct kan
lezen en schrijven in plaats van via bestanden. Nodig is het niet — deze
machine heeft gewoon toegang tot de map — maar het maakt samenwerken in
Obsidian zelf mogelijk. Iets voor na de deadline van 13 november.
