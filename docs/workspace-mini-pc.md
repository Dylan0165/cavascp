# Werken op de mini-pc

Alles staat klaar op de Linux-machine. Dit is hoe je er komt en hoe je verder
werkt.

## Waar het staat

| | |
|---|---|
| machine | `dsh-harness` — Ubuntu, 4 cores, 8 GB, 96 GB schijf |
| adres (Tailscale) | `100.96.31.24`, SSH-poort 22 |
| project | `/home/ubuntu/cavascp` |
| dashboard | `http://127.0.0.1:8787` op die machine |
| Node | v24.21.0 |
| Python | 3.12 |
| Chrome | 156 (voor de Portflow-brug) |

Er staan meer projecten in de home-map: KravaDoc, MarketingTool, betaalsysteem,
clipfarmer, lifedashboard, tradingbot, Peppolefactuur, gereedschap.

## Erbij komen

**Werken aan de code:**

```bash
ssh ubuntu@100.96.31.24
cd ~/cavascp
```

**Het dashboard bekijken in je browser** — via een tunnel, zodat je niets
openbaar maakt:

```bash
ssh -N -L 8787:127.0.0.1:8787 ubuntu@100.96.31.24
```

Laat dat venster openstaan en ga naar <http://127.0.0.1:8787>. Het dashboard
luistert daar alleen op localhost, dus zonder tunnel komt niemand erbij.

**Of**: start het met `--remote` en open `http://100.96.31.24:8787`. Dan staat het
op je Tailscale-netwerk. Alleen doen als je dat bewust wilt.

## Starten en stoppen

Het dashboard draait als **systemd-service**, dus het start vanzelf na een reboot
en blijft draaien als je uitlogt.

```bash
systemctl --user status cavascp    # draait het?
systemctl --user restart cavascp   # herstarten na een wijziging
systemctl --user stop cavascp      # stoppen
tail -f ~/cavascp/dashboard/server.log   # meekijken
```

Handmatig starten kan ook — handig tijdens ontwikkelen, want dan zie je fouten
direct:

```bash
cd ~/cavascp
systemctl --user stop cavascp        # eerst de service stoppen
./tools/start-dashboard.sh           # dan zelf starten
./tools/start-dashboard.sh --remote  # ook via Tailscale bereikbaar
pkill -f "node server.mjs"           # stoppen
```

Een service en een los proces kunnen niet allebei op poort 8787 zitten. Stop dus
altijd één van de twee.

## Wat er wel werkt en wat niet

| | |
|---|---|
| Canvas (token) | **werkt** — het token staat in `.env` |
| dashboard, documenten, leeruitkomsten | **werkt** |
| documentgenerator (Word, PowerPoint) | **werkt** — geen afhankelijkheden |
| Krava-projecten lezen | **werkt** — leest van schijf |
| **Portflow** | **werkt niet zonder inloggen** |

Portflow is het probleem. De brug start een browser en leunt op een ingelogde
Fontys-sessie. Die sessie zit in het Chrome-profiel op je laptop, maar dat
profiel is met Windows-sleutels versleuteld — kopiëren naar Linux helpt niet.
Je moet daar dus één keer opnieuw inloggen, en dat vereist een scherm.

Opties, in volgorde van eenvoud:

1. **Op de laptop laten.** Portflow-werk doe je op de Windows-machine; de
   stagebot en het denkwerk op de mini-pc. Ze delen dezelfde repo.
2. **Tijdelijk een scherm.** Start een VNC-server op de mini-pc, log één keer in
   bij Portflow via Chrome, en de sessie blijft bewaard in het profiel.
3. **X11-forwarding** met `ssh -X` — werkt, maar traag.

Wat Portflow nodig heeft staat in `browser/`. Het Canvas-deel heeft geen browser
nodig: dat gaat via het API-token.

## De stagebot

Die komt hier. De map `data/stagebot/` staat in `.gitignore`, want daar komt te
staan welke bedrijven je hebt benaderd en wat ze antwoordden — dat is een
zakelijk dossier, geen openbaar bestand.

## Wat er niet meer in git zit

Deze bestanden staan bewust buiten versiebeheer en moeten met de hand overgezet
worden als je op een nieuwe machine begint:

- `.env` — je Canvas-token
- `data/lo-koppeling.json` — je Portflow-doelen
- `data/documenten/` — je eigen documenten
- `docs/stage/` — cursusmateriaal van Fontys
- `browser/.chrome-profile/` — je Fontys-sessie

Op deze machine zijn `.env` en `data/lo-koppeling.json` al overgezet.

## Ondertussen op de laptop

Daar staat hetzelfde project. Als je op beide plekken werkt, trek dan voor je
begint even bij:

```bash
git pull
```

En na het werk:

```bash
git add -A && git commit -m "wat je deed" && git push
```
