# Het stage-ecosysteem

Alles wat er is, en wat er nog bij moet. De vraag is niet "welke functies zijn
leuk", maar "wat maakt de kans groter dat Dylan in februari 2027 op een goede
stageplek zit".

```
                    ┌──────────────────────────────┐
                    │        Canvas (S5)           │
                    │  portfolio · leeruitkomsten  │
                    └──────────────┬───────────────┘
                                   │
   ┌───────────┐   ┌───────────┐   ▼   ┌────────────┐   ┌───────────┐
   │  VINDEN   │──►│BEOORDELEN │──────►│  SCHRIJVEN │──►│ VERSTUREN │
   │ OSM · lijst│   │ OV · score│       │ AI + keuring│   │  Gmail    │
   └───────────┘   └───────────┘       └────────────┘   └─────┬─────┘
                                                              │
   ┌───────────┐   ┌───────────┐   ┌────────────┐   ┌─────────▼─────┐
   │  MELDEN   │◄──│   LEZEN   │◄──│  OPVOLGEN  │◄──│   WACHTEN     │
   │ntfy · mail│   │  IMAP     │   │ na 6 dagen │   │ (status)      │
   └───────────┘   └───────────┘   └────────────┘   └───────────────┘
```

## Wat er nu staat

| Laag | Onderdeel | Bestand |
|---|---|---|
| Vinden | OpenStreetMap, eigen lijst, losse URL | `stagebot/lib/zoeken.mjs` |
| Beoordelen | reistijd met de trein (eigen dienstregeling) | `ov/lib/planner.mjs` |
| Beoordelen | afstand tot station, OV-klasse | `stagebot/lib/regio.mjs` |
| Schrijven | mail met aanknopingspunt, keuring | `stagebot/lib/mail.mjs` |
| Versturen | Gmail SMTP, daglimiet 20 | `stagebot/lib/versturen.mjs` |
| Opvolgen | na 6 dagen, maximaal 2 keer | `stagebot/lib/opvolgen.mjs` |
| Lezen | IMAP, antwoorden herkennen en koppelen | `stagebot/lib/imap.mjs`, `inbox.mjs` |
| Melden | Teams → ntfy → mail | `stagebot/lib/teams.mjs`, `ntfy.mjs` |
| Briefing | wat vraagt vandaag aandacht | `stagebot/lib/briefing.mjs` |
| Scherm | één pagina met de hele keten | `dashboard/public/stage.*` |
| MCP | Canvas-tools, OV-tools | `mcp/server.mjs`, `ov/server.mjs` |

## Wat er nog bij moet

In volgorde van opbrengst, niet van leuk.

| # | Functie | Wat het oplost | Kost |
|---|---|---|---|
| 1 | **OnStage-import** | Het officiële stagebord van Fontys: bedrijven die al een plek aanbieden. Hoogste conversie, nu nog ongebruikt. | 1 dag (login via browser) |
| 2 | **CV-generator** | Een pdf met je projecten, gegenereerd uit je profiel, als bijlage of link in de mail. | ½ dag |
| 3 | **Stagevoorstel-generator** | Fontys vraagt een stageprojectvoorstel; de bot schrijft een concept uit het bedrijf + de vier leeruitkomsten. | 1 dag |
| 4 | **Lead-score** | Niet op afstand sorteren maar op kans: stage-signaal, sector-match, reistijd, eerder stagiairs. | ½ dag |
| 5 | **Gesprek-briefer** | Bij een uitnodiging: wie zijn ze, wat vragen ze, welke projecten van jou passen, hoe kom je er. | ½ dag |
| 6 | **Antwoord-assistent** | Concept-antwoord als een bedrijf een vraag stelt; jij leest en verstuurt. | ½ dag |
| 7 | **Kansen-radar** | Wekelijks opnieuw scannen op "stage" bij bedrijven die er nog geen hadden. | ½ dag |
| 8 | **Funnel-cijfers** | Verstuurd → antwoord → gesprek → plek, per sector en afstand. Welke aanpak werkt? | ½ dag |
| 9 | **Kanaal-e-mail** | Als Teams ooit een kanaaladres geeft: meldingen daarheen in plaats van ntfy. | 1 uur |
| 10 | **Portfolio-koppeling** | Per leeruitkomst laten zien welk bewijs je hebt, met de stage als context. | 1 dag |

## De regels die overeind blijven

1. **Nooit verzinnen.** Geen project dat niet in je profiel staat, geen
   ervaring die je niet hebt.
2. **Altijd een uitweg.** Elke mail zegt dat nee ook goed is.
3. **Maximaal twintig per dag**, en liever tien goede dan twintig generieke.
4. **Twee opvolgingen, dan stoppen.** Opdringerig werven kost je adres.
5. **Jij drukt op versturen.** De bot zet klaar; de laatste klik is van jou.
