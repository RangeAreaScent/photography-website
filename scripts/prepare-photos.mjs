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
import matter from 'gray-matter';

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

// Removes JPEGs in src/content/ that aren't referenced by any .md frontmatter.
// Keeps src/content/ a strict mirror of what's actually published, so orphans
// don't pile up in git over time. Driven by .md references (not by originals/)
// so this works even for entries whose source lives only in src/content/.
let pruned = 0;
async function pruneOrphans() {
  // Map of directory → Set of allowed filenames
  const allowed = new Map();

  const worksDir = path.join(DEST, 'works');
  if (await exists(worksDir)) {
    const mds = (await fs.readdir(worksDir)).filter((f) => f.endsWith('.md'));
    for (const f of mds) {
      const slug = f.replace(/\.md$/, '');
      const md = matter(await fs.readFile(path.join(worksDir, f), 'utf-8'));
      const set = new Set();
      for (const p of md.data.photos ?? []) {
        if (typeof p.src === 'string') set.add(p.src.split('/').pop());
      }
      allowed.set(path.join(worksDir, slug), set);
    }
  }

  const monthlyDir = path.join(DEST, 'monthly');
  if (await exists(monthlyDir)) {
    const set = new Set();
    const mds = (await fs.readdir(monthlyDir)).filter((f) => f.endsWith('.md'));
    for (const f of mds) {
      const md = matter(await fs.readFile(path.join(monthlyDir, f), 'utf-8'));
      if (typeof md.data.photo === 'string') set.add(md.data.photo.split('/').pop());
    }
    allowed.set(monthlyDir, set);
  }

  for (const [dir, set] of allowed) {
    let files;
    try {
      files = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    for (const f of files) {
      if (!f.isFile()) continue;
      if (!/\.(jpe?g)$/i.test(f.name)) continue;
      if (set.has(f.name)) continue;
      const dest = path.join(dir, f.name);
      await fs.unlink(dest);
      console.log(`  pruned: ${path.relative(DEST, dest)}`);
      pruned++;
    }
  }
}

if (!(await exists(SOURCE))) {
  console.log(`No ${SOURCE}/ directory — nothing to prepare.`);
  process.exit(0);
}

const shouldPrune = process.argv.includes('--prune');

console.log(`Preparing photos: ${SOURCE}/ → ${DEST}/\n`);
await walk(SOURCE, DEST);
if (shouldPrune) {
  await pruneOrphans();
}
const pruneNote = shouldPrune
  ? `, ${pruned} pruned`
  : '';
console.log(`\n  ${processed} processed, ${skipped} unchanged${pruneNote}, ${total} total.`);
if (!shouldPrune) {
  console.log(`  (run with --prune to remove src/content/ files not referenced by any .md)`);
}
console.log();
