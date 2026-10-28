# OV: reistijden uit eigen data

Een stagezoektocht gaat over bereikbaarheid. Een bedrijf in Breda is
tweeëntwintig kilometer van Roosendaal, maar met de trein ben je er in achttien
minuten — en een bedrijf in een dorp zonder station kan dichterbij zijn en toch
slechter te bereiken.

Daarom rekent het project de reis zelf uit, op een eigen kopie van de
dienstregeling.

```
GTFS (open data)  →  ov/import.mjs  →  data/ov/net.json  →  planner  →  reistijd
```

## Waarom niet de NS-API

De NS-API werkt met een sleutel die je via een portaal moet aanvragen, en dat
portaal kwam er niet uit. Open data is er ook: **OVapi** publiceert elke dag een
GTFS-bestand met de volledige dienstregeling van alle vervoerders in Nederland.
Geen sleutel, geen account, geen aanvraaglimiet.

De prijs is formaat: 213 MB zip met een `stop_times.txt` van vijftien miljoen
regels. Dat lees je één keer in, en daarna niet meer.

## Eenmalig inlezen

```bash
node ov/import.mjs
```

Wat er gebeurt:

| Stap | Wat |
|---|---|
| downloaden | ± 200 MB van `gtfs.ovapi.nl`, ongeveer 40 seconden |
| inpakken | het zip-bestand wordt gelezen zonder pakketten, met zlib |
| filteren | alleen treinroutes (`route_type=2`) |
| bijsnijden | alleen reizen die binnen 45 km van Roosendaal komen (`--alles` houdt heel Nederland) |
| wegschrijven | `data/ov/net.json`, ± 3 MB |

Uitkomst van de laatste run: **8.005 treinreizen, 497 haltes, 176 routes**.
Het bestand wordt niet in git bewaard (`data/ov/` staat in `.gitignore`) — je
maakt het op elke machine opnieuw met één commando.

Opnieuw doen hoeft pas bij een nieuwe dienstregeling (twee keer per jaar), of
als je een halte mist.

## Hoe de reis berekend wordt

`ov/lib/planner.mjs` zoekt in de dienstregeling:

1. **de dag** — standaard de volgende werkdag. Een zaterdagdienstregeling zegt
   niets over of je er kunt komen werken.
2. **de haltes** — een station heeft vaak meerdere perrons; die horen bij elkaar.
3. **de reizen** — elke trein die je vanaf de vertrekhalte kunt pakken, binnen
   drie uur na je vertrektijd (standaard 08:30).
4. **overstappen** — per trein wordt elke tussenhalte bekeken: is er binnen
   twee minuten een aansluiting naar de bestemming?
5. **de drie vroegst aankomende opties**, zonder dubbelen.

Geen volledige RAPTOR: dat is nodig voor het hele land inclusief bussen. Voor
een treinreis met hooguit één overstap is dit genoeg, en het antwoord is in
milliseconden.

## De MCP-server

`ov/server.mjs`, in het DSH-profiel als `mcp-ov`:

| Tool | Waarvoor |
|---|---|
| `ov_reisadvies` | van A naar B, met tijden, overstappen en de treinen |
| `ov_reistijd` | de snelste reistijd in één regel |
| `ov_stations` | stations zoeken |
| `ov_status` | is er een dienstregeling ingelezen? |

## Onze eigen API

Het dashboard serveert dezelfde planner:

| Route | Wat |
|---|---|
| `GET /api/ov/reis?van=Roosendaal&naar=Breda&vertrek=08:30` | reisopties |
| `GET /api/ov/stations?q=breda` |stations zoeken |
| `GET /api/ov/status` | wat er ingelezen is |

Alles achter dezelfde sessiecookie als de rest van het dashboard.

## Vanaf de commandoregel

```bash
node ov/cli.mjs reis Roosendaal Tilburg --om 08:30
node ov/cli.mjs reistijd Breda
node ov/cli.mjs stations breda
node ov/cli.mjs status
node ov/cli.mjs import
```

En in de stagebot:

```bash
node stagebot/cli.mjs ov daemen-ict    # één bedrijf opnieuw
node stagebot/cli.mjs ov --alles       # alle bedrijven
```

## In het stage-scherm

Na het scannen van een bedrijf vraagt de stagebot de reistijd op vanaf jouw
station (`stage.ovVan` in je profiel, standaard Roosendaal) naar het station bij
dat bedrijf. Dat staat als `🚆 18 min` naast de OV-chip, en in het detail als
`Roosendaal → Breda: 18 min, 0 overstappen`.

Uitkomsten worden zeven dagen bewaard (`data/stagebot/cache/reistijden.json`),
want een dienstregeling verandert niet per dag.

## Wat het niet doet

- **Alleen trein.** Bus, tram en metro zitten niet in de berekening. De laatste
  kilometers staan er apart bij als afstand tot het station.
- **Geen live storingen.** De dienstregeling is een plan, geen werkelijkheid.
  Voor live data is er een aparte module (`mcp/ns/`) die de NS-API gebruikt —
  die werkt alleen met een sleutel en is daarom niet gekoppeld.
- **Nederland.** Belgische haltes ontbreken, dus een bedrijf over de grens
  levert "geen reis gevonden" op.
- **Geen spoorinformatie.** GTFS weet het perron niet; de reis zegt alleen
  welke trein en hoe laat.

## Testen

```bash
node ov/test-ov.mjs
```

24 checks op een nagemaakte dienstregeling met vier haltes: directe reis,
overstap, te late aankomst, een dag zonder dienst, onbekende bestemming en de
tijdnotatie. Geen GTFS-bestand nodig, geen netwerk.
