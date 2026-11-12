---
titel: AI Editor (Studio040), documentatie
bijgewerkt: 2026-11-12
tags:
  - documentatie
  - klantproject
---

# AI Editor (Studio040)

Een redactietool die van één artikel vier kanalen maakt: een pushmelding, een
langere tekst, een Engelse versie en een radioscript met tijdcodes. Gebouwd voor
Studio040, de omroep in Eindhoven, in een groep van vier.

## Het probleem

Studio040 heeft twaalf mensen op de redactie en vier kanalen per verhaal. Elke
vorm is handwerk: hetzelfde verhaal wordt opnieuw geschreven voor de site, de
app, de radio en de internationale inwoners. Niet omdat de techniek ontbreekt,
maar omdat niemand dezelfde feiten vier keer wil overschrijven.

## Hoe het werkt

Vijf stappen, in deze volgorde:

1. **Plakken.** Een artikel of een item uit de RSS-feed.
2. **Blokken.** Het verhaal wordt geknipt in wie, wat, waar, geld, citaat en
   tijdvak. Die blokken zijn de enige bron voor de vier vormen.
3. **Vier vormen.** Uit dezelfde blokken komen een pushmelding van maximaal
   tweehonderd tekens, een tekst met vijf bullets en een diepere uitwerking,
   een Engelse versie en een radioscript met tijdcodes en bedragen voluit.
4. **Controleren.** Zes controles: namen, plaatsen, bedragen en lengte worden
   naast het origineel gelegd. Klopt een getal niet, dan gaat het niet door.
5. **Publiceren.** Pas na goedkeuring van een mens. Eerst het artikel op de
   testsite, in het Nederlands en het Engels, direct daarna de reel met vier
   scènes.

De opbouw is React met Vite voor de interface, Tauri met Rust voor het
bureaublad, DeepSeek voor tekst en scènes, ElevenLabs voor de audio, en JSON in
de AppData-map voor opslag. Er staat geen enkele sleutel in de frontend.

## Keuzes, en waarom

| Keuze | Waarom | Wat ik ervoor opgaf |
|---|---|---|
| **Tauri in plaats van Electron** | Kleiner, sneller, en het gebruikt de webview die Windows al heeft. Een binary in plaats van een halve browser. | Een kleiner ecosysteem: minder plugins en minder voorbeelden als je vastloopt. |
| **DeepSeek in plaats van een eigen model** | Goede kwaliteit voor weinig geld, en geen GPU om te beheren. | Afhankelijk van een externe dienst die van prijs of beleid kan veranderen. |
| **Lokaal in plaats van cloud** | Privacy en een demo die blijft werken, ook zonder internet. | Geen multi-user en geen gedeelde geschiedenis. |
| **Blokken in plaats van één grote prompt** | Als de blokken kloppen, kun je de vier vormen kontroleren. Met één prompt is de uitvoer niet na te rekenen. | Meer code: eerst structuur, dan genereren. |
| **Een mens die publiceert** | Een verkeerd getal maakt van een betrouwbare omroep een onbetrouwbare. | De demo is langzamer dan een knop die alles automatisch doet. |

## Bronnen

- Tauri v2 documentatie: <https://v2.tauri.app/>
- Tauri security, capabilities en permissions: <https://v2.tauri.app/security/>
- DeepSeek API: <https://api-docs.deepseek.com/>
- ElevenLabs documentatie: <https://elevenlabs.io/docs>
- React: <https://react.dev/> en Vite: <https://vite.dev/>
- EU AI Act, verordening (EU) 2024/1689: <https://eur-lex.europa.eu/eli/reg/2024/1689/oj>
- Autoriteit Persoonsgegevens, over de AVG: <https://www.autoriteitpersoonsgegevens.nl/>

## Zou ik dit in de praktijk aanraden?

Voor een kleine nieuwsredactie: ja, maar als gereedschap en niet als
vervanging. De winst zit in het repetitieve werk, niet in het journalistieke
oordeel. Een redactie die dit invoert, moet twee dingen regelen: iemand die de
controleserie serieus neemt, en een zichtbaar AI-label bij elk artikel.

Voor een grote redactie zou ik het niet zo bouwen. Dan wil je centrale opslag,
rechten, een gedeelde geschiedenis en een koppeling met het CMS. Dit is een
prototype dat laat zien dat het kan, niet een product voor vijftig gebruikers.

## Waar ik kritisch op ben

- **De kwaliteit is niet gemeten over een reeks.** Ik controleer of namen en
  bedragen kloppen bij het artikel dat voor me staat, maar ik heb niet
  gemeten hoe vaak het misgaat over vijftig artikelen. Dat is het eerste wat ik
  zou toevoegen.
- **Afhankelijk van twee externe diensten.** Valt DeepSeek uit, dan stopt de
  tekst. Valt ElevenLabs uit, dan stopt de audio. Er is geen terugvaloptie.
- **Kosten schalen mee met gebruik.** Per artikel is het weinig, maar bij honderd
  artikelen per dag wordt het een begroting.
- **De audio is een stem, geen montage.** Het script is bruikbaar voor de
  studio, maar de timing en nadruk moet een mens nog doen.
- **Geen multi-user.** Iedereen werkt in zijn eigen AppData. Delen kan niet.
