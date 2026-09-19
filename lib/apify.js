/* Combed — APIFY LOCAL-MARKET LAYER (server-side only)
   One synchronous Actor run → normalized places → small counted summary.

   ┌────────────────────────────────────────────────────────────────────┐
   │ ACTOR CONFIG — the one place to change when you pick your Actor.   │
   │ Set APIFY_ACTOR_ID in .env (format: username~actor-name) and       │
   │ adjust `buildInput()` to that Actor's input schema.                │
   └────────────────────────────────────────────────────────────────────┘ */
'use strict';

const APIFY_ACTOR = {
  id: process.env.APIFY_ACTOR_ID || 'compass~crawler-google-places',
  maxResults: Number(process.env.APIFY_MAX_RESULTS || 10),
  searchTerms: ['hair salon', 'natural hair salon', 'Black hair salon', 'hairstylist'],
  location: 'North Highlands, California',
  timeoutMs: 150000,

  // Input for the configured Actor. Default shape matches compass/crawler-google-places.
  buildInput({ location, searchTerms, maxResults }) {
    return {
      searchStringsArray: searchTerms,
      locationQuery: location,
      maxCrawledPlacesPerSearch: Math.max(1, Math.ceil(maxResults / searchTerms.length)),
      language: 'en',
      maxReviews: 5,
      reviewsSort: 'newest',
      scrapeReviewsPersonalData: false,
      skipClosedPlaces: true,
      maxImages: 0,
    };
  },
};

/* Normalize one raw Actor item into Combed's stable shape.
   Tolerant of several common field spellings so a different Actor mostly "just works". */
function normalizePlace(raw) {
  const pick = (...keys) => { for (const k of keys) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k]; return null; };

  let hours = {};
  const oh = pick('openingHours', 'opening_hours', 'hours');
  if (Array.isArray(oh)) oh.forEach((h) => { if (h && h.day) hours[h.day] = h.hours || h.time || ''; });
  else if (oh && typeof oh === 'object') hours = oh;

  const rawReviews = pick('reviews', 'reviewsList') || [];
  const reviews = Array.isArray(rawReviews)
    ? rawReviews.map((r) => (typeof r === 'string' ? r : r?.text || r?.textTranslated || '')).filter(Boolean).slice(0, 5)
    : [];

  return {
    name: pick('title', 'name') || 'Unnamed business',
    category: pick('categoryName', 'category') || '',
    address: pick('address', 'street') || '',
    rating: typeof pick('totalScore', 'rating') === 'number' ? pick('totalScore', 'rating') : null,
    review_count: typeof pick('reviewsCount', 'review_count', 'userRatingsTotal') === 'number' ? pick('reviewsCount', 'review_count', 'userRatingsTotal') : null,
    hours,
    website: pick('website', 'url_website') || '',
    reviews,
    popular_times: pick('popularTimesHistogram', 'popular_times') || null,
  };
}

/* Counted evidence — the AI must only cite numbers that exist here. */
const THEMES = [
  { key: 'natural hair', words: ['natural hair', 'natural', 'edges', 'healthy hair'] },
  { key: 'silk press', words: ['silk press'] },
  { key: 'press and curl', words: ['press and curl', 'press & curl', 'press n curl'] },
  { key: 'braids/twists/locs', words: ['braid', 'twist', 'knotless', 'locs', 'loc '] },
  { key: 'color', words: ['color', 'colour', 'highlight', 'balayage'] },
  { key: 'relaxer', words: ['relaxer', 'perm'] },
  { key: 'cut', words: ['cut', 'trim'] },
  { key: 'late hours', words: ['late', 'after work', 'evening'] },
  { key: 'wait time', words: ['wait', 'late start', 'on time', 'punctual'] },
  { key: 'price', words: ['price', 'pricey', 'expensive', 'affordable', 'worth'] },
];

function parseClosingHour(str) {
  // Handles "9 AM–7 PM", "9 AM - 7 PM", "9 AM to 7 PM", "9:30 AM to 7:30 PM"
  const m = String(str || '').match(/(?:[–-]|\bto\b)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]);
  if (/pm/i.test(m[3]) && h < 12) h += 12;
  return h;
}

function summarizeMarket(places) {
  const reviews = places.flatMap((p) => p.reviews.map((r) => r.toLowerCase()));
  const themes = THEMES.map((t) => ({ theme: t.key, mentions: reviews.filter((r) => t.words.some((w) => r.includes(w))).length }))
    .filter((t) => t.mentions > 0).sort((a, b) => b.mentions - a.mentions);
  const withHours = places.filter((p) => Object.keys(p.hours).length);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const openByDay = Object.fromEntries(days.map((d) => [d, withHours.filter((p) => p.hours[d] && !/closed/i.test(p.hours[d])).length]));
  const lateWeekday = withHours.filter((p) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].some((d) => (parseClosingHour(p.hours[d]) || 0) >= 19)).length;
  const rated = places.filter((p) => typeof p.rating === 'number');
  const categories = {};
  places.forEach((p) => { if (p.category) categories[p.category] = (categories[p.category] || 0) + 1; });

  return {
    places_scanned: places.length,
    review_count: reviews.length,
    places_with_hours: withHours.length,
    open_by_day: openByDay,
    open_past_7pm_weekday: lateWeekday,
    avg_rating: rated.length ? Math.round((rated.reduce((s, p) => s + p.rating, 0) / rated.length) * 10) / 10 : null,
    review_theme_mentions: themes,
    categories,
  };
}

async function fetchLocalMarket({ token, location, searchTerms, maxResults } = {}) {
  if (!token) throw new Error('APIFY_API_TOKEN is not configured');
  const input = APIFY_ACTOR.buildInput({
    location: location || APIFY_ACTOR.location,
    searchTerms: searchTerms || APIFY_ACTOR.searchTerms,
    maxResults: maxResults || APIFY_ACTOR.maxResults,
  });

  const base = (process.env.APIFY_API_BASE || 'https://api.apify.com').replace(/\/$/, '');
  const url = `${base}/v2/acts/${encodeURIComponent(APIFY_ACTOR.id)}/run-sync-get-dataset-items?timeout=${Math.floor(APIFY_ACTOR.timeoutMs / 1000) - 10}&limit=${maxResults || APIFY_ACTOR.maxResults}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), APIFY_ACTOR.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Apify responded ${res.status}: ${text.slice(0, 200)}`);
    }
    const items = await res.json();
    const places = (Array.isArray(items) ? items : []).slice(0, maxResults || APIFY_ACTOR.maxResults).map(normalizePlace);
    return { places, summary: summarizeMarket(places), actor: APIFY_ACTOR.id };
  } finally { clearTimeout(t); }
}

module.exports = { APIFY_ACTOR, fetchLocalMarket, normalizePlace, summarizeMarket };
