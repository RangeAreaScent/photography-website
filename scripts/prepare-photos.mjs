// Resize originals → optimized files in src/content/.
//
// Usage:
//   npm run prepare-photos   (or it runs automatically before dev/build)
//
// How it works:
//   - Walks ./originals/, mirrors structure under ./src/content/
//   - Each .jpg/.JPG → resized to long-side 3000px max, JPEG quality 90,
//     EXIF stripped (incl. GPS), filename lowercased
//   - Skips files where dest is newer than source (incremental)
//   - Skips any folder starting with "_" or "." (e.g. _candidates/, .DS_Store)

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE = 'originals';
const DEST = 'src/content';
const MAX_LONG_SIDE = 3000;
const QUALITY = 90;

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function shouldSkip(srcPath, destPath) {
  try {
    const [src, dest] = await Promise.all([fs.stat(srcPath), fs.stat(destPath)]);
    return dest.mtime > src.mtime;
  } catch {
    return false;
  }
}

async function processFile(srcPath, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await sharp(srcPath)
    .rotate()
    .resize({
      width: MAX_LONG_SIDE,
      height: MAX_LONG_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(destPath);
}

let processed = 0;
let skipped = 0;
let total = 0;

async function walk(srcDir, destDir) {
  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const src = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      await walk(src, path.join(destDir, entry.name));
    } else if (/\.(jpe?g)$/i.test(entry.name)) {
      total++;
      const destName = entry.name.replace(/\.(jpe?g)$/i, '.jpg');
      const dest = path.join(destDir, destName);
      if (await shouldSkip(src, dest)) {
        skipped++;
        continue;
      }
      const before = (await fs.stat(src)).size;
      await processFile(src, dest);
      const after = (await fs.stat(dest)).size;
      const mb = (n) => (n / 1024 / 1024).toFixed(1);
      console.log(`  ${path.relative(SOURCE, src)} → ${path.relative(DEST, dest)}  (${mb(before)}MB → ${mb(after)}MB)`);
      processed++;
    }
  }
}

if (!(await exists(SOURCE))) {
  console.log(`No ${SOURCE}/ directory — nothing to prepare.`);
  process.exit(0);
}

console.log(`Preparing photos: ${SOURCE}/ → ${DEST}/\n`);
await walk(SOURCE, DEST);
console.log(`\n  ${processed} processed, ${skipped} unchanged, ${total} total.\n`);
