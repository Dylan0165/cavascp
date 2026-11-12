---
titel: Reflectie Studio040
bijgewerkt: 2026-11-12
tags:
  - portfolio
  - reflectie
  - klantproject
---

# Reflectie: het klantproject bij Studio040

## Wat ik bouwde

Een redactietool voor Studio040 die van één artikel vier kanalen maakt: een
pushmelding, een langere tekst, een Engelse versie en een radioscript met
tijdcodes. De opbouw is React met Vite, Tauri met Rust voor het bureaublad, en
DeepSeek en ElevenLabs voor tekst, scènes en audio.

## Waarom zo, en niet anders

De makkelijke versie was een knop die alles automatisch publiceert. Die heb ik
niet gemaakt, en dat was de belangrijkste keuze van het project. Een model dat
een bedrag verkeerd overneemt, maakt van een betrouwbare omroep een
onbetrouwbare. Daarom wordt het verhaal eerst in blokken geknipt, worden namen
en bedragen naast het origineel gelegd, en drukt een mens op publiceren.

Tauri in plaats van Electron: kleiner, sneller, en het gebruikt de webview die
Windows al heeft. De prijs is een kleiner ecosysteem, en dat heb ik
geaccepteerd. DeepSeek in plaats van een eigen model: goede kwaliteit voor
weinig geld, maar je bent afhankelijk van een dienst die van prijs kan
veranderen.

## Samenwerking

Het project liep in een groep van vier. We hadden vaste momenten: aan het begin
van de sprint een overleg waarin we het werk verdeelden en de planning
vastlegden, en rond de demo een moment waarop we keken wat er echt stond. Dat
werkte goed, vooral omdat we afspraken wat er af moest zijn voordat iemand aan
iets begon. Als een onderdeel vertraging opliep, wisten we dat op tijd en
konden we schuiven in plaats van achteraf te repareren.

⟦vul in: wat was jouw rol in die overleggen? Bijvoorbeeld: nam jij het
initiatief voor de planning, of bewaakte je de technische lijn?⟧

## Wat ik leerde

Twee dingen. Ten eerste: de waarde zit niet in het model maar in de validatie
eromheen. Ten tweede: prompten is ontwerpen. De structuur van de invoer, de
voorbeelden en de controles bepalen de kwaliteit meer dan één goede prompt.

## Wat ik de volgende keer anders doe

Ik heb te laat opgeschreven waarom ik bepaalde keuzes maakte, waardoor ik
achteraf moest reconstrueren waarom Tauri en niet Electron. En ik heb de
kwaliteit niet gemeten over een reeks artikelen: ik controleer het artikel dat
voor me staat, maar ik weet niet hoe vaak het over vijftig artikelen misgaat.
Dat is het eerste dat ik zou toevoegen.
