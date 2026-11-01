/**
 * Draws the home-screen icons from the brand mark (Logo in src/components/Brand.tsx) and writes
 * them to public/icons/. Uses the system Chrome through playwright-core to rasterise the SVG, so
 * nothing new is installed. Run again only if the mark changes.
 *
 *   node scripts/gen-icons.cjs
 */
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
let chromium, launchOpts = {};
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); launchOpts = { channel: 'chrome' }; }

const BRAND = '#167D78';
const LINES = `
  <path d="M7 20.5 12 15.5l4 3.5 4.5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="m19.5 21 2.5 2.5 4.5-5" fill="none" stroke="#a7e3d8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
// The mark as drawn in the app: a rounded square.
const ANY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${BRAND}"/>${LINES}</svg>`;
// Maskable: full-bleed colour, the lines shrunk into the central safe zone (Android crops to a circle or squircle).
const MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BRAND}"/><g transform="translate(16 16) scale(0.8) translate(-16.75 -18.5)">${LINES}</g></svg>`;

(async () => {
  const out = join(__dirname, '..', 'public', 'icons');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'icon.svg'), ANY);
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const shots = [
    ['icon-192.png', ANY, 192, true], ['icon-512.png', ANY, 512, true],
    ['maskable-512.png', MASKABLE, 512, false],
  ];
  for (const [name, svg, size, transparent] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.locator('svg').screenshot({ path: join(out, name), omitBackground: transparent });
    console.log('wrote', name);
  }
  await browser.close();
})();
