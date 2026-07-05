// Scrapes Allied Bank's "Latest Offers" page. This page renders its actual
// merchant/discount list client-side (a plain fetch of the URL returns only
// the site's nav/footer, confirmed manually before writing this), so a real
// browser context is required — this is why the scraper runs inside GitHub
// Actions rather than as a simple HTTP fetch.
//
// FIRST-RUN NOTE: nobody has run this against the live, rendered page yet.
// The selector strategy below is a best-effort guess based on how ABL's
// other pages are marked up. If it comes back with zero merchants, check
// data/debug/abl.png and data/debug/abl.txt (saved every run, pass or fail)
// to see what the page actually rendered, then tighten the selectors here.

const { chromium } = require('playwright');
const path = require('path');
const { saveDebugArtifacts, extractPercentLines, writeJsonIfChanged } = require('./lib/common');

const BANK_ID = 'abl';
const URL = 'https://www.abl.com/latest-offers/';
const CITY = 'Lahore'; // matches the comparator's own Lahore localization
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'discounts', `${BANK_ID}.json`);

// Candidate selectors for the repeating "offer card" element, tried against
// the page AFTER a city is selected (the landing page itself is just a city
// picker — confirmed from a first run's screenshot, no offers live there).
const CARD_SELECTORS = [
  '.offer-card',
  '.offers-list .card',
  '.latest-offer',
  '[class*="offer-item"]',
  '[class*="offer-card"]',
  '.discount-card',
  'article',
];

async function tryExtractCards(page) {
  for (const sel of CARD_SELECTORS) {
    const els = await page.$$(sel);
    if (els.length >= 3) {
      console.log(`[abl] matched ${els.length} elements with selector "${sel}"`);
      const results = [];
      for (const el of els) {
        const text = (await el.innerText()).trim();
        if (!text) continue;
        const pctMatch = text.match(/(\d{1,3})\s?%/);
        const firstLine = text.split('\n')[0].trim();
        results.push({
          merchant: firstLine,
          discount_pct: pctMatch ? parseInt(pctMatch[1], 10) : null,
          raw_text: text.slice(0, 300),
        });
      }
      return results;
    }
  }
  return null;
}

// Clicks the tile/link for our target city on the city-picker landing page.
// Returns true if a click + subsequent navigation/content-load happened.
async function selectCity(page, city) {
  const locator = page.locator(`text=${city}`).first();
  const count = await locator.count();
  if (count === 0) {
    console.log(`[abl] no element found matching city text "${city}"`);
    return false;
  }

  const beforeUrl = page.url();
  try {
    await Promise.all([
      page.waitForNavigation({ timeout: 8000 }).catch(() => null), // may not actually navigate — could be same-page AJAX
      locator.click(),
    ]);
  } catch (e) {
    console.log(`[abl] click on "${city}" raised:`, e.message);
  }
  await page.waitForTimeout(2500); // give AJAX-loaded content time to render either way

  const afterUrl = page.url();
  console.log(`[abl] after clicking "${city}": url ${beforeUrl === afterUrl ? 'unchanged (likely AJAX)' : 'changed to ' + afterUrl}`);
  return true;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log(`[abl] navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => {
    console.warn('[abl] navigation warning (continuing anyway):', e.message);
  });
  await page.waitForTimeout(1500);

  const clicked = await selectCity(page, CITY);
  if (!clicked) {
    console.log('[abl] could not select a city — saving landing-page debug artifacts only');
  }

  let cards = await tryExtractCards(page);
  let method = 'structured';

  if (!cards) {
    console.log('[abl] no structured card selector matched — falling back to text-pattern scan');
    const bodyText = await page.evaluate(() => document.body.innerText);
    cards = extractPercentLines(bodyText).map(h => ({
      merchant: null,
      discount_pct: h.pct,
      raw_text: h.raw,
    }));
    method = 'fallback_text_scan';
  }

  await saveDebugArtifacts(page, BANK_ID); // now captures the post-city-selection state
  await browser.close();

  const payload = {
    bank: 'Allied Bank',
    source_url: URL,
    city: CITY,
    scraped_at: new Date().toISOString(),
    extraction_method: method,
    needs_review: method === 'fallback_text_scan' || cards.length === 0,
    count: cards.length,
    offers: cards,
  };

  const changed = writeJsonIfChanged(OUT_PATH, payload);
  console.log(`[abl] wrote ${cards.length} offers via "${method}" (changed: ${changed})`);
  if (payload.needs_review) {
    console.log('[abl] ⚠ needs_review=true — check data/debug/abl.png and abl.txt before trusting this data');
  }
})();
