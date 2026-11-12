---
titel: Reflectie cavascp
bijgewerkt: 2026-11-12
tags:
  - portfolio
  - reflectie
  - persoonlijk project
---

# Reflectie: cavascp

## Waarom ik dit bouwde

Ik had elke week hetzelfde probleem: ik wist niet welke portfolio-opdrachten er
open stonden, welke criteria nog geen bewijs hadden en wat er als eerste moest
gebeuren. Dat zocht ik steeds met de hand uit in Canvas. cavascp doet dat nu in
één scherm.

Ik had het ook kunnen laten liggen, want het is geen opdracht. Ik heb het
gebouwd omdat het mijn eigen werk sneller maakt, en omdat ik wilde weten hoe ver
ik kom met alleen de standaardbibliotheek van Node.

## De keuzes die het project bepalen

**Geen npm-pakketten.** Elk pakket is code die ik niet lees en die kan breken.
Node heeft `http`, `tls`, `crypto` en `zlib` aan boord, en daar kom je ver mee.
De prijs is dat ik zelf een zip-lezer, een IMAP-client en een OV-planner moest
schrijven. Dat kostte tijd, maar ik weet nu precies waar het misgaat als er
iets misgaat.

**IMAP in plaats van de Gmail-API.** De Gmail-API vraagt OAuth met een
cloudproject en een consent-scherm. IMAP werkt met het app-wachtwoord dat er al
was. Minder mogelijkheden, maar wel in één middag werkend.

**Mijn eigen dienstregeling in plaats van de NS-API.** De NS vroeg een sleutel
en gaf geen bruikbare dienstregeling. De open GTFS-data is compleet en gratis,
maar het is wel een bestand van 213 MB dat ik zelf moet importeren.

**Alles lokaal.** De data bevat mijn cijfers, mijn mails en mijn
bedrijvenlijst. Die hoort niet op een server van iemand anders. De prijs is dat
ik zelf backups moet maken en het systeem in de lucht moet houden.

## Wat ik ervan leerde

Dat een koppeling met een externe API vooral gaat over wat je doet als het mis
gaat. Canvas is soms traag, soms stuk, en soms geeft het minder terug dan je
verwacht. De eerste versie ging daar stuk op. Nu is er een cache, een time-out
en een duidelijke melding.

En dat AI een goede bouwpartner is, maar geen architect. Ik heb het model
gebruikt om fouten op te sporen en om alternatieven te bedenken, en ik heb
adviezen verworpen die niet in dit project pasten. Dat onderscheid maken is
precies wat ik dit semester heb geleerd.

## Wat ik de volgende keer anders doe

Ik zou eerder een grens trekken om het project heen. Nu zitten Canvas, OV, de
stagebot en het dashboard in één repository, wat voor mij handig is en voor een
ander onoverzichtelijk. En ik zou de tests vanaf het begin schrijven in plaats
van achteraf: de planner en de queue hebben er nu wel, maar pas nadat ze één
keer stuk waren.

## Waar dit bij hoort

- **AI-Augmented Learning**: het model als bouwpartner, met de momenten waarop
  ik het advies heb verworpen.
- **Professional Standard**: werken met een API die niet van mij is.
- **Personal Leadership**: dit project zelf bedenken, afbakenen en afmaken
  naast de minor.
- **Data & Knowledge Stewardship**: wat ik van Canvas bewaar en wat niet.
