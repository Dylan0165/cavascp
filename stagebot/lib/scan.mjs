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
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
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
 */
export async function scanBedrijf(invoer) {
  const basis = normaliseerUrl(invoer);
  const eerste = await haalHtml(basis);
  if (!eerste) {
    throw new Error(`Kon ${basis} niet lezen. Bestaat de site, en blokkeert hij geen bots?`);
  }

  const paginas = [{ url: eerste.url, tekst: tekstVanHtml(eerste.html) }];
  const titel = titelVanHtml(eerste.html);
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
