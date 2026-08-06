// Writes a Vercel-level redirect for /monthly -> /monthly/<latest-slug>.
//
// astro build alone can only produce a static HTML page with a meta-refresh
// for Astro.redirect() (no adapter is configured), which visibly flashes a
// "Redirecting from X to Y" fallback message before navigating. Vercel's own
// redirects (vercel.json) happen at the edge, before any HTML is served, so
// there's no flash.
//
// IMPORTANT: Vercel's "vercel build" step reads vercel.json before running
// npm run build (and therefore before this script, which runs in prebuild).
// A vercel.json regenerated mid-build is invisible to that deployment's
// routing — it must already be committed at checkout time. This script is
// wired into BOTH prebuild (keeps local builds/previews correct) and the
// admin GUI's publish flow (regenerates + commits + pushes on every
// publish, which is what actually gets it in front of Vercel in time).
// vercel.json is tracked in git — don't gitignore it again.
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MONTHLY_DIR = path.join(ROOT, 'src/content/monthly');
const VERCEL_JSON = path.join(ROOT, 'vercel.json');

const files = (await fs.readdir(MONTHLY_DIR)).filter((f) => f.endsWith('.md'));
if (files.length === 0) {
  console.log('No monthly entries — skipping /monthly redirect.');
  process.exit(0);
}

const entries = await Promise.all(
  files.map(async (f) => {
    const raw = await fs.readFile(path.join(MONTHLY_DIR, f), 'utf-8');
    const { data } = matter(raw);
    return { slug: f.replace(/\.md$/, ''), date: new Date(data.date) };
  }),
);
entries.sort((a, b) => b.date.getTime() - a.date.getTime());
const latestSlug = entries[0].slug;

let config = {};
try {
  config = JSON.parse(await fs.readFile(VERCEL_JSON, 'utf-8'));
} catch {
  // no existing vercel.json — start fresh
}

const otherRedirects = (config.redirects ?? []).filter(
  (r) => r.source !== '/monthly' && r.source !== '/monthly/',
);

config.redirects = [
  ...otherRedirects,
  { source: '/monthly', destination: `/monthly/${latestSlug}`, permanent: false },
  { source: '/monthly/', destination: `/monthly/${latestSlug}`, permanent: false },
];

await fs.writeFile(VERCEL_JSON, JSON.stringify(config, null, 2) + '\n');
console.log(`vercel.json: /monthly -> /monthly/${latestSlug}`);
