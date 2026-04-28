import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://www.fbk.org/tapping-classes', { waitUntil: 'networkidle', timeout: 25000 });
await new Promise(r => setTimeout(r, 2000));

const links = await page.$$eval('a[href]', els => els.map(el => (el as HTMLAnchorElement).href));
console.log('=== All links on tapping-classes page ===');
links.forEach(l => console.log(' ', l));

const text = await page.evaluate(() => document.body.innerText);
console.log('\n=== Page text (first 2000 chars) ===');
console.log(text.slice(0, 2000));

await browser.close();
