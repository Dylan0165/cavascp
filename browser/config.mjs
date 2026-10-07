/**
 * Centrale configuratie voor de browserautomatisering.
 *
 * Het profiel bevat je sessiecookies en is daarmee net zo gevoelig als een
 * wachtwoord. Het staat daarom in .gitignore en wordt nooit gelogd.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Playwright staat in de Dropshipping-tools; geen tweede installatie van
 * ~400 MB nodig.
 *
 * Dit moet een file:// URL zijn: de ESM-loader weigert een kaal Windows-pad
 * ("Received protocol 'd:'").
 */
const PLAYWRIGHT_ENTRY = 'D:/Dropshippingv0.1tool/.mcp-tools/node_modules/playwright/index.mjs';

/** Installed Chrome, in volgorde van voorkeur. */
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
];

function detectChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const chromePath = detectChrome();

export const CONFIG = {
  /** Persistent Chrome-profiel. Hierin leeft je ingelogde sessie. */
  profileDir: process.env.CAVASCP_PROFILE || path.join(HERE, '.chrome-profile'),

  /** Waar de verkenning zijn bevindingen neerschrijft. */
  outDir: path.join(HERE, 'out'),

  canvasBase: 'https://fhict.instructure.com',

  /**
   * Portflow draait op portfolio.drieam.app, NIET op app.portflow.app. De
   * LTI-launch landt in een iframe op deze host. Een verkeerde host betekent
   * dat je de app niet vindt terwijl hij wel degelijk openstaat.
   */
  portflowHost: 'portfolio.drieam.app',
  portflowBase: 'https://portfolio.drieam.app',

  /** Canvas-toolpagina die Portflow opent. */
  portfolioLaunch:
    'https://fhict.instructure.com/accounts/1/external_tools/23360?launch_type=global_navigation&toolId=portfolio-23360',

  /** Portflow start hier; handig als directe landingspagina. */
  portflowEntry: 'https://portfolio.drieam.app/portfolio/collections',

  playwrightEntry: PLAYWRIGHT_ENTRY,
  playwrightUrl: pathToFileURL(PLAYWRIGHT_ENTRY).href,

  /**
   * Je eigen Chrome heeft de voorkeur: herkenbaar, en mogelijk al ingelogd.
   * Zonder Chrome valt Playwright terug op zijn eigen Chromium.
   */
  chromePath,
  browserLabel: chromePath ? `Chrome (${path.basename(path.dirname(path.dirname(chromePath)))})` : 'Playwright Chromium',

  viewport: { width: 1440, height: 950 },

  /**
   * Chrome's headless modus zet "HeadlessChrome" in de user agent. Dat is een
   * automatiseringssignaal dat ADFS en Canvas kunnen opmerken, en een
   * geblokkeerd account is het laatste wat we willen. Daarom doen we ons voor
   * als gewone Chrome — wat het in werkelijkheid ook is.
   */
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',

  /**
   * Hoe lang we wachten tot jij ingelogd bent. De eerste keer kost dit je een
   * login met 2FA; daarna hergebruikt het profiel de sessie.
   */
  loginTimeoutMs: 8 * 60 * 1000,
};

export const URLS = {
  canvasLogin: `${CONFIG.canvasBase}/login`,
  canvasDashboard: `${CONFIG.canvasBase}/`,
  eportfolios: `${CONFIG.canvasBase}/api/v1/users/self/eportfolios`,
};
