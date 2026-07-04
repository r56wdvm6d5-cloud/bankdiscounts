# Discount scraper pipeline

Keeps `data/discounts/*.json` current by scraping each bank's official
discounts page on a schedule, and opening a PR with any changes instead of
silently overwriting live data.

## How it runs

- GitHub Actions workflow `.github/workflows/scrape-discounts.yml` runs every
  Monday, plus on-demand via the "Run workflow" button in the Actions tab.
- Each bank has its own script under `scripts/scrapers/<bank>.js`, run as its
  own workflow step with `continue-on-error: true` — one bank's broken
  selectors don't block the others.
- Every run uploads a `scraper-debug-artifacts` artifact: a full-page
  screenshot and a raw text dump per bank (`data/debug/<bank>.png` /
  `.txt`), whether or not extraction succeeded. Check these before merging
  the PR, especially if a JSON file shows `"needs_review": true`.
- If any `data/discounts/*.json` changed, the workflow opens a PR
  (`auto/scraped-discount-updates` branch) instead of committing straight to
  main. Review the diff + debug screenshot, then merge.

## Current coverage

| Bank | Script | Status |
|---|---|---|
| Allied Bank (ABL) | `scrapers/abl.js` | First pass — untested against the live rendered page, selectors will likely need one tuning round after the first real run |
| Bank Alfalah | — | Not yet built |
| Askari Bank | — | Not yet built |
| Faysal Bank | — | Not yet built |
| Meezan Bank | — | Blocks automated access (bot detection) as of Jul 2026 — needs a different approach, not a simple Playwright script |

## Running a scraper locally

```bash
cd scripts
npm install
npx playwright install --with-deps chromium
node scrapers/abl.js
```

Check `data/debug/abl.png` and `abl.txt` to see exactly what the script saw,
and `data/discounts/abl.json` for what it parsed out.

## Adding a new bank

1. Copy `scrapers/abl.js` as a starting point.
2. Update `BANK_ID`, `URL`, and `CARD_SELECTORS` for the new site.
3. Add a step for it in `.github/workflows/scrape-discounts.yml` (a template
   is commented out at the bottom of the existing steps).
4. Run it locally first — checking `data/debug/<bank>.png` — before trusting
   the workflow to get it right on the first try.

## Why a PR instead of a silent commit

Discount data feeds real spending decisions in the comparator. A scraper
silently misreading "25%" or attaching it to the wrong merchant, with no
review step, is worse than not automating at all. The debug artifacts +
PR-review step exist specifically to keep a human check in the loop while
still removing the manual "go check five bank websites" chore.
