// Local admin server for d612.space.
// Run with: npm run admin
// Opens http://localhost:4322 in your browser.

import express from 'express';
import multer from 'multer';
import matter from 'gray-matter';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import open from 'open';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 4322;

const ORIGINALS = path.join(ROOT, 'originals');
const CONTENT = path.join(ROOT, 'src/content');

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
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.(jpe?g)$/i.test(e.name))
    .map((e) => e.name);
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
    const originals = await listOriginalFiles(section, slug);
    res.json({ ...entry, originals });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Thumbnail proxy — resize on demand from originals/
app.get('/thumb/*', async (req, res) => {
  const rel = req.params[0];
  const filePath = path.join(ORIGINALS, rel);
  try {
    const buffer = await sharp(filePath)
      .rotate()
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    res.type('image/jpeg').send(buffer);
  } catch (e) {
    res.status(404).end();
  }
});

// Upload photos
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
    filename: (req, file, cb) => {
      const name = file.originalname.replace(/\.(jpe?g)$/i, '.jpg');
      cb(null, name);
    },
  }),
});

app.post('/api/upload', upload.array('photos'), (req, res) => {
  const filenames = req.files.map((f) => f.filename);
  res.json({ filenames });
});

// Publish
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

    // Run prepare-photos
    execSync('npm run prepare-photos', { cwd: ROOT, stdio: 'inherit' });

    // Git
    execSync('git add -A', { cwd: ROOT });
    const subject = section === 'monthly' ? `monthly: ${slug}` : `works: ${slug}`;
    try {
      execSync(`git commit -m "${subject}"`, { cwd: ROOT });
    } catch (e) {
      // Nothing to commit is fine
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
    // ignore if browser open fails
  }
});
