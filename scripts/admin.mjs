// Local admin server for d612.space.
// Run with: npm run admin
// Opens http://localhost:4322 in your browser.

import express from 'express';
import multer from 'multer';
import matter from 'gray-matter';
import sharp from 'sharp';
import exifr from 'exifr';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import open from 'open';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 4322;

const ORIGINALS = path.join(ROOT, 'originals');
const CONTENT = path.join(ROOT, 'src/content');
const CANDIDATES_DIR = '_candidates';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'admin-ui')));

// ---------- helpers ----------

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function cleanFilename(name) {
  return name.toLowerCase().replace(/\.(jpe?g)$/i, '.jpg');
}

// Run a git subcommand capturing stdout/stderr as strings.
// Throws on non-zero exit unless allowFail is true (then returns { ok: false }).
function runGit(args, { allowFail = false } = {}) {
  try {
    const stdout = execSync(`git ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    if (allowFail) {
      return { ok: false, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message) };
    }
    const msg = String(e.stderr ?? e.stdout ?? e.message);
    const err = new Error(`git ${args.join(' ')} failed: ${msg}`);
    err.stdout = e.stdout;
    err.stderr = e.stderr;
    throw err;
  }
}

async function listWorks() {
  const dir = path.join(CONTENT, 'works');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  const series = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(dir, f), 'utf-8');
    const { data } = matter(raw);
    series.push({
      slug: f.replace(/\.md$/, ''),
      title: data.title,
      year: data.year,
      order: data.order,
      photoCount: Array.isArray(data.photos) ? data.photos.length : 0,
    });
  }
  series.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return series;
}

async function listMonthly() {
  const dir = path.join(CONTENT, 'monthly');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  const entries = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(dir, f), 'utf-8');
    const { data } = matter(raw);
    entries.push({
      slug: f.replace(/\.md$/, ''),
      date: data.date,
      caption: data.caption,
    });
  }
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));
  return entries;
}

async function loadEntry(section, slug) {
  const filePath =
    section === 'monthly'
      ? path.join(CONTENT, 'monthly', slug + '.md')
      : path.join(CONTENT, 'works', slug + '.md');
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  return { data: parsed.data, content: parsed.content };
}

async function listOriginalFiles(section, slug) {
  const dir =
    section === 'monthly'
      ? path.join(ORIGINALS, 'monthly')
      : path.join(ORIGINALS, 'works', slug);
  const result = { top: [], candidates: [] };
  if (!(await exists(dir))) return result;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && /\.(jpe?g)$/i.test(e.name)) result.top.push(e.name);
  }
  const candDir = path.join(dir, CANDIDATES_DIR);
  if (await exists(candDir)) {
    const cands = await fs.readdir(candDir, { withFileTypes: true });
    for (const e of cands) {
      if (e.isFile() && /\.(jpe?g)$/i.test(e.name)) result.candidates.push(e.name);
    }
  }
  return result;
}

// Rewrites .md photo src after a rename so the .md and disk stay in sync.
async function renameInMarkdown(section, slug, oldName, newName) {
  if (section !== 'works') return;
  const mdPath = path.join(CONTENT, 'works', slug + '.md');
  if (!(await exists(mdPath))) return;
  const raw = await fs.readFile(mdPath, 'utf-8');
  const parsed = matter(raw);
  let touched = false;
  if (Array.isArray(parsed.data.photos)) {
    for (const p of parsed.data.photos) {
      if (typeof p.src === 'string' && p.src.endsWith('/' + oldName)) {
        p.src = p.src.replace(oldName, newName);
        touched = true;
      }
    }
  }
  if (touched) await fs.writeFile(mdPath, matter.stringify(parsed.content, parsed.data));
}

// ---------- routes ----------

app.get('/api/state', async (req, res) => {
  try {
    const [works, monthly] = await Promise.all([listWorks(), listMonthly()]);
    res.json({ works, monthly });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/entry/:section/:slug', async (req, res) => {
  try {
    const { section, slug } = req.params;
    const entry = await loadEntry(section, slug);
    const { top, candidates } = await listOriginalFiles(section, slug);
    res.json({ ...entry, originals: top, candidates });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ---------- EXIF ----------
//
// Returns { datetime, city, gps } for a single photo. `city` requires GPS
// tags in the file and a successful Nominatim lookup. Reverse-geocoding is
// cached in memory (keyed on coord rounded to 3 decimal places ≈ 100m) so a
// series of nearby photos hits the network at most once.
const geoCache = new Map();
let lastGeoRequestAt = 0;

async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (geoCache.has(key)) return geoCache.get(key);

  // Nominatim policy: max 1 request/second.
  const wait = Math.max(0, 1100 - (Date.now() - lastGeoRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeoRequestAt = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`;
    const r = await fetch(url, { headers: { 'User-Agent': 'd612-admin/1.0 (personal photography site)' } });
    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    const j = await r.json();
    const a = j.address ?? {};
    const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.county ?? null;
    const region = a.state ?? a.region ?? a.country ?? null;
    const label = city && region ? `${city}, ${region}` : city ?? region ?? null;
    geoCache.set(key, label);
    return label;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

app.get('/api/exif/:section/:slug/:filename', async (req, res) => {
  const { section, slug, filename } = req.params;
  const candidates =
    section === 'monthly'
      ? [path.join(ORIGINALS, 'monthly', filename)]
      : [
          path.join(ORIGINALS, 'works', slug, filename),
          path.join(ORIGINALS, 'works', slug, CANDIDATES_DIR, filename),
        ];

  for (const filePath of candidates) {
    try {
      const raw = await exifr.parse(filePath, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'DateTime', 'latitude', 'longitude'] });
      if (!raw) continue;
      const dt = raw.DateTimeOriginal ?? raw.CreateDate ?? raw.DateTime ?? null;
      const datetime = dt instanceof Date ? dt.toISOString() : dt;
      let city = null;
      let gps = null;
      if (typeof raw.latitude === 'number' && typeof raw.longitude === 'number') {
        gps = { lat: raw.latitude, lon: raw.longitude };
        city = await reverseGeocode(raw.latitude, raw.longitude);
      }
      return res.json({ datetime, city, gps });
    } catch {
      // try next
    }
  }
  res.status(404).json({ error: 'No EXIF found (or file missing).' });
});

// Thumbnail proxy — tries originals/ first, falls back to src/content/.
app.get(/^\/thumb\/(.+)$/, async (req, res) => {
  const rel = req.params[0];
  const candidates = [path.join(ORIGINALS, rel), path.join(CONTENT, rel)];
  for (const filePath of candidates) {
    try {
      const buffer = await sharp(filePath)
        .rotate()
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      res.type('image/jpeg').send(buffer);
      return;
    } catch {
      // try next
    }
  }
  res.status(404).end();
});

// Upload photos to originals/[section]/[slug]/ (top level).
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const { section, slug } = req.body;
      const dir =
        section === 'monthly'
          ? path.join(ORIGINALS, 'monthly')
          : path.join(ORIGINALS, 'works', slug);
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, cleanFilename(file.originalname)),
  }),
});

app.post('/api/upload', upload.array('photos'), (req, res) => {
  const filenames = req.files.map((f) => f.filename);
  res.json({ filenames });
});

// Rename a photo file. Renames in originals/ AND src/content/, and rewrites
// the .md src reference so the page keeps pointing at the new name.
app.post('/api/rename-file', async (req, res) => {
  try {
    const { section, slug, oldName, newName } = req.body;
    const clean = cleanFilename(newName);
    if (!/^[a-z0-9._-]+\.jpg$/.test(clean)) {
      return res.status(400).json({ error: 'Use lowercase letters, digits, dot, dash, underscore.' });
    }
    if (clean === oldName) return res.json({ ok: true, newName: clean });

    const dirs =
      section === 'monthly'
        ? [path.join(ORIGINALS, 'monthly'), path.join(CONTENT, 'monthly')]
        : [path.join(ORIGINALS, 'works', slug), path.join(CONTENT, 'works', slug)];

    // Confirm new name doesn't already exist
    for (const d of dirs) {
      if (await exists(path.join(d, clean))) {
        return res.status(409).json({ error: 'A file with that name already exists.' });
      }
    }

    let didAnyRename = false;
    for (const d of dirs) {
      const oldP = path.join(d, oldName);
      const newP = path.join(d, clean);
      try {
        await fs.rename(oldP, newP);
        didAnyRename = true;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    if (!didAnyRename) {
      return res.status(404).json({ error: `File '${oldName}' not found in this series.` });
    }

    await renameInMarkdown(section, slug, oldName, clean);

    res.json({ ok: true, newName: clean });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Move a photo between top-level (series picks) and _candidates/ (not used).
// to: 'series' or 'candidates'.
app.post('/api/move-file', async (req, res) => {
  try {
    const { section, slug, filename, to } = req.body;
    if (section !== 'works') return res.status(400).json({ error: 'Works only.' });
    const dir = path.join(ORIGINALS, 'works', slug);
    const candDir = path.join(dir, CANDIDATES_DIR);
    await fs.mkdir(candDir, { recursive: true });

    const src = to === 'series' ? path.join(candDir, filename) : path.join(dir, filename);
    const dest = to === 'series' ? path.join(dir, filename) : path.join(candDir, filename);

    try {
      await fs.rename(src, dest);
    } catch (e) {
      if (e.code === 'ENOENT') {
        const where = to === 'series' ? '_candidates/' : 'top-level folder';
        return res.status(404).json({ error: `'${filename}' not found in ${where}.` });
      }
      throw e;
    }

    // If demoting to candidates, also drop the processed copy in src/content/
    // (it'll get regenerated if the photo is promoted back later).
    if (to === 'candidates') {
      const processed = path.join(CONTENT, 'works', slug, cleanFilename(filename));
      try {
        await fs.unlink(processed);
      } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Move a single photo to originals/_archive/<section>/<slug>/. Mirrors
// the active folder structure under _archive/. Used by the "archive"
// action on candidates (and could be used elsewhere later).
async function archivePhotoFile(section, slug, sourcePath, filename) {
  const archiveDir =
    section === 'monthly'
      ? path.join(ORIGINALS, '_archive', 'monthly')
      : path.join(ORIGINALS, '_archive', 'works', slug);
  await fs.mkdir(archiveDir, { recursive: true });

  let destPath = path.join(archiveDir, filename);
  if (await exists(destPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = path.extname(filename);
    const base = filename.slice(0, -ext.length);
    destPath = path.join(archiveDir, `${base}-${stamp}${ext}`);
  }
  await fs.rename(sourcePath, destPath);
  return path.relative(ROOT, destPath);
}

// Archive a single photo (non-destructive). Reads the photo from its
// current location (candidates by default; series top-level if from=='series')
// and moves it under originals/_archive/<section>/<slug>/.
app.post('/api/archive-photo', async (req, res) => {
  try {
    const { section, slug, filename, from = 'candidates' } = req.body;
    if (section !== 'works') return res.status(400).json({ error: 'Works only.' });

    const sourcePath =
      from === 'series' || from === 'untracked'
        ? path.join(ORIGINALS, 'works', slug, filename)
        : path.join(ORIGINALS, 'works', slug, CANDIDATES_DIR, filename);

    const archivedTo = await archivePhotoFile(section, slug, sourcePath, filename);

    // Drop the processed copy from src/content/ if it exists
    const processed = path.join(
      CONTENT,
      'works',
      slug,
      filename.replace(/\.(jpe?g)$/i, '.jpg'),
    );
    try {
      await fs.unlink(processed);
    } catch {}

    res.json({ ok: true, archivedTo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete an entire works series.
//
// Removes the .md and src/content/works/[slug]/ folder, then MOVES
// originals/works/[slug]/ → originals/_archive/works/[slug]/ (keeping
// the same internal structure, including any _candidates/ subfolder).
// The archive lives outside the active workflow but stays on disk so
// the user can restore by moving the folder back and re-creating .md.
// Slug collisions inside _archive/ get a timestamp suffix.
app.delete('/api/series/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    let archivedTo = null;

    // Move originals to _archive/ (if they exist).
    const origDir = path.join(ORIGINALS, 'works', slug);
    if (await exists(origDir)) {
      const archiveBase = path.join(ORIGINALS, '_archive', 'works');
      await fs.mkdir(archiveBase, { recursive: true });
      let archiveDir = path.join(archiveBase, slug);
      if (await exists(archiveDir)) {
        const stamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, 19);
        archiveDir = path.join(archiveBase, `${slug}-archived-${stamp}`);
      }
      await fs.rename(origDir, archiveDir);
      archivedTo = path.relative(ROOT, archiveDir);
    }

    // Remove the .md and processed copies from src/content/.
    const mdPath = path.join(CONTENT, 'works', slug + '.md');
    try {
      await fs.unlink(mdPath);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    try {
      await fs.rm(path.join(CONTENT, 'works', slug), { recursive: true, force: true });
    } catch {}

    try {
      runGit(['add', '-A']);
      const commit = runGit(['commit', '-m', `works: delete ${slug}`], { allowFail: true });
      if (!commit.ok && !/nothing to commit/.test(commit.stdout + commit.stderr)) {
        throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
      }
      runGit(['push']);
    } catch (e) {
      return res.status(500).json({
        error: `Series files removed locally, but git sync failed: ${e.message}. Fix manually and rerun.`,
        archivedTo,
      });
    }

    res.json({ ok: true, archivedTo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Publish (writes .md, runs prepare-photos, commits, pushes).
app.post('/api/publish', async (req, res) => {
  try {
    const { section, slug, data, content = '' } = req.body;

    const filePath =
      section === 'monthly'
        ? path.join(CONTENT, 'monthly', slug + '.md')
        : path.join(CONTENT, 'works', slug + '.md');
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const md = matter.stringify(content, data);
    await fs.writeFile(filePath, md);

    execSync('npm run prepare-photos', { cwd: ROOT, stdio: 'inherit' });

    execSync('git add -A', { cwd: ROOT });
    const subject = section === 'monthly' ? `monthly: ${slug}` : `works: ${slug}`;
    try {
      execSync(`git commit -m "${subject}"`, { cwd: ROOT });
    } catch (e) {
      if (!/nothing to commit/.test(String(e.stdout) + String(e.stderr))) throw e;
    }
    execSync('git push', { cwd: ROOT });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// ---------- start ----------

app.listen(PORT, async () => {
  console.log(`\n  d612 admin → http://localhost:${PORT}\n`);
  try {
    await open(`http://localhost:${PORT}`);
  } catch {
    // ignore
  }
});
