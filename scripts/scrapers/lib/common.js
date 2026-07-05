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
  const domPath = path.join(DEBUG_DIR, `${bankId}-dom-summary.txt`);
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
  try {
    const summary = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim().slice(0, 60),
        href: a.getAttribute('href'),
        cls: a.className,
      })).filter(l => l.text || l.href);
      const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
        alt: i.getAttribute('alt'),
        src: i.getAttribute('src'),
        cls: i.className,
      })).filter(i => i.alt);
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], [onclick]')).map(b => ({
        text: b.textContent.trim().slice(0, 60),
        cls: b.className,
      })).filter(b => b.text);
      return { links, imgs, buttons };
    });
    const lines = [
      `=== LINKS (${summary.links.length}) ===`,
      ...summary.links.map(l => `text="${l.text}" href="${l.href}" class="${l.cls}"`),
      '',
      `=== IMAGES WITH ALT TEXT (${summary.imgs.length}) ===`,
      ...summary.imgs.map(i => `alt="${i.alt}" src="${i.src}" class="${i.cls}"`),
      '',
      `=== BUTTONS / CLICKABLE (${summary.buttons.length}) ===`,
      ...summary.buttons.map(b => `text="${b.text}" class="${b.cls}"`),
    ];
    fs.writeFileSync(domPath, lines.join('\n'), 'utf8');
  } catch (e) {
    console.warn(`[${bankId}] could not save DOM summary:`, e.message);
  }

  // Full raw HTML — the most complete artifact. Catches things the summaries
  // above can miss (CSS background-image tiles instead of <img>, elements
  // built by a carousel plugin like Owl Carousel that don't show plain text
  // the way a normal page does, etc). Large, but it's the ground truth when
  // the lighter-weight dumps above don't explain what's on the page.
  const htmlPath = path.join(DEBUG_DIR, `${bankId}.html`);
  try {
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch (e) {
    console.warn(`[${bankId}] could not save full HTML:`, e.message);
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
