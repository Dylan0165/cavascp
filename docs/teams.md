# Meldingen naar Teams

Een bericht in je Teams als er een mail de deur uit gaat. Meer niet — je
stagezoektocht hoort niet in een chatkanaal te leven.

```
stagebot  →  webhook-URL  →  Power Automate-flow  →  kaart in je kanaal
```

## Waarom een flow en geen webhook

De oude "Incoming Webhook"-connectors van Teams (`*.webhook.office.com`) zijn in
**mei 2026 uitgezet**. Wat ervoor in de plaats kwam is een Power Automate-flow
met de trigger *"When a Teams webhook request is received"*. Die geeft je een
URL waar je JSON naartoe post.

Een echte bot zou een Azure-app, een app-manifest en toestemming van een
beheerder vragen. Voor "stuur een berichtje als er een mail weg is" is dat te
veel.

## Eenmalig instellen

1. Open **Teams** → **Workflows** (of <https://make.powerautomate.com>).
2. Kies de sjabloon **"Post to a channel when a webhook request is received"**.
3. Kies het kanaal of de chat waar je de meldingen wilt.
4. Als de flow klaar is, kopieer je de URL uit de trigger. Die ziet eruit als

   ```
   https://prod-12.westeurope.logic.azure.com:443/workflows/…/triggers/manual/paths/invoke?api-version=…&sig=…
   ```

5. Ga naar het stage-scherm, klik rechtsboven op **Teams: niet gekoppeld** en
   plak de URL. Je krijgt meteen een proefbericht — komt dat aan, dan is het
   goed.

De sjabloon leest twee velden uit de aanvraag (`Title` en `Message`); de
stagebot stuurt die mee, én een complete Adaptive Card voor een flow die de
hele aanvraag als kaart post. Welke van de twee je ook hebt gekozen, het werkt.

## Wat je krijgt

Als er een mail verstuurd is:

```
Mail verstuurd: Daemen ICT
Stage infrastructuur en cybersecurity
Naar: info@daemen.nl
Bedrijf: Daemen ICT
```

Bij een bulk-verzending komt er één samenvatting in plaats van twintig losse
berichten.

## Als de organisatie het blokkeert

Bij Fontys werkt dit **niet**. De flow wordt wel aangemaakt, maar kan niet
worden aangezet:

> Your flow was saved, but could not be enabled because it conflicts with the
> company data loss prevention policies.

De oorzaak staat in de melding bij de flow zelf:

> Admin data policy 'Omgeving Default environment' restricts use of these apis:
> TeamsWebhookRequestReceived.

Dat is een **DLP-beleid van de tenant**, niet iets wat de stagebot kan omzeilen.
Dezelfde blokkade geldt voor de algemene HTTP-trigger in combinatie met de
Teams-connector. En het lezen van documenten uit Teams (Microsoft Graph) vraagt
bovendien toestemming van een beheerder — die route is om dezelfde reden dicht.

Wat dan wél werkt:

- **meldingen per mail** naar jezelf (de stagebot doet dat automatisch als
  Teams niet gekoppeld is);
- een andere pushdienst die niets met Microsoft te maken heeft, zoals ntfy.

Wil je het toch via Teams, dan moet de Fontys-beheerder het beleid aanpassen.
Vraag dan om `TeamsWebhookRequestReceived` toe te staan in het standaard
Power Platform-beleid. Dat is een vraag aan ICT, niet iets voor een script.

## Instellen zonder scherm

```bash
node stagebot/cli.mjs teams                 # is het gekoppeld?
node stagebot/cli.mjs teams --zet <url>     # koppelen (stuurt een proefbericht)
node stagebot/cli.mjs teams --test          # nog een proefbericht
```

Of in `.env`: `TEAMS_WEBHOOK_URL=...`.

## Veiligheid

De webhook-URL is een **geheim**: iedereen met die URL kan berichten in je
kanaal posten. Daarom:

| Maatregel | Waartegen |
|---|---|
| Alleen `https://` en alleen Microsoft-hosts (`*.logic.azure.com`, `*.powerplatform.com`) | De server post alleen naar wat het formulier aanlevert — zonder deze grens zou een verkeerd geplakte of kwaadwillende URL de server overal naartoe laten posten |
| Bewaard in `data/stagebot/teams.json` met `chmod 600` | Andere accounts op de machine |
| Nooit terug naar de browser | Het scherm ziet alleen dát het gekoppeld is |
| Eerst een proefbericht, dan pas bewaren | Een URL die niet werkt wordt niet opgeslagen |

Wat er **niet** in de melding staat: de mailtekst, je telefoonnummer, of iets
uit je Canvas-dossier. Alleen de titel, het onderwerp en het adres.

## Wat het niet doet

- **Geen inkomend.** Teams is hier een uitgaand kanaal; antwoorden komen in je
  mail, niet in de bot.
- **Geen garantie.** Ligt Teams eruit, dan gaat de mail gewoon de deur uit. De
  fout komt in de log, niet in je gezicht — de mail is het werk, de melding is
  het gemak.
- **Meldingen zijn uit te zetten** met het vinkje in het venster; de koppeling
  blijft dan staan.

## Testen

```bash
node stagebot/test-teams.mjs
```

18 checks tegen een nepserver: welke URL's geaccepteerd worden (en welke niet),
de vorm van de kaart, wat er precies gepost wordt, en een 500 die een echte
fout moet opleveren. Er gaat niets naar Microsoft.
