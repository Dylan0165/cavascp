---
titel: cavascp, documentatie
bijgewerkt: 2026-11-12
tags:
  - documentatie
  - cavascp
---

# cavascp

Een koppeling met Canvas die bijhoudt welke portfolio-opdrachten open staan,
welke beoordelingscriteria nog geen bewijs hebben en wat de deadlines zijn. Met
een dashboard eromheen dat ik elke week gebruik, en een stagebot die bedrijven
benadert voor mijn stage.

Repository: https://github.com/Dylan0165/cavascp

## Hoe het werkt

Er zijn vier onderdelen, en ze delen één datamap:

1. **De Canvas-koppeling.** Een kleine client op de REST API van Canvas, met
   een persoonlijk toegangstoken uit `.env`. Hij haalt opdrachten, rubrics,
   inleveringen en cursussen op en bewaart die lokaal, zodat het dashboard snel
   is en blijft werken als Canvas traag is.
2. **De MCP-server.** Dezelfde functionaliteit, maar als tools voor een
   AI-assistent. Zo kan ik in een gesprek vragen "wat mist mijn portfolio"
   zonder de app te openen.
3. **Het dashboard.** Eén Node-proces dat de data leest, een tijdlijn toont,
   criteria afvinkbaar maakt en documenten koppelt aan leeruitkomsten.
4. **De stagebot.** Bedrijven zoeken, lezen, een mail schrijven, versturen en
   de antwoorden weer inlezen.

## Keuzes, en waarom

| Keuze | Waarom | Wat ik ervoor opgaf |
|---|---|---|
| **Geen npm-pakketten** | Elke afhankelijkheid is code die ik niet lees en die kan breken. Node heeft genoeg aan boord: `http`, `tls`, `zlib`, `crypto`. | Meer eigen code, en zelf nadenken over dingen die een pakket al doet. |
| **Eigen OV-planner** | De NS-API vroeg een sleutel en gaf geen betrouwbare dienstregeling. De open GTFS-data van OVapi is compleet en gratis. | Een feed van 213 MB die ik zelf moet importeren en bijhouden. |
| **IMAP in plaats van de Gmail-API** | De Gmail-API vraagt OAuth met een cloudproject en een consent-scherm. IMAP werkt met het app-wachtwoord dat er al was. | Minder mogelijkheden: geen labels, geen filters, alleen lezen. |
| **Sessiecookie met scrypt** | Eén gebruiker, één wachtwoord. Geen OAuth-server nodig. `scrypt` zit in Node en is traag genoeg om raden te ontmoedigen. | Geen multi-user, geen rollen. |
| **ntfy in plaats van Teams** | De Fontys-tenant blokkeert de Teams-connector via een DLP-regel. ntfy vraagt alleen een onderwerpnaam. | Berichten gaan via een publieke dienst, dus het onderwerp is een geheim. |
| **Alles lokaal** | De data bevat mijn cijfers, mijn mails en mijn bedrijvenlijst. Die hoort niet op een server van iemand anders. | Geen backup in de cloud, en ik moet zelf het systeem in de lucht houden. |

## Bronnen

- Canvas LMS REST API: <https://canvas.instructure.com/doc/api/>
- Model Context Protocol: <https://modelcontextprotocol.io/>
- Node.js documentatie (`http`, `tls`, `zlib`, `crypto`): <https://nodejs.org/api/>
- OWASP, Cross-Site Request Forgery Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- GTFS Schedule Reference: <https://gtfs.org/documentation/schedule/reference/>
- RFC 5321 (SMTP), RFC 3501 (IMAP), RFC 2047 (headers met tekens buiten ASCII)
- Autoriteit Persoonsgegevens, over de AVG: <https://www.autoriteitpersoonsgegevens.nl/>

## Zou ik dit in de praktijk aanraden?

Voor een student of een kleine organisatie die met Canvas werkt: ja, met een
paar kanttekeningen. Het systeem is klein genoeg om te begrijpen, het draait op
iets van 60 MB geheugen, en het kost niets.

Wat ik zou aanraden is vooral de aanpak: eerst kijken welke data er al is
(Canvas heeft een API), dan een dunne laag bouwen, en pas daarna een scherm.
De verleiding is om met het scherm te beginnen en dan te ontdekken dat de data
niet klopt.

## Waar ik kritisch op ben

- **Het is voor één gebruiker.** Geen rollen, geen rechten, geen scheiding. Voor
  een team zou je dat allemaal moeten bouwen.
- **Schrapen blijft kwetsbaar.** De stagebot leest websites van bedrijven. Als
  een site zijn opbouw verandert, wordt de mail slechter en zie je dat pas als
  je hem naleest. Daarom staat er altijd een mens tussen.
- **De tests dekken de logica, niet de buitenwereld.** Ik test de planner, de
  queue en het lezen van mail, maar niet of Canvas morgen hetzelfde antwoord
  geeft.
- **De OV-data is een momentopname.** De dienstregeling wordt geïmporteerd en
  veroudert. Zonder nieuwe import gaan reistijden op een gegeven moment liegen.
- **Te veel in één repo.** Canvas, OV, stage en dashboard zitten samen. Dat is
  handig voor mij, maar lastig voor iemand anders.
