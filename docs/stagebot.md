# De stagebot

Van een bedrijfswebsite naar een mail die je kunt versturen — met een taalmodel,
en met je Canvas-gegevens erin.

```
node stagebot/cli.mjs zoek                  # bedrijven zoeken in de regio
node stagebot/cli.mjs dag                   # twintig kandidaten lezen en mailen
node stagebot/cli.mjs status                # wachtrij en daglimiet
node stagebot/cli.mjs scan informa.nl       # één bedrijf lezen
node stagebot/cli.mjs mail informa          # mail schrijven
node stagebot/cli.mjs lijst                 # wat je hebt
```

Of: open `http://127.0.0.1:8787/stage` — hetzelfde, met een scherm erbij.

## Waarom dit bestaat

De stageborden gaven niets. Dan zoek je zelf: bedrijven die doen wat jij wilt
doen, en een mail waarin staat waarom juist zij. Dat uitzoeken kost per bedrijf
een half uur. De bot doet het opzoekwerk en jij doet de laatste stap.

## Hoe het werkt

```
website  →  scan.mjs      haalt de pagina's op, vindt het e-mailadres,
                          de technologie en of ze stage lopen
         →  deepseek.mjs  vraagt het model wat er staat en wat het
                          aanknopingspunt is
         →  profiel.mjs   haalt jouw kant erbij: opleiding, minor,
                          vaardigheden, projecten (deels uit Canvas)
         →  mail.mjs      schrijft de mail en keurt hem
         →  bedrijven.mjs bewaart alles in data/stagebot/bedrijven.json
```

## Wat het profiel bepaalt

Een mail is zo goed als wat de bot over jou weet. Zonder vaardigheden en
projecten wordt hij vaag — daar waarschuwt de CLI ook voor.

Je profiel staat in `data/stagebot/profiel.json`. Dat bestand wordt aangemaakt
bij de eerste keer en is van jou. Vul in elk geval `email` in, en je
`vaardigheden` en `projecten`.

Met `node stagebot/cli.mjs canvas` haalt de bot je vakken uit Canvas en zet ze
in je profiel. Dat is deels automatisch; wat je zelf hebt gedaan moet je zelf
invullen, want dat weet Canvas niet.

## Het scherm

`/stage` in het dashboard is één pagina met drie kolommen werk: de wachtrij
(gevonden bedrijven die nog gelezen moeten worden), de mails van vandaag, en de
mail zelf met de controle eronder.

Bovenaan staat één knop die het werk doet: **Dagrun starten**. Die leest de
wachtrij één bedrijf tegelijk — site ophalen, mail schrijven, klaarzetten — en
stopt bij twintig. Eén tegelijk is expres: je ziet na elk bedrijf wat er
gebeurde, en als er één site stuk is sla je hem over in plaats van een kwartier
naar een vastgelopen run te kijken.

Daarna lees je de mails na en druk je op **Goedgekeurd**. Kopiëren, plakken in
je mailprogramma, versturen. De knop **Verstuurd** zet de status en de datum in
je dossier.

## Twintig per dag

De limiet is twintig en hij zit in `dagTelling()`, niet in de knop. Wat je ook
klikt, er komen er geen eenentwintig bij: de teller kijkt naar bedrijven met
`dag` van vandaag en een status die telt als werk (concept, goedgekeurd,
verstuurd). Een bedrijf dat je afwijst telt niet mee — daar mag je een andere
voor in de plaats zetten.

Twintig is nog te overzien met de hand. Het is ook ongeveer het maximum dat je
je mailadres kunt permitteren: als je elke dag twintig koude mails stuurt vanaf
je gmail, staat dat adres binnen twee weken als spam bekend, en dan komt je
eigen stage-aanvraag niet meer aan.

## Waar de bedrijven vandaan komen

Drie bronnen, in volgorde van betrouwbaarheid:

| Bron | Wat het is |
|---|---|
| `data/stagebot/seed-bedrijven.json` | je eigen lijst, met de hand opgebouwd |
| OpenStreetMap | automatisch: ICT-bedrijven binnen 25 km van Roosendaal |
| het tekstveld in het scherm | één URL die je ergens hebt gevonden |

OpenStreetMap is de enige automatische bron, en die is wisselvallig: de publieke
Overpass-API is regelmatig overbelast. De code probeert het, en als het niet lukt
zegt hij dat — de eigen lijst wordt dan alsnog toegevoegd. Een lege uitkomst is
nooit "geen bedrijven in de regio", het is "de bron lag eruit".

De echte beperking is aanvoer, niet snelheid. Er zijn in West-Brabant misschien
tweehonderd bedrijven die een ICT-stage kunnen bieden; daarvan staan er tientallen
in OSM. Wil je langer dan een week door, dan zul je zelf moeten aanvullen — via
LinkedIn, OnStage, of door een lijst te plakken.

## Bereikbaarheid

Je woont in Roosendaal en wil er met het OV komen. De bot rekent de
hemelsbrede afstand tot het dichtstbijzijnde station en noemt dat:

| Klasse | Betekenis |
|---|---|
| loopafstand | ≤ 1,5 km van een station |
| korte rit | ≤ 4 km — bus of fiets naar het station |
| verder | meer dan 4 km |
| onbekend | geen coördinaten bekend |

Dat is een proxy, geen reistijd: er zit geen routeplanner achter. Een bedrijf op
anderhalve kilometer van een station in een dorp zonder rechtstreekse trein kan
in de praktijk twee overstappen kosten. De afstand staat erbij, dus je kunt zelf
inschatten of het te doen is. Een tilde (`~`) betekent dat de locatie uit een
adreszoekopdracht komt: dan is het de omgeving van het bedrijf, niet de voordeur.

## De eis van Fontys

Canvas is hierin duidelijk (INTERN5 → Planning): **de stage duurt een volledig
semester, je werkt minimaal 90 dagen en fulltime**. Afwijken kan alleen met
toestemming van de examencommissie.

Je profiel staat op vier dagen per week. Dat botst. Daarom zegt de stagepagina
het bovenaan, en daarom belooft geen enkele mail een aantal dagen: je kunt een
bedrijf niet drie dagen aanbieden en er later achter komen dat het niet mag.
Regel het met je stagecoördinator vóór je verstuurt.

## Gmail koppelen

De stagebot verstuurt via de SMTP-server van Gmail, met een **app-wachtwoord**.
Geen OAuth, geen Google Cloud-project: één string van zestien tekens die je in
`.env` zet en die je met één klik kunt intrekken.

1. Zet **tweestapsverificatie** aan op je Google-account. Zonder dat bestaat er
   geen app-wachtwoord.
2. Ga naar <https://myaccount.google.com/apppasswords>, noem het "stagebot" en
   kopieer de zestien tekens.
3. Zet ze in `.env`:

   ```
   GMAIL_USER=dylanschuurman04@gmail.com
   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   ```

   Spaties mogen; die haalt de code eruit.
4. Test met een proefmail naar jezelf:

   ```
   node stagebot/cli.mjs gmail --test
   ```

Daarna wordt de knop **Verstuur naar …** actief in het scherm, en verschijnt
**Verstuur goedgekeurd (n)** zodra er mails op goedgekeurd staan.

Wat er met een verzending gebeurt:

| Stap | Wat |
|---|---|
| je drukt op versturen | bevestigingsvraag met het adres en het onderwerp |
| de mail gaat de deur uit | SMTP naar smtp.gmail.com:465, inloggen met het app-wachtwoord |
| de server accepteert | pas dán gaat de status op "verstuurd", met tijd en Message-ID |
| de server weigert | de mail blijft staan, de fout komt in beeld |

De status gaat dus **niet** op verstuurd als het verzenden mislukte — anders staat
er een vinkje bij een mail die nooit aankwam.

Twee dingen om te weten:

- **De eerste keer in spam.** Een nieuw afzenderadres met een zakelijke mail
  belandt vaak in spam. Vraag het bedrijf desnoods om je adres toe te voegen, of
  bel na een week.
- **Grens van Gmail.** Een gratis account mag ongeveer 500 ontvangers per dag
  hebben. Twintig is daar ver onder — en dat is precies de bedoeling.

## Wat de bot niet doet

**Hij verstuurt niet zonder jou.** De knop vraagt eerst om bevestiging met het
adres en het onderwerp erbij. En `verstuur --alles` pakt alleen mails met status
"goedgekeurd" — wat je nog niet hebt nagekeken blijft liggen. Een script dat
zelfstandig twintig koude mails per dag de deur uit doet, is een script dat op
een ochtend je adres verpest.

**Hij verzint niets over je.** Staat er geen project in je profiel, dan noemt de
mail er geen. De prompt verbiedt het, en `keurMail()` controleert erop.

**Hij mailt geen honderden bedrijven.** Zie hieronder.

## Over volume en spam

Zakelijke e-mail mag in Nederland, mits de ontvanger kan afwijzen. Daarom staat
er altijd een regel in waarin "nee" een prima antwoord is.

Maar het praktische argument is sterker dan het juridische: twintig goede mails
verslaan tweeduizend generieke. Stagecoördinatoren herkennen een massamail, en
je Fontys-adres raakt bekend als spam. Doe er dus tien per week, niet honderd
per dag.

## Als een site bots tegenhoudt

Steeds vaker zit er een controle voor de deur — Cloudflare, Anubis. De bot
herkent dat en zegt het:

```
  Deze site houdt bots tegen (anubis).
  Open hem zelf in je browser, kopieer de tekst naar een bestand,
  en doe dan: node stagebot/cli.mjs scan cco.nl --tekst cco.txt
```

Dat is geen omweg maar een voordeel: jij ziet ook de vacaturepagina's die achter
een knop zitten.

## Wat er nog niet is

- **Opvolgen.** Geen herinnering na een week, en geen overzicht van wie al
  antwoord gaf. De status per bedrijf wordt wel bijgehouden, dus je kunt het
  met de hand zien — maar de bot tikt je niet op de schouder.
- **Antwoorden inlezen.** Je zet "geantwoord" zelf; de bot leest je inbox niet.
- **Bounces.** Een mail naar een dood adres komt nu niet terug in beeld.
- **Meerdere contactpersonen per bedrijf.** Nu is het één adres.

## Testen

```
node stagebot/test-stagebot.mjs   # tekst, e-mail, tech, mailopmaak (38 checks)
node stagebot/test-queue.mjs      # afstand, OV, wachtrij, daglimiet (23 checks)
node stagebot/test-smtp.mjs       # het mailgesprek, tegen een nepserver (11 checks)
```

De SMTP-test start een eigen server op een vrije poort en leest mee wat de
client stuurt. Er gaat dus geen echte mail de deur uit, en je hoeft geen
wachtwoord te hebben om te controleren of versturen werkt.

De tweede reeks draait in een tijdelijke datamap (`CAVASCP_DATA_DIR`), zodat een
test je echte bedrijvenlijst nooit kan overschrijven.
