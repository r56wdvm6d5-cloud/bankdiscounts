// Shared helpers used by every per-bank scraper script.
//
// Design intent: since none of these scrapers have ever been run against the
// live, JS-rendered bank pages before, every run — not just failures — saves
// a full-page screenshot and a raw extracted-text dump alongside whatever
// structured data it manages to parse. That gives a human (or a future Claude
// session) something concrete to look at when a scraper's selectors need
// tuning, instead of a silent empty result.

const fs = require('fs');
const path = require('path');

const DEBUG_DIR = path.join(__dirname, '..', '..', '..', 'data', 'debug');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function saveDebugArtifacts(page, bankId) {
  ensureDir(DEBUG_DIR);
  const screenshotPath = path.join(DEBUG_DIR, `${bankId}.png`);
  const textPath = path.join(DEBUG_DIR, `${bankId}.txt`);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (e) {
    console.warn(`[${bankId}] could not save screenshot:`, e.message);
  }
  try {
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(textPath, text, 'utf8');
  } catch (e) {
    console.warn(`[${bankId}] could not save text dump:`, e.message);
  }
}

// Generic fallback extraction: scans visible text for lines that look like
// "<Merchant> ... <N>% ..." or "... <N>% ... at/on <Merchant>". This is
// intentionally loose — it's a safety net for when a bank's page doesn't
// match the hand-written selector strategy in that bank's own scraper, not
// a replacement for a tuned extractor.
function extractPercentLines(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const hits = [];
  const pctRe = /(\d{1,3})\s?%/;
  for (const line of lines) {
    const m = line.match(pctRe);
    if (m && line.length < 200) {
      hits.push({ raw: line, pct: parseInt(m[1], 10) });
    }
  }
  return hits;
}

function writeJsonIfChanged(outPath, data) {
  ensureDir(path.dirname(outPath));
  const next = JSON.stringify(data, null, 2) + '\n';
  const prev = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  const changed = prev !== next;
  fs.writeFileSync(outPath, next, 'utf8');
  return changed;
}

module.exports = { saveDebugArtifacts, extractPercentLines, writeJsonIfChanged, ensureDir, DEBUG_DIR };
