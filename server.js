/* Combed — server
   Serves the one-page app and keeps every secret server-side.

   Routes
     POST /api/local-market     → Apify (live local salon-market signals)
     POST /api/generate-report  → AI reasoning (Combed Analysis Response Schema)
     GET  /api/health           → config sanity check (never returns secrets) */
'use strict';

const path = require('path');
const express = require('express');

// Load .env without a dependency (Node ≥ 21.7 / 20.12). Missing file is fine.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env yet */ }

const { fetchLocalMarket, APIFY_ACTOR } = require('./lib/apify');
const { generateReport } = require('./lib/report');
const { extractBook } = require('./lib/extract');

const PORT = Number(process.env.PORT || 3000);
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_NAME = process.env.MODEL_NAME || 'claude-sonnet-4-5';
const MODEL_API_URL = process.env.MODEL_API_URL || 'https://api.anthropic.com/v1/messages';
const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';

const app = express();
app.disable('x-powered-by');
// Page photos arrive as base64 (browser downsizes them first) — allow room for ~6 pages.
app.use(express.json({ limit: '30mb' }));

// Static: only the public folders are ever served. server.js, lib/, .env are unreachable.
// A missing /assets/*.jpg simply 404s → the frontend shows its styled placeholder.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model_configured: Boolean(MODEL_API_KEY),
    model_name: MODEL_NAME,
    apify_configured: Boolean(APIFY_API_TOKEN),
    apify_actor: APIFY_ACTOR.id,
    apify_max_results: APIFY_ACTOR.maxResults,
  });
});

/* ── Vision: read the appointment-book photos ───────────────────────── */
app.post('/api/extract-book', async (req, res) => {
  const started = Date.now();
  try {
    const { pages, images, year } = req.body || {};
    const result = await extractBook({
      apiKey: MODEL_API_KEY, apiUrl: MODEL_API_URL, model: MODEL_NAME,
      pages, images, year: Number.isInteger(year) ? year : new Date().getFullYear(),
    });
    console.log(`[extract-book] ${result.entries.length} entries from ${result.pages.length} page(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[extract-book] failed:', err.code || '', err.message);
    if (err.raw) console.error('[extract-book] raw model output (first 500 chars):', String(err.raw).slice(0, 500));
    res.status(err.image_index != null ? 400 : 502).json({
      success: false,
      image_index: err.image_index ?? null,
      error: err.code === 'MALFORMED_JSON' || err.image_index != null ? err.message : "Combed couldn't read your pages this time. Your photos are still here — try again.",
    });
  }
});

/* ── Apify: local market signals ───────────────────────────────────── */
app.post('/api/local-market', async (req, res) => {
  const started = Date.now();
  try {
    const { location, searchTerms, maxResults } = req.body || {};
    const result = await fetchLocalMarket({
      token: APIFY_API_TOKEN,
      location: typeof location === 'string' && location.trim() ? location.trim() : undefined,
      searchTerms: Array.isArray(searchTerms) && searchTerms.length ? searchTerms.slice(0, 4).map(String) : undefined,
      maxResults: Number.isInteger(maxResults) ? Math.min(Math.max(maxResults, 1), 20) : undefined,
    });
    console.log(`[local-market] ${result.places.length} places in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    res.json({ success: true, source: 'apify', actor: result.actor, places: result.places, summary: result.summary });
  } catch (err) {
    console.error('[local-market] failed:', err.message);
    res.status(502).json({ success: false, error: "Local market signals aren't available right now, but we can still analyze your chair.", places: [], summary: null });
  }
});

/* ── AI: generate the Chair Cone report ────────────────────────────── */
app.post('/api/generate-report', async (req, res) => {
  const started = Date.now();
  try {
    const payload = req.body || {};
    const report = await generateReport({ apiKey: MODEL_API_KEY, apiUrl: MODEL_API_URL, model: MODEL_NAME, payload });
    console.log(`[generate-report] ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    res.json({ success: true, report });
  } catch (err) {
    console.error('[generate-report] failed:', err.code || '', err.message);
    if (err.raw) console.error('[generate-report] raw model output (first 500 chars):', String(err.raw).slice(0, 500));
    const friendly = err.code === 'MALFORMED_JSON' || err.code === 'SCHEMA_MISMATCH'
      ? err.message
      : "Combed couldn't finish your Chair Cone this time. Your information is still here — try the analysis again.";
    res.status(502).json({ success: false, error: friendly });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Unknown API route' }));

const server = app.listen(PORT, () => {
  console.log(`\n  COMBED  →  http://localhost:${PORT}`);
  console.log(`  model:  ${MODEL_API_KEY ? MODEL_NAME : 'NOT CONFIGURED (set MODEL_API_KEY in .env)'}`);
  console.log(`  apify:  ${APIFY_API_TOKEN ? `${APIFY_ACTOR.id} (max ${APIFY_ACTOR.maxResults})` : 'NOT CONFIGURED (set APIFY_API_TOKEN in .env)'}\n`);
});
// Live Apify runs can take a while; don't let Node cut the request off early.
server.requestTimeout = 5 * 60 * 1000;
server.headersTimeout = 5 * 60 * 1000 + 1000;
