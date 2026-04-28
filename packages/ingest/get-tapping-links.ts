import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://www.fbk.org/tapping-classes', { waitUntil: 'networkidle', timeout: 25000 });
await new Promise(r => setTimeout(r, 2000));

// Get all blocks with their text label + link
const blocks = await page.evaluate(() => {
  const results: Array<{ label: string; href: string }> = [];
  // Find all links to Google Drive
  const links = Array.from(document.querySelectorAll('a[href*="drive.google.com"]'));
  for (const link of links) {
    // Walk up to find the closest section/block with a label
    let el: Element | null = link;
    let label = '';
    // Search siblings and parent for text
    for (let i = 0; i < 6; i++) {
      el = el?.parentElement ?? null;
      if (!el) break;
      const text = el.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      if (text.length > 2 && text.length < 200) {
        label = text.slice(0, 100);
        break;
      }
    }
    results.push({ label, href: (link as HTMLAnchorElement).href });
  }
  return results;
});

// Deduplicate
const seen = new Set<string>();
for (const b of blocks) {
  if (!seen.has(b.href)) {
    seen.add(b.href);
    console.log(`[${b.label}] → ${b.href}`);
  }
}

await browser.close();
