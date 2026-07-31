/**
 * Upload the two campaign banner PNGs to Cloudinary and print their URLs.
 *
 * The sent email needs a publicly-reachable HTTPS URL for every image — mail
 * clients cannot load localhost or a Vercel preview host, and this project's
 * `main` branch is not wired to auto-deploy (a push does not build/ship), so
 * `public/assets/campaign/*.png` is not actually live at metwork.dz. Rather
 * than requiring a full `vercel --prod` (which would ship the entire current
 * tree, not just these two images), this reuses the Cloudinary uploader
 * already configured for the app (`src/lib/cloudinary.ts`, used by the
 * consultant/admin upload routes) — no new external dependency.
 *
 * `overwrite: true` + a fixed `publicId` (in cloudinary.ts's uploadBuffer)
 * means re-running this after editing the source SVGs updates the SAME URL —
 * no stale links, no need to touch email.ts again.
 *
 * Run: npx tsx scripts/campaigns/upload-assets.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(`✘ ${envPath} not found.`);
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
}

async function main(): Promise<void> {
  loadEnv();
  const { isConfigured, uploadBuffer } = await import('../../src/lib/cloudinary');

  if (!isConfigured()) {
    console.error('✘ Cloudinary env vars missing (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET).');
    process.exit(1);
  }

  const dir = path.resolve(process.cwd(), 'public/assets/campaign');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  if (files.length === 0) {
    console.error(`✘ No PNGs in ${dir} — run render-assets.ts first.`);
    process.exit(1);
  }

  const urls: Record<string, string> = {};
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(dir, file));
    const publicId = file.replace(/\.png$/, '');
    const url = await uploadBuffer(buffer, { folder: 'metwork/campaign', publicId });
    urls[publicId] = url;
    console.log(`✓ ${file} → ${url}`);
  }

  console.log('\nPaste these into CAMPAIGN_IMAGE_URLS in src/server/notifications/email.ts:');
  console.log(JSON.stringify(urls, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
