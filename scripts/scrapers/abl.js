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
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'discounts', `${BANK_ID}.json`);

// Candidate selectors for the repeating "offer card" element. Tried in order;
// first one that matches multiple elements wins. Update this list once the
// real markup is visible in the debug dump.
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

// Some bank sites gate their discount list behind a card-tier tab/filter
// (e.g. "Classic / Gold / Platinum / Infinite"). We log any tab-like controls
// found so a human can tell us which one to click for ABL-INFINITE
// specifically, since the default view may only show one tier.
async function logPossibleTabs(page) {
  const candidates = await page.$$eval(
    'button, [role="tab"], .tab, .tabs a, [class*="tab"]',
    els => els.map(e => e.textContent.trim()).filter(Boolean).slice(0, 40)
  );
  if (candidates.length) {
    console.log('[abl] possible tab/filter controls found on page:', JSON.stringify(candidates));
  } else {
    console.log('[abl] no tab/filter-like controls detected');
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log(`[abl] navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => {
    console.warn('[abl] navigation warning (continuing anyway):', e.message);
  });
  // Give any lazy/async widgets a bit more time beyond networkidle.
  await page.waitForTimeout(2500);

  await logPossibleTabs(page);

  let cards = await tryExtractCards(page);
  let method = 'structured';

  if (!cards) {
    console.log('[abl] no structured card selector matched — falling back to text-pattern scan');
    const bodyText = await page.evaluate(() => document.body.innerText);
    cards = extractPercentLines(bodyText).map(h => ({
      merchant: null, // fallback can't reliably separate merchant name from surrounding text
      discount_pct: h.pct,
      raw_text: h.raw,
    }));
    method = 'fallback_text_scan';
  }

  await saveDebugArtifacts(page, BANK_ID);
  await browser.close();

  const payload = {
    bank: 'Allied Bank',
    source_url: URL,
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
