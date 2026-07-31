/**
 * Rasterise the campaign SVG sources to retina PNGs.
 *
 * Email clients do NOT render SVG (Gmail, Outlook and Apple Mail all drop or
 * blank it), so the announcement email can only reference PNGs. The SVGs in
 * `assets/` are the editable source of truth; this script renders each one at
 * 2x into `public/assets/campaign/` where it is served publicly from
 * https://metwork.dz/assets/campaign/<name>.png — the same public origin the
 * shared email `layout()` already uses for the logo.
 *
 * Run: npx tsx scripts/campaigns/render-assets.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';

const SRC_DIR = path.resolve(process.cwd(), 'scripts/campaigns/assets');
const OUT_DIR = path.resolve(process.cwd(), 'public/assets/campaign');

/** Logical (CSS) size of each banner — rendered at 2x for retina displays. */
const WIDTH = 480;
const HEIGHT = 160;
const SCALE = 2;

async function main(): Promise<void> {
  const sources = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.svg'));
  if (sources.length === 0) {
    console.error(`✘ No .svg files in ${SRC_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
  });

  for (const file of sources) {
    const svg = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    await page.setContent(
      `<body style="margin:0;padding:0;">${svg}</body>`,
      { waitUntil: 'load' },
    );
    const out = path.join(OUT_DIR, file.replace(/\.svg$/, '.png'));
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    const kb = (fs.statSync(out).size / 1024).toFixed(1);
    console.log(`✓ ${file} → ${path.relative(process.cwd(), out)} (${WIDTH * SCALE}×${HEIGHT * SCALE}, ${kb} KB)`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
