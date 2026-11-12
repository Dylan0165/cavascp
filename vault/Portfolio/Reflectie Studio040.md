---
titel: Reflectie Studio040
bijgewerkt: 2026-11-12
tags:
  - portfolio
  - reflectie
  - klantproject
---

# Reflectie: het klantproject bij Studio040

## Wat we maakten

Voor Studio040, de omroep in Eindhoven, bouwden we een redactietool die van één
artikel vier kanalen maakt: een pushmelding van maximaal tweehonderd tekens, een
langere tekst met vijf bullets en een diepere uitwerking, een Engelse versie voor
internationale inwoners, en een radioscript met tijdcodes.

De aanleiding is simpel. Studio040 heeft twaalf mensen op de redactie, vier
kanalen per verhaal, en elke dag nieuw nieuws. Elke vorm is nu handwerk. Niet
omdat de techniek ontbreekt, maar omdat niemand dezelfde feiten vier keer wil
overschrijven.

## Mijn aandeel

Ik heb de applicatie gebouwd en de architectuur bepaald. De opzet is React en
Vite voor de interface, Tauri met Rust voor het bureaublad, en DeepSeek en
ElevenLabs als externe diensten voor tekst, scènes en audio. Ik heb daarbij
bewust voor Tauri gekozen en niet voor Electron: kleiner, sneller, en het
gebruikt de webview die Windows al heeft. De prijs is een kleiner ecosysteem,
en dat heb ik geaccepteerd.

De pijplijn heeft vijf stappen. Een artikel wordt geplakt of uit de RSS-feed
gehaald. Daarna wordt het in blokken geknipt: wie, wat, waar, geld, citaat en
tijdvak. Uit die blokken komen de vier vormen. Dan volgen zes controles,
waarna een mens op publiceren drukt. Tot slot verschijnt het artikel op de
testsite, in het Nederlands en het Engels, en direct daarna de reel met vier
scènes.

## De keuze die alles bepaalde

De makkelijke versie van dit project was een knop die alles automatisch
publiceert. Die heb ik niet gemaakt, en dat was een ontwerpbeslissing, geen
technische beperking.

De reden: een model dat een getal verkeerd overneemt, maakt van een betrouwbare
omroep een onbetrouwbare. Daarom worden namen, plaatsen en bedragen naast het
origineel gelegd. Klopt een getal niet, dan gaat het niet door. De knop naar
buiten is van een mens. En van elk artikel worden bron, model, tijd en controles
vastgelegd, zodat je achteraf kunt nalezen hoe het tot stand kwam.

Dat is de kern van wat ik heb geleerd: de waarde van zo'n tool zit niet in het
model, maar in de validatie en de menselijke poort eromheen.

## Twee andere dingen die ik meeneem

**Prompten is ontwerpen.** Ik dacht eerst dat een goede prompt het verschil
maakt. In de praktijk bepalen de structuur van de invoer, de voorbeelden, de
fallbacks en de controles de kwaliteit veel meer dan de formulering van één
prompt. Als de blokken niet kloppen, kan geen prompt dat repareren.

**Een demo is ook een product.** Een snelstart, voorbeelddata, een wiki en
eerlijk opgeschreven beperkingen horen bij de oplevering. Ik heb gemerkt dat
een beoordelaar of klant niet alleen naar de functionaliteit kijkt, maar naar de
vraag of hij het zelf kan starten en begrijpen.

## Wat ik de volgende keer anders doe

Ik heb te laat opgeschreven welke keuzes ik onderweg maakte. Daardoor moest ik
achteraf reconstrueren waarom Tauri en niet Electron, waarom DeepSeek en geen
eigen model, en waarom de controles precies die zes zijn. Dat had tijdens het
bouwen gekund, in een paar regels per beslissing.

Verder wil ik de kwaliteit van de uitvoer beter meten. Nu is "hij verzint niets"
een controle op getallen en namen, maar geen meting over een reeks artikelen.
Met tien artikelen en een vaste verzameling fouten had ik kunnen laten zien hoe
vaak het misgaat, in plaats van dat het goed gaat in de demo.

## Waar dit bij hoort

- **Model Interaction & Adaptation**: het model is ingezet met grenzen, een
  vaste pijplijn en controle op de uitvoer.
- **Professional Standard**: van klantvraag naar werkend product, met
  verantwoording van de keuzes en een oplevering die iemand zelf kan starten.
- **Personal Leadership**: de keuze om geen autopilot te bouwen, ook al was dat
  de snellere demo geweest.
- **AI-Augmented Learning**: ik heb AI gebruikt om te ontwerpen, te bouwen en
  te bekritiseren, en dat is in de repository en de presentatie terug te zien.
