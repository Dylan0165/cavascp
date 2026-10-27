/**
 * Een bedrijfssite lezen.
 *
 * Doel: genoeg weten om een mail te schrijven die niet generiek is. Dus niet
 * alleen de titel van de homepage, maar: wat doen ze, welke technologie
 * noemen ze, staat er een vacature of stageplek, en welk e-mailadres kunnen we
 * gebruiken.
 *
 * We halen een paar pagina's op — de homepage en, als die er is, de
 * contactpagina en de vacaturepagina. Meer niet: dit is geen crawler, en het is
 * onbeleefd om een server met tientallen verzoeken te belasten.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

/** Pagina's die we proberen, naast de homepage. */
const EXTRA_PADEN = [
  '/contact',
  '/contact/',
  '/contacteer-ons',
  '/over-ons',
  '/over-ons/',
  '/about',
  '/vacatures',
  '/vacatures/',
  '/werken-bij',
  '/stage',
  '/stages',
  '/careers',
];

/** Haalt HTML op. Geeft null als het niet lukt. */
async function haalHtml(url) {
  try {
    const antwoord = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!antwoord.ok) return null;
    const type = antwoord.headers.get('content-type') || '';
    if (!type.includes('html')) return null;
    const html = await antwoord.text();
    return { html, url: antwoord.url || url };
  } catch {
    return null;
  }
}

/** Maakt leesbare tekst van HTML. */
export function tekstVanHtml(html) {
  let uit = String(html)
    // Scripts en stijlen weg: daar staat geen inhoud in.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Blokelementen worden regeleinden.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // De rest is markup.
    .replace(/<[^>]+>/g, ' ');

  // Entiteiten die vaak voorkomen.
  uit = uit
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&euro;/g, '€')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  // Witruimte opruimen, maar alinea's heel laten.
  return uit
    .split('\n')
    .map((r) => r.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** De titel van de pagina. */
function titelVanHtml(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return schoonTitel(m[1].replace(/\s+/g, ' ').trim());
}

/**
 * Maakt een nette bedrijfsnaam van een paginatitel.
 *
 * "Home - Informa" is de titel van de pagina, maar het bedrijf heet Informa.
 * Zonder dit komt die rommel in je lijst én in de mail terecht, en dan begint
 * je bericht met "Beste team van Home - Informa".
 */
export function schoonTitel(titel) {
  let uit = String(titel || '').trim();

  // Delen die niets over het bedrijf zeggen.
  const rommel = /^(home|homepage|start|welkom|welcome|index|over ons|contact)$/i;

  // Splits op de scheidingstekens die sites gebruiken.
  const delen = uit
    .split(/\s*[|•·–—]\s*|\s+-\s+/)
    .map((d) => d.trim())
    .filter(Boolean);

  if (delen.length > 1) {
    // Het langste deel is meestal de bedrijfsnaam, maar "Home" is dat niet.
    const bruikbaar = delen.filter((d) => !rommel.test(d));
    if (bruikbaar.length) {
      // Kies het deel dat het meest op een naam lijkt: niet te lang, niet te kort.
      uit = bruikbaar.sort((a, b) => {
        const score = (s) => (s.length >= 3 && s.length <= 30 ? 100 : 0) - Math.abs(s.length - 12);
        return score(b) - score(a);
      })[0];
    }
  }

  return uit.replace(/\s+/g, ' ').trim();
}

/** De meta-omschrijving. */
function omschrijvingVanHtml(html) {
  const m =
    String(html).match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
    String(html).match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * Herkent een anti-bot-pagina.
 *
 * Steeds meer sites zetten een controle voor de deur: Cloudflare ("Just a
 * moment"), Anubis, een captcha. Zo'n pagina is kort, bevat geen echte inhoud,
 * en zou zonder deze controle als bedrijfsprofiel opgeslagen worden. Dan staat
 * er "Human verification" in je lijst als bedrijfsnaam en schrijf je een mail
 * naar niemand.
 *
 * Beter om het te herkennen en te zeggen: deze site houdt bots tegen, open hem
 * zelf even.
 */
const BOT_MARKERS = [
  'human verification',
  'checking if you',
  "you're human",
  'just a moment',
  'attention required',
  'enable javascript and cookies',
  'cf-browser-verification',
  'anubis',
  'ddos protection',
  'captcha',
  'are you a robot',
  'verify you are human',
  'access denied',
  'toegang geweigerd',
  'beveiligingscontrole',
];

export function isBotPagina(tekst, titel = '') {
  const samen = `${titel}\n${tekst}`.toLowerCase();
  const treffer = BOT_MARKERS.find((m) => samen.includes(m));
  if (!treffer) return null;

  // Een lange pagina met toevallig het woord "captcha" in de footer telt niet.
  // Een echte blokkade is kort en heeft nauwelijks inhoud.
  if (tekst.length > 1500) return null;

  return treffer;
}

/**
 * E-mailadressen uit de tekst.
 *
 * We filteren de rommel eruit die op elke site staat: voorbeeldadressen uit
 * templates, en dingen die op een bestandsnaam lijken (@2x.png). Een mail naar
 * `info@voorbeeld.nl` kost je een kans.
 */
export function vindEmails(tekst) {
  const ruw = String(tekst).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const nep = /(voorbeeld|example|domein\.nl|domain\.com|email\.com|jouw|uw\.|yourdomain|test@|naam@)/i;
  const bestand = /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?|ttf)$/i;

  const uniek = new Map();
  for (const adres of ruw) {
    const schoon = adres.toLowerCase().replace(/[.,;:]+$/, '');
    if (nep.test(schoon) || bestand.test(schoon)) continue;
    if (schoon.length > 60) continue;
    uniek.set(schoon, (uniek.get(schoon) ?? 0) + 1);
  }
  // Adressen die vaker voorkomen zijn meestal de echte.
  return [...uniek.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([adres]) => adres)
    .slice(0, 8);
}

/** Technologieën die we herkennen. Bewust kort: alleen wat iets zegt. */
const TECH = [
  'Python', 'JavaScript', 'TypeScript', 'Java', 'C#', '.NET', 'PHP', 'Go', 'Rust', 'Ruby',
  'React', 'Vue', 'Angular', 'Node.js', 'Laravel', 'Django', 'Spring',
  'AWS', 'Azure', 'Google Cloud', 'Kubernetes', 'Docker', 'Terraform',
  'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Snowflake', 'Databricks',
  'Power BI', 'Tableau', 'Qlik',
  'TensorFlow', 'PyTorch', 'scikit-learn', 'OpenAI', 'LLM', 'machine learning',
  'kunstmatige intelligentie', 'data science', 'computer vision', 'NLP',
  'penetration testing', 'pentesting', 'SOC', 'SIEM', 'ISO 27001', 'NEN 7510',
  'Fortinet', 'Cisco', 'Palo Alto', 'Microsoft Sentinel',
  'SAP', 'Salesforce', 'Novulo', 'Mendix', 'OutSystems', 'low-code',
  'Scrum', 'Agile', 'DevOps', 'CI/CD', 'Git',
];

/** Welke technologie noemt deze tekst? */
export function vindTech(tekst) {
  const laag = String(tekst).toLowerCase();
  const gevonden = [];
  for (const t of TECH) {
    const naam = t.toLowerCase();
    /*
     * Korte namen als "Go", "PHP" en "SQL" moeten als woord voorkomen. Zonder
     * woordgrens matcht "Go" op "Governance" en "Dataopslag", en dan staat er
     * ineens "Go" in de analyse terwijl ze niets met Go doen.
     */
    if (naam.length <= 4) {
      const veilig = naam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const grens = new RegExp(`(^|[^a-z0-9+#.])${veilig}([^a-z0-9+#]|$)`, 'i');
      if (grens.test(laag)) gevonden.push(t);
      continue;
    }
    if (laag.includes(naam)) gevonden.push(t);
  }
  return [...new Set(gevonden)];
}

/** Woorden die op een stage of vacature wijzen. */
export function vindStageSignaal(tekst) {
  const laag = String(tekst).toLowerCase();
  const termen = [
    'stage', 'stagiair', 'stageplek', 'stageplaats', 'internship', 'intern ',
    'afstuderen', 'afstudeerder', 'graduation', 'werken bij', 'vacature', 'vacatures',
    'we are hiring', 'join us', 'solliciteer',
  ];
  return termen.filter((t) => laag.includes(t));
}

/** Het adres normaliseren: https, geen slash aan het eind. */
export function normaliseerUrl(invoer) {
  let url = String(invoer).trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, '');
  return url;
}

/** Het domein uit een url, zonder www. */
export function domeinVan(url) {
  try {
    return new URL(normaliseerUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Leest een bedrijf van zijn website.
 *
 * @param {string} invoer  url of domein
 * @returns {Promise<object>}
 */export async function scanBedrijf(invoer) {
  const basis = normaliseerUrl(invoer);
  const eerste = await haalHtml(basis);
  if (!eerste) {
    throw new Error(`Kon ${basis} niet lezen. Bestaat de site, en blokkeert hij geen bots?`);
  }

  const eersteTekst = tekstVanHtml(eerste.html);
  const eersteTitel = titelVanHtml(eerste.html);

  /*
   * Eerst kijken of we niet naar een anti-bot-pagina zitten te kijken. Zo ja,
   * dan stoppen we meteen: doorgaan levert een bedrijfsprofiel op dat over
   * niets gaat, en een mail die naar niemand verwijst.
   */
  const blokkade = isBotPagina(eersteTekst, eersteTitel);
  if (blokkade) {
    const fout = new Error(
      `Deze site houdt geautomatiseerd bezoek tegen (${blokkade}). ` +
        'Open hem zelf in je browser en gebruik "scan --tekst" met de tekst die je ziet.',
    );
    fout.blokkade = blokkade;
    throw fout;
  }

  const paginas = [{ url: eerste.url, tekst: eersteTekst }];
  const titel = eersteTitel;
  const omschrijving = omschrijvingVanHtml(eerste.html);

  // Een paar extra pagina's proberen. Stil falen als ze niet bestaan.
  for (const pad of EXTRA_PADEN) {
    const url = basis + pad;
    const pagina = await haalHtml(url);
    if (!pagina) continue;
    const tekst = tekstVanHtml(pagina.html);
    if (tekst.length < 80) continue;
    // Niet twee keer dezelfde inhoud.
    if (paginas.some((p) => p.tekst.slice(0, 200) === tekst.slice(0, 200))) continue;
    paginas.push({ url: pagina.url, tekst });
  }

  const alles = paginas.map((p) => p.tekst).join('\n\n');

  return {
    url: basis,
    domein: domeinVan(basis),
    titel,
    omschrijving,
    emails: vindEmails(alles),
    tech: vindTech(alles),
    stageSignaal: vindStageSignaal(alles),
    paginas: paginas.map((p) => ({ url: p.url, tekens: p.tekst.length })),
    tekst: alles,
    gescand: new Date().toISOString(),
  };
}

/**
 * Een bedrijf lezen uit tekst die jij aanlevert.
 *
 * Voor sites die bots tegenhouden, zoals cco.nl met Anubis. Je opent de site
 * zelf, kopieert wat er staat, en plakt het hier in. De bot doet de rest: de
 *zelfde analyse, alleen zonder het ophalen.
 *
 * Dat is geen verslechtering: jij ziet de site beter dan een scraper, want jij
 * ziet ook de vacaturepagina's die achter een knop zitten.
 *
 * @param {string} invoer  de url of het domein, voor de administratie
 * @param {string} tekst   de tekst die je hebt gekopieerd
 * @param {object} [extra] titel en omschrijving als je die weet
 */
export function scanVanTekst(invoer, tekst, extra = {}) {
  const schoon = String(tekst || '')
    .split('\n')
    .map((r) => r.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  if (schoon.length < 60) {
    throw new Error('De tekst is te kort om iets mee te kunnen. Kopieer wat meer van de pagina.');
  }

  const basis = normaliseerUrl(invoer);

  return {
    url: basis,
    domein: domeinVan(basis),
    titel: extra.titel || titelVanTekst(schoon) || domeinVan(basis),
    omschrijving: extra.omschrijving || '',
    emails: vindEmails(schoon),
    tech: vindTech(schoon),
    stageSignaal: vindStageSignaal(schoon),
    paginas: [{ url: basis, tekens: schoon.length }],
    tekst: schoon,
    gescand: new Date().toISOString(),
    // Zodat je later weet dat dit niet automatisch is opgehaald.
    bron: 'handmatig',
  };
}

/** Een titel raden uit de eerste regels tekst. */
function titelVanTekst(tekst) {
  const eerste = String(tekst).split('\n').find((r) => r.length > 3 && r.length < 80);
  return eerste ? eerste.trim() : '';
}
