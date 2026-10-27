# De stagebot

Van een bedrijfswebsite naar een mail die je kunt versturen — met een taalmodel,
en met je Canvas-gegevens erin.

```
node stagebot/cli.mjs scan informa.nl       # bedrijf lezen
node stagebot/cli.mjs mail informa          # mail schrijven
node stagebot/cli.mjs lijst                 # wat je hebt
```

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

## Wat de bot niet doet

**Hij verstuurt niets.** Er is geen verzendfunctie. Je krijgt de mail te zien en
kopieert hem naar je eigen mailprogramma. Dat is bewust: een stagezoektocht gaat
over mensen, en als er iets misgaat wil je dat het jouw fout was en niet die van
een script.

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

- **Versturen.** Bewust niet gebouwd. Zie hierboven.
- **Opvolgen.** Nog geen herinnering na een week, en geen overzicht van wie
  antwoordde. De status per bedrijf wordt wel bijgehouden.
- **Zoeken.** Je moet zelf een bedrijf aandragen; de bot leest het alleen.
- **Een scherm.** De stagebot is nu een commandoregel. Een tabblad in het
  dashboard zou mooier zijn, maar dan moet eerst blijken dat je hem gebruikt.

## Testen

```
node stagebot/test-stagebot.mjs
```

37 checks over alles wat niet van het taalmodel afhangt: tekst uit HTML halen,
e-mailadressen vinden, technologie herkennen (inclusief de valkuil dat "Go" in
"Governance" zit), anti-bot-pagina's doorzien, en de mailopmaak.
