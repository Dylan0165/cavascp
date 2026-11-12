---
tags:
  - index
---
# Start hier

Dit is de vault van Dylan. Het is een map met markdown-bestanden — niets meer,
niets minder. Alles wat je hier schrijft kun je ook lezen zonder Obsidian.

## Waar staat wat

| Map | Wat |
|---|---|
| [[Portfolio/Ik en de minor]] | De collectie voor de tweede review |
| [[Portfolio/Klantproject]] | Het verslag van het klantproject |
| `Portfolio/Criteria/` | Eén notitie per beoordelingscriterium, met de rubric erin |
| `Logboek/` | Wat je per dag deed. Handig voor je reflectie achteraf |
| `99 Sjablonen/` | Sjablonen voor nieuwe notities |

## Wat er morgen af moet
- [ ] [[Portfolio/Ik en de minor]] afmaken
- [ ] [[Portfolio/Klantproject]] afmaken
- [ ] Bewijs per criterium linken in Portflow (met @)
- [ ] Snapshot maken en inleveren

## Cijfers

```dataview
TABLE status, length(file.inlinks) AS "keer gelinkt"
FROM "Portfolio/Criteria"
SORT volgorde ASC
```

## Openstaande taken

```tasks
not done
path includes Portfolio
sort by due
```
