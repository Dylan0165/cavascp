# data

Hier komen de opgeslagen Canvas-gegevens.

| Pad | Wat het is | In git? |
|---|---|---|
| `portfolio_assignments.json` | Gegenereerd door `tools/build_dossier.py`. Bevat je eigen opdrachtnamen, deadlines en rubric-criteria. | nee |
| `raw/` | Ruwe API-antwoorden, weggeschreven door `tools/probe_canvas.py`. Handig bij het debuggen. Kan persoonlijke gegevens bevatten. | nee |

Beide zijn bewust niet gepubliceerd: ze komen uit jouw account en zeggen iets
over je studie. Ze worden opnieuw gemaakt zodra je de tools draait.

```bash
python tools/build_dossier.py   # vult portfolio_assignments.json en docs/portfolio-dossier.md
python tools/probe_canvas.py    # vult data/raw/
```
