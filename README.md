# cavascp

Drie onderdelen, op één analyse-laag:

- een **lokaal dashboard** — je portfolio en je documenten in de browser
- een **MCP-server** — vraag het vanuit de chat
- een **Portflow-brug** — zet een document met één klik in je portfolio

Canvas wordt volledig automatisch gelezen met een persoonlijk API-token.
Portflow gaat via een echte browser, omdat daar geen publieke API voor is.

## Dashboard

```bash
cd dashboard
node server.mjs          # http://127.0.0.1:8787
```

Of dubbelklik `dashboard/start.cmd`.

Wat je ziet:

- **Kerncijfers** bovenaan: te laat, binnen 7 dagen, nog open, criteria zonder bewijs.
- **Tijdlijn** van portfolio-deadlines, standaard de komende 90 dagen. Elke kaart
  toont de deadline, de cursus, de leeruitkomsten en hoeveel criteria eraan hangen.
- **Criteria-paneel** rechts: per beoordelingscriterium of er bewijs is, met een
  balk die de dekking toont. Je kunt een criterium afvinken als je het zelf
  afgehandeld vindt.
- **Details** per opdracht in een zijpaneel: omschrijving, alle rubric-criteria
  met niveaus, ingeleverd werk, en een notitieveld.
- **Documenten**: sleep hier je bewijsstukken naartoe, kies een Portflow-collectie
  en druk op **Naar Portflow**. Het bestand staat dan in je portfolio.

Filters: periode (verlopen / 7 / 30 / 90 dagen / alles), status, cursus, en vrije
zoektekst. `Esc` sluit het paneel, `/` springt naar het zoekveld, en rechtsboven
wissel je tussen licht en donker.

Je notities en afvinkingen staan in `dashboard/state.json`, je documenten in
`dashboard/documents/`. Met `?theme=light` of `?theme=dark` forceer je een thema.

### Waarom een server en geen los HTML-bestand

Het Canvas-token mag **nooit** in de browser terechtkomen. De server doet de
API-calls en stuurt alleen het resultaat naar de pagina. Zonder server zou het
token in de JS staan en dus in elke devtools-sessie leesbaar zijn.

## Portflow-brug

Portflow heeft **geen publieke API voor content**. De publieke API
(developer.portflow.app) kan alleen analytics, goals en reviews lezen, en een
API-app aanmaken kan alleen een instelling-beheerder.

Wat wél kan: de interne API die de Portflow-app zelf gebruikt, vanuit een echte
browser met jouw sessie. Dat is wat de brug doet.

```
dashboard  →  browser/send-to-portflow.mjs  →  portfolio.drieam.app/api/v1
```

Een bestand toevoegen gaat in drie stappen, afgekeken van de app zelf:

| Stap | Request |
|---|---|
| 1 | `POST /api/v1/direct-uploads` met bestandsnaam, grootte en MD5-checksum → geeft `signed_id` + een tijdelijke S3-URL |
| 2 | `PUT <die S3-URL>` — de bytes gaan rechtstreeks naar S3 |
| 3 | `POST /api/v1/portfolios/<id>/evidence` met het `signed_id`, de collectie en de titel |

Dit is sneller en betrouwbaarder dan de interface naspelen: geen kliks die
kunnen breken bij een UI-wijziging.

### Inloggen

De brug gebruikt een **persistent Chrome-profiel** (`browser/.chrome-profile`).
Jij logt één keer in; daarna hergebruikt de browser die sessie. Je wachtwoord
komt nooit in code of bestand.

Sessie verlopen? Dan vraagt de brug erom:

```bash
cd browser
node recon.mjs        # opent Chrome, jij logt in, daarna sluit het vanzelf
```

### Snelheid

Elke Portflow-actie start een browser en doorloopt de Canvas LTI-launch. Reken op
**20 tot 40 seconden** per upload. Dat is de prijs van het ontbreken van een API.

## MCP-server

De server staat al in `~/.dsh/profiles/web/cordis.patch.yml` onder `mcp-cavascp`.
Herstart DSH om hem te laden.

| Tool | Waarvoor |
|---|---|
| `portfolio_status` | Startpunt: wat loopt er, wat is open, wat is ingeleverd |
| `deadline_radar` | Tijdlijn met de rubric-eisen per aankomende deadline |
| `criteria_coverage` | Per criterium: bewijs aanwezig of nog een gat |
| `evidence_for` | Zoek je ingeleverde bewijs op criterium, LO of cursus |
| `assignment_detail` | Volledige details van één opdracht |
| `canvas_whoami` | Gezondheidscheck van de koppeling |

## Beveiliging

Het dashboard draait lokaal, maar **localhost is op zichzelf geen beveiliging**:
elke website die je bezoekt kan requests naar `127.0.0.1:8787` sturen, en elk
programma op je pc kan de API uitlezen. Daarom zit er een toegangslaag op
(`dashboard/lib/security.mjs`).

| Maatregel | Waartegen |
|---|---|
| Sessiesleutel in een HttpOnly-cookie met `SameSite=Strict` | Cross-site requests (CSRF) en uitlezen door JavaScript |
| `Origin`/`Referer`-controle op elke API-route | Een andere website die je browser als brug gebruikt |
| Alleen `127.0.0.1`, `localhost` en `[::1]` als host | DNS-rebinding en per ongeluk openzetten via een tunnel |
| `--allow-remote` moet je bewust meegeven | Idem; zonder die vlag komt er niets van buiten door |
| Rem op dure routes (10 per minuut) | Een script dat honderden browsers start |
| `Referrer-Policy: no-referrer`, `nosniff`, `X-Frame-Options: DENY`, CORP | Meekijken, MIME-verwarring, inlijsten |
| `.env` alleen leesbaar voor jou, SYSTEM en Administrators | Een tweede account op je pc dat je Canvas-token leest |

Wat dit **niet** doet: iemand met volledige toegang tot je Windows-account kan
nog steeds bij je bestanden. Daar is geen omheen te werken — dat is de reden dat
je je pc op slot houdt.

Controleer het zelf:

```bash
cd dashboard
node test-security.mjs   # 19 checks, waaronder cross-site en vreemde host
```

### Hoe het werkt in de praktijk

Je opent `http://127.0.0.1:8787`. Die pagina zet de sessiesleutel en stuurt je
door naar het dashboard. Daarna werkt alles zoals eerst — je merkt er niets van.
Open je een oude link zonder sleutel, dan zegt de server wat je moet doen.

De sleutel wordt **per keer dat de server start** opnieuw gemaakt. Herstart je
het dashboard, dan is een oud tabblad uitgelogd; even herladen is genoeg.

## Wat het wel en niet kan

**Wel** — via de officiële Canvas REST API:

- alle portfolio-gerelateerde opdrachten in je account, met deadlines en status
- de volledige rubric-criteria per opdracht, inclusief de niveaus
- je eigen inleverstatus, beoordelingen en de bestandsnamen van wat je uploadde
- volledige opdrachtomschrijvingen

**Niet** — en dat is een grens van Canvas, niet van deze server:

- de *inhoud* van je portfolio staat in **Portflow** (Drieam), niet in Canvas.
  Canvas toont alleen de inleverplek. Portflow heeft geen publieke API voor
  content — daarom gaat die kant via de browser, zie de Portflow-brug hierboven.
- Canvas' eigen ePortfolio wordt in 2026 uitgefaseerd en is op dit account leeg.

## Installatie

Vereist Node 20+. Geen npm-afhankelijkheden: het MCP-protocol is direct op stdio
geïmplementeerd, dus opstarten kost geen netwerk en geen installatie.

1. Canvas-token aanmaken: **Account → Settings → "+ New Access Token"**
   (of *Regenerate Token* op de Access Token Details-pagina).
2. Token in `~/.dsh/.env` zetten:

   ```
   CANVAS_TOKEN=1234~abcdef...
   ```

3. De server staat al in `~/.dsh/profiles/web/cordis.patch.yml` onder
   `mcp-cavascp`. Herstart DSH om hem te laden.

Het token heeft de vorm `<developerkey-id>~<65 tekens>`. Eén verkeerd teken
geeft `401 Invalid access token` — gebruik het kopieer-icoontje, typ het niet over.

Het dashboard en de MCP lezen hetzelfde token. Zet het in `D:/cavascp/.env` voor
het dashboard en de Python-tools, en in `~/.dsh/.env` voor de MCP (DSH filtert
ambient `*TOKEN*`-variabelen weg, dus daar moet hij expliciet staan).

## Ontwerpkeuzes

**Dekking op criteriumtekst, niet op LO-codes.** Fontys ICT gebruikt minstens
vier rubric-conventies door elkaar:

```
"LO 1: Situation Orientation"           MA-NCA-T
"Leeruitkomst 1: Professional standard"  INTERN5-T-CMK
"5a.(Ba) Professionele standaard."       I2-DB-T (oudere rubrics)
"Responsible AI for Society"             MA-ISP (AI-opleiding, geen LO-code)
```

Een parser die alleen `LO <n>` begrijpt laat de laatste twee stilzwijgend
verdwijnen en meldt dan een leeg portfolio. Daarom is de dekking gekoppeld aan
de criteriumtekst; LO-codes worden wél uitgelezen en getoond waar ze bestaan.

**Read-only.** Er is geen tool die inlevert, wijzigt of verwijdert. Dat is een
bewuste grens, niet een ontbrekend feature.

**Geen stille fallbacks.** Een eerdere versie ving API-fouten op met
`.catch(() => [])`. Daardoor leek elk portfolio-item "open" terwijl Canvas een
`500` teruggaf — een verkeerd antwoord dat als waarheid werd gepresenteerd.
Fouten worden nu doorgegeven.

**Geen framework in het dashboard.** De pagina is één HTML-bestand, één
stylesheets en één JS-module. Geen React, geen Tailwind, geen build-stap: je
start het met `node server.mjs` en het werkt. Een bundler zou hier alleen
opstarttijd en afhankelijkheden toevoegen zonder iets op te leveren.

**Ingediend is niet hetzelfde als aangetoond.** In zowel de tijdlijn als het
criteria-paneel krijgt alleen een *beoordeelde* opdracht het groene
"klaar"-signaal. Een ingeleverd maar onbeoordeeld stuk krijgt een neutrale
kleur, want er is nog geen bewijs dat het voldoet.

**Tekst nooit via `innerHTML`.** Opdrachtnamen bevatten tekens als `❗` en `&`.
Alles wat uit Canvas komt gaat via `textContent` naar binnen, wat zowel
layoutbreuk als injectie voorkomt.

**Viewport testen via een iframe.** `--window-size` van headless Chrome zet niet
betrouwbaar de CSS-layoutviewport: een screenshot op 414px toont dan een
afgesneden bredere layout en lijkt kapot. `preview/_viewport-test.html` zet twee
iframe's met een expliciete breedte neer, wat wél een echte viewport van die
maat geeft.

## Onderhoud

```bash
cd mcp
node test-mcp.mjs        # MCP-protocol + echte API-calls (18 checks)
node validate-config.mjs # controleert de DSH-configuratie
node server.mjs --selftest   # draait alle tools één keer, leesbaar

cd ../dashboard
node test-security.mjs   # beveiliging: cross-site, sessie, host
node test-dashboard.mjs  # echte kliks via Chrome DevTools Protocol
node test-documents.mjs  # document-inbox: upload, metadata, veiligheid
node test-full-chain.mjs # bestand -> dashboard -> Portflow -> opruimen
node shot-drawer.mjs     # screenshot van het detailpaneel

cd ../browser
node smoke-browser.mjs   # browser, profiel en Canvas-bereik
node portflow-read.mjs   # leest je portfolio via de interne API
node test-api-upload.mjs # upload via de API, zonder UI
```

De Portflow-tests ruimen hun testbewijsstuk weer op. Met `--keep` blijft het
staan zodat je het zelf kunt bekijken.

`test-dashboard.mjs` start zelf een headless Chrome, klikt door de filters,
opent het detailpaneel, typt een notitie, vinkt een criterium af en controleert
daarna de DOM én `state.json`. Statische screenshots bewijzen dat niet; echte
interactie wel. Zet Chrome-path indien nodig via `CHROME_PATH`.

### Bekende valkuilen

- **`student_ids[]`, niet `student_ids`.** Het endpoint
  `/courses/:id/students/submissions` geeft HTTP 500 bij de kale parameternaam.
  Canvas wil de array-vorm. Zie `mcp/debug-submissions.mjs`.
- **De MCP-bridge SCRUBT ambient `*KEY*`/`*TOKEN*`/`*SECRET*`-variabelen.** Het
  token moet expliciet onder `env:` in de configuratie staan, anders start de
  server zonder token.
- **`!!js`-tags in cordis.patch.yml** worden door DSH geëvalueerd; een gewone
  YAML-parser ziet ze als string. `validate-config.mjs` registreert de tag om
  toch te kunnen controleren.

## Pipeline (research-instrumentatie)

Onder `tools/` staat de Python-tooling waarmee dit is uitgezocht. Alles
read-only.

| Script | Doel |
|---|---|
| `verify_token.py` | Controleert het token en toont je cursussen |
| `probe_canvas.py` | Proeft ~140 endpoints, bewaart ruwe JSON in `data/raw/` |
| `probe_hosts.py` | Test het token tegen alle Fontys Canvas-hosts |
| `probe_token_validity.py` | Onderscheidt "token stuk" van "verkeerde host" |
| `probe_evidence.py` | Onderzoekt feedback, rubric-scores en comments |
| `build_dossier.py` | Bouwt `docs/portfolio-dossier.md` |
| `list_rubric_criteria.py` | Inventariseert alle rubric-conventies |
| `inspect_data.py` | Leesbare digest van de opgeslagen data |

```bash
python tools/build_dossier.py
```

## Bestanden

- `mcp/server.mjs` — de MCP-server (tools + stdio-protocol)
- `mcp/lib/canvas.mjs` — Canvas-client met paginering
- `mcp/lib/analysis.mjs` — detectie, rubric-parsing, dekking
- `dashboard/server.mjs` — lokale server: API + statische bestanden
- `dashboard/public/` — de pagina (HTML, CSS, JS — geen framework, geen build)
- `dashboard/state.json` — je notities en afvinkingen
- `dashboard/documents.json` + `dashboard/documents/` — de document-inbox
- `browser/portflow.mjs` — de Portflow API-client
- `browser/send-to-portflow.mjs` — brug tussen dashboard en Portflow
- `browser/.chrome-profile/` — je ingelogde sessie (staat in .gitignore)
- `docs/portfolio-dossier.md` — gegenereerd overzicht van al je portfolio-opdrachten
- `data/portfolio_assignments.json` — gestructureerde data
- `data/raw/` — ruwe API-antwoorden, handig bij het debuggen

## Veiligheid

Het Canvas-token geeft volledige toegang tot je Canvas-account. Het staat in
`~/.dsh/.env` en in `.env` in deze map — beide buiten elke git-repo. Roteer het
in Canvas als het ergens terechtkomt waar het niet hoort; de server blijft
daarna werken zodra je het nieuwe token invult.

Het dashboard luistert alleen op `127.0.0.1`, dus niet bereikbaar vanaf je
netwerk. Het token wordt nooit naar de browser gestuurd: de server doet de
API-calls en de pagina krijgt alleen het resultaat.

`.env` staat bewust **niet** in git. Zet deze map nooit in een publieke repo
zonder dat bestand eerst te verwijderen.
