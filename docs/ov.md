# OV: reistijden met de trein

De stagezoektocht gaat over bereikbaarheid. Een bedrijf in Breda is tweeëntwintig
kilometer van Roosendaal, maar met de trein ben je er in een kwartier — en een
bedrijf in een dorp zonder station kan dichterbij zijn en toch slechter te
bereiken. Daarom haalt de stagebot de echte reistijd op bij de NS.

```
Roosendaal  →  station bij het bedrijf  →  lopen of fietsen
   (trein)          (NS-API)                 (km, uit OSM)
```

## Een sleutel aanvragen

1. Maak een account op <https://apiportal.ns.nl>.
2. Neem het **gratis product "Ns-App"**.
3. Kopieer de **Primary key**.
4. Zet hem in `.env`:

   ```
   NS_SUBSCRIPTION_KEY=...
   ```

Zonder sleutel werkt alles behalve de reistijden: het stage-scherm valt dan
terug op de afstand tot het station. Er wordt niets verzonnen en er verschijnt
geen "0 minuten".

## Wat er opgevraagd wordt

| Endpoint | Waarvoor |
|---|---|
| `/reisinformatie-api/api/v3/trips` | reisadvies: duur, overstappen, sporen |
| `/reisinformatie-api/api/v2/departures` | de volgende treinen vanaf een station |
| `/reisinformatie-api/api/v2/stations` | stations zoeken op naam of code |
| `/reisinformatie-api/api/v3/disruptions` | storingen en werkzaamheden |

Alles met de header `Ocp-Apim-Subscription-Key`. De client staat in
[`mcp/ns/lib/client.mjs`](../mcp/ns/lib/client.mjs) en peltt de verpakking eraf:
het ene endpoint levert `{ trips: [...] }`, het andere
`{ payload: { departures: [...] } }`. De rest van het project ziet één vorm.

## De MCP-server

`mcp/ns/server.mjs` is een eigen MCP-server, los van cavascp: andere bron,
andere sleutel, ander ritme. Hij staat in het DSH-profiel als `mcp-ns`, dus je
kunt er in de chat bij:

| Tool | Waarvoor |
|---|---|
| `ns_reisadvies` | van A naar B, met tijden en overstappen |
| `ns_reistijd` | de snelste reistijd in één regel |
| `ns_storingen` | wat er mis is, eventueel rond een station |
| `ns_vertrektijden` | de volgende treinen vanaf een station |
| `ns_stations` | stations zoeken |
| `ns_status` | werkt de koppeling? |

De tools geven tekst terug (markdown), geen JSON — dat leest prettiger in de
chat en in de CLI.

## Vanaf de commandoregel

```bash
node mcp/ns/cli.mjs status
node mcp/ns/cli.mjs reis Roosendaal Breda --om 08:30
node mcp/ns/cli.mjs reistijd Breda
node mcp/ns/cli.mjs vertrek Breda --richting Roosendaal
node mcp/ns/cli.mjs storingen --station Breda
node mcp/ns/cli.mjs stations breda
```

En in de stagebot:

```bash
node stagebot/cli.mjs ov daemen-ict    # reistijd opnieuw opvragen
```

## Reistijd in het stage-scherm

Na het scannen van een bedrijf vraagt de stagebot de reistijd op vanaf jouw
station (`stage.ovVan` in je profiel, standaard Roosendaal) naar het station bij
dat bedrijf. Dat gebeurt met de **volgende werkdag om 08:30**, niet met "nu":
je zoekt een stage, geen trein van vanavond.

De uitkomst staat in het scherm als `🚆 26 min · 1× over` naast de OV-chip, en
in het detail als `Roosendaal → Breda: 26 min, 1 overstap`.

Wat er gecachet wordt:

| Wat | Hoe lang | Waarom |
|---|---|---|
| stations (OSM/Overpass) | 7 dagen | er komt zelden een station bij |
| reistijden per station-paar | 7 dagen | dienstregelingen veranderen twee keer per jaar |
| NS-antwoorden (MCP) | 2 uur | storingen veranderen per uur |

## Wat dit niet is

- **Alleen de trein.** Bus, tram en de OV-fiets zitten er niet in; de laatste
  kilometers staan er apart bij als afstand tot het station.
- **Geen live reisplanner voor onderweg.** De storingstool is er wel, maar de
  mail gaat over een stage, niet over een gemiste aansluiting.
- **Geen garantie.** De NS-API is een dienst van een ander; ligt hij eruit, dan
  blijft de reistijd leeg en zie je de kilometer-aanduiding.

## Testen

```bash
node mcp/ns/test-ns.mjs
```

19 checks tegen een nepserver die dezelfde paden beantwoordt: reisadvies
uitlezen, overstappen tellen, vertraging berekenen, filteren op station en
richting, en een 401 die een duidelijke fout moet geven. Er gaat geen enkele
aanvraag naar de echte NS en je hebt er geen sleutel voor nodig.
