# Portflow — hoe het werkt en hoe we het automatiseren

Onderzoeksverslag. Alles hieronder is waargenomen in de echte omgeving
(portfolio `22253`, gebruiker `6993`), niet aangenomen.

Datum: 2026-10-07

---

## 1. De bouwstenen

Portflow kent vier dingen die er toe doen.

### Collectie = map

Twaalf stuks. De bovenste drie zijn van dit semester:

| id | naam | kleur | bewijs | doelen | beschrijving |
|---|---|---|---|---|---|
| 250278 | orientatie | `#009688` groen | 0 | 6 | leeg |
| 250279 | klantproject | `#8bc34a` lichtgroen | 1 | 6 | leeg |
| 250280 | Persoonlijk project | `#ff9800` oranje | 0 | 6 | leeg |
| 193242 | S4 Cyber | `#f44336` | 6 | 4 | 36.045 tekens |
| 150321 | Oefeningen / Challenges | `#4caf50` | 14 | 6 | 14.049 tekens |
| 107318–107321 | Reflecties, Proftaak, Persoonlijk project, Individuele opdrachten | | 65 | 1–6 | ~27.300 tekens |
| 123463 | Sprint 2 | | 0 | 0 | leeg |

Velden per collectie:
`id, name, subtitle, description, color, hidden, position, section_id,
goals_count, evidence_count, banner_position_data, preferred_view,
total_evidence_duration, last_import`

**`description` is de leeswijzer.** De oude mappen hebben er een van 27.000
tekens; de drie nieuwe zijn leeg. Daar moet jouw leeswijzer komen.

### Goal = leeruitkomst

22 stuks, in vier families. Dat is de valkuil:

| familie | ids | namen | gebruikt door |
|---|---|---|---|
| **MAIFS** (huidig) | 485380–485385 | Responsible AI for Society, Data & Knowledge Stewardship, Model Interaction & Adaptation, Professional Standard, Personal Leadership, AI-Augmented Learning | **de drie mappen van dit semester** |
| S4 Cyber | 371436–371439 | LO1: Offensive Security … LO4: Personal Leadership | map S4 Cyber |
| Semester 2 infra | 268553–268558 | Leeruitkomst 1: Professional standard … | Oefeningen, Proftaak |
| Ouder | 169808–169813 | PS-1, PL-1, Provisioning & Connecting … | Reflecties, Proftaak |

De drie bovenste mappen hangen elk aan **alle zes MAIFS-doelen**
(`goals_count: 6`). De oude mappen hangen aan de oude families.

> **Belangrijk voor het dashboard:** een bewijsstuk dat aan "Professional
> Standard" hangt kan aan goal `485383` (MAIFS, nu) hangen óf aan `268553`
> (Semester 2, oud). Zelfde naam, ander doel. De dekking moet dus op **goal-id**
> rekenen, niet op naam.

### Evidence = bewijsstuk

Velden:
`id, portfolio_id, name, description, feedback_status, created_at, updated_at,
versions_count, goals_count, collections_count, date, location, duration,
latest_version_type, last_version_number, latest_version`

Het bewijsstuk heeft **een eigen `description`** — dat is de toelichting per
document die je wilt. `latest_version.files[]` bevat het bestand zelf.

### Portfolio freeze = snapshot

De vijf stappen in de modal:

```
1 Select goals   2 Select collections   3 Select evidence   4 Add details   5 Done
```

Twee modi:

- **Goal-based** — doelen kiezen → collecties → bewijs. *"Goals related to the
  collections will be included in the snapshot as well."*
- **Collection-based** — collecties kiezen → bewijs.

Er is een `…/pending-freezes` dat `{"has_pending": false, "last_failed": null}`
teruggeeft: het maken gebeurt dus als achtergrondtaak.

---

## 2. Wat wel en niet kan via de API

| Handeling | Route | Status |
|---|---|---|
| Collecties lezen | `GET /portfolios/:p/collections` | **werkt** |
| Collectie-beschrijving zetten | `PATCH`/`PUT /portfolios/:p/collections/:c` | **werkt** → 204 |
| Bewijs lezen | `GET /portfolios/:p/evidence/:e` | **werkt** |
| Doelen van bewijs lezen | `GET /portfolios/:p/evidence/:e/goals` | **werkt** |
| Collecties van bewijs lezen | `GET /portfolios/:p/evidence/:e/collections` | **werkt** |
| Bewijs uploaden | 3 staps (direct-uploads → S3 → evidence) | **werkt** |
| Bewijs verwijderen | `DELETE /portfolios/:p/evidence/:e` | **werkt** → 204 |
| Snapshot-doelen | `GET /portfolios/:p/portfolio-freezes/goals` | **werkt** |
| Snapshot-secties | `GET /portfolios/:p/portfolio-freezes/sections` | **werkt** |
| Snapshot-bewijs per collectie | `GET /portfolios/:p/portfolio-freezes/collections/:c/evidence` | **werkt** |
| Openstaande snapshot | `GET /portfolios/:p/pending-freezes` | **werkt** |
| Snapshot **aanmaken** | — | **niet gevonden** |

Over dat laatste: ik heb 195 bundels doorzocht. De routes die erin staan zijn
allemaal `GET`-varianten voor de keuzestappen. Er is geen POST-route voor het
aanmaken in de bundel te vinden, en `POST /portfolio-freezes` geeft 404.

Dat betekent niet dat het onmogelijk is, maar wel dat het aanmaken waarschijnlijk
via een andere route of een achtergrondtaak loopt die ik nog niet heb gezien.
**Dit is het enige openstaande punt.** Het is op te lossen door één keer met de
hand een snapshot te maken terwijl het netwerk wordt vastgelegd — dan zie je het
request. Daar is jouw klik voor nodig, of ik doe het met de browserinstructie.

---

## 3. De Canvas-kant

De opdracht vraagt (letterlijk uit de opdrachtbeschrijving):

> *"Plak hier een snapshot van je portfolio. Zie voor meer informatie over
> Portflow en het inleveren van een snapshot de pagina Portflow, hoe werkt dat?"*

Dus: **de inlevering bij Canvas is een snapshot**, en de tekst zegt "plak hier"
— wat wijst op een link of een tekstvak.

Wat Canvas accepteert bij deze opdracht:

| | |
|---|---|
| inlevervorm | `online_upload` |
| pogingen | `-1` (onbeperkt) |
| vergrendeld | nee |
| rubric | 6 criteria, 4 niveaus, 4 punten per criterium |

De rubric-criteria zijn exact de zes MAIFS-leeruitkomsten. Dat sluit aan op de
zes doelen in de drie mappen.

### Twee manieren om in te leveren

Canvas ondersteunt bij deze opdracht alleen `online_upload`. Dus:

1. **Bestand uploaden** — werkt, getest. Drie stappen: uploadplek aanvragen →
   bestand sturen → file-id melden als inlevering.
2. **Link plakken** — `online_url` staat *niet* in de lijst, dus dat kan hier
   niet. Tenzij de opdracht het toelaat; dat is per opdracht verschillend.

Belangrijk: het uploaden moet via `POST /api/v1/users/self/files`, niet via het
opdracht-specifieke endpoint. Dat laatste hanteert de extensie-whitelist van de
opdracht en weigerde `.docx` bij INTERN5 terwijl het bij MAIFS wel werkte.

---

## 4. De keten die geautomatiseerd moet worden

```
bewijsstuk in een map
   │
   ├─ beschrijving per document        → PATCH evidence  (description)
   ├─ koppelen aan 1..6 leeruitkomsten → goals op evidence
   └─ leeswijzer per map               → PATCH collectie (description)
                    │
                    ▼
            snapshot maken (freeze)
            stap 1 doelen → 2 collecties → 3 bewijs → 4 details → 5 klaar
                    │
                    ▼
            deellink van de snapshot
                    │
                    ▼
            inleveren bij Canvas
```

---

## 5. Wat dit betekent voor het dashboard

De drie mappen zijn leeg op één bewijsstuk na. De doelen hangen al goed: elke
map aan alle zes MAIFS-LO's. Dus de infrastructuur staat, alleen de inhoud nog.

Wat het dashboard moet kunnen:

1. **Per map tonen** wat erin zit, hoeveel bewijs, en of er een leeswijzer is.
2. **Per bewijsstuk** de LO-koppelingen tonen en kunnen wijzigen — meerdere
   tegelijk, want dat is hoe Portflow werkt.
3. **Een leeswijzer genereren** uit de inhoud van de map: wat zit erin, welke
   LO's dekt het, waar moet de docent kijken.
4. **Een beschrijving per document** genereren of overnemen.
5. **De snapshot-keten** starten en de deellink teruggeven.
6. **Inleveren bij Canvas** met de bestaande, geteste upload-keten.

Punt 1 tot 4 zijn nu volledig te bouwen. Punt 5 wacht op het ene ontbrekende
endpoint. Punt 6 is klaar.

---

## 6. Risico's en keuzes

**De AUP van Drieam.** Ik kon de gebruiksvoorwaarden niet volledig lezen — die
pagina rendert via JavaScript en gaf geen tekst terug. Automatisch uploaden en
snapshots maken raakt hun diensten. Dit is jouw afweging, niet iets wat ik voor
je kan wegnemen. Wat ik wel kan: het dashboard laat elke stap zien voordat hij
gebeurt, zodat er niets ongezien gebeurt.

**De zes doelen versus de rubric.** De rubric bij Canvas gebruikt dezelfde zes
namen. Als de dekking op goal-id rekent, klopt het met Portflow; als hij op naam
rekent, mengt hij oude en nieuwe semesters. Dat is precies de fout die ik bij de
criteria al tegenkwam.

**Snapshots zijn onveranderlijk.** Een snapshot is een bevriezing op een moment.
Opnieuw inleveren betekent een nieuwe snapshot, niet de oude aanpassen. Het
dashboard moet dat laten zien: welke snapshot hoort bij welke inlevering.
