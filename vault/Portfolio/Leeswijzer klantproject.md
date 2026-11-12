---
collectie: klantproject
bijgewerkt: 2026-11-12
tags:
  - portfolio
  - leeswijzer
---

# Leeswijzer: collectie klantproject

> [!info] Waar dit hoort
> Dit is de tekst voor het veld **Collection description** in Portflow.

## Wat hier staat

Het klantproject heb ik gedaan voor Studio040, de omroep in Eindhoven. Ik heb
een redactietool gebouwd die van één artikel vier kanalen maakt: een
pushmelding van maximaal tweehonderd tekens, een langere tekst met vijf bullets,
een Engelse versie voor internationale inwoners, en een radioscript met
tijdcodes voor de studio.

De aanleiding: twaalf mensen op de redactie, vier kanalen per verhaal, elke dag
nieuw nieuws. Elke vorm is handwerk, niet omdat de techniek ontbreekt, maar
omdat niemand dezelfde feiten vier keer wil overschrijven. De tool maakt de
vormen, de redactie beslist wat naar buiten gaat.

## In welke volgorde

1. **`AI Editor (Studio040)`** (applicatie en repository): begin bij het
   werkende product. In de repository staat een README met de opzet, hoe je
   hem start en welke keuzes er zijn gemaakt.
2. **`AI-Editor-Presentatie-DylanSchuurman.pptx`**: de presentatie waarmee ik
   het project heb toegelicht. Hierin staan het probleem, de oplossing, de
   architectuur, de afwegingen en de cijfers van de demo in het kort.
3. **`Reflectie Studio040`**: mijn eigen aandeel en wat ik ervan heb geleerd.

## Mijn bijdrage

Ik heb de applicatie gebouwd en de architectuur bepaald. De interface is React
met Vite, het bureaublad is Tauri met Rust (bewust niet Electron: kleiner,
sneller en het gebruikt de webview die Windows al heeft), en DeepSeek en
ElevenLabs doen de tekst, de scènes en de audio.

De pijplijn heeft vijf stappen: plakken of uit de RSS-feed halen, knippen in
blokken (wie, wat, waar, geld, citaat, tijdvak), daar de vier vormen uit maken,
zes controles laten lopen, en publiceren pas na goedkeuring van een mens. Tot
slot verschijnt het artikel op de testsite in het Nederlands en het Engels,
direct gevolgd door een reel met vier scènes. De cijfers van de demo: vijf
stukken per artikel, zes controles, vier scènes, ongeveer 4,3 seconde
generatietijd, en geen enkele sleutel in de frontend.

## Wat je hier kunt beoordelen

- **Professional Standard**: de aanpak van klantvraag naar werkend product,
  en hoe we verantwoording hebben afgelegd.
- **Model Interaction & Adaptation**: hoe het model is ingezet, welke grenzen
  we hebben gesteld (lengte, bron, taal) en hoe we hebben gecontroleerd dat de
  uitvoer bruikbaar is.
- **Personal Leadership**: de keuzes die ik zelf heb gemaakt en waarom,
  waaronder de belangrijkste: geen knop die alles automatisch publiceert.
