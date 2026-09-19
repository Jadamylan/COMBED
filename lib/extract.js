/* Combed — APPOINTMENT-BOOK EXTRACTION (server-side only)
   Photos of handwritten (mostly cursive) appointment-book pages → structured entries.

   One model call PER PAGE, run in parallel — a single page gets the model's full attention,
   which matters for cursive. Results are merged and re-indexed.

   Interpretation rules (from the stylist who wrote the book):
     • A bare number in the schedule ("3", "10", "1", "1:15", "2:45") is the appointment START TIME.
       Minutes after a colon are never dollars. Never a duration.
     • Pages contain: date, start time, client name, dollar amount, service/style wording, notes.
     • Personal reminders (moving, away, dentist, bills) are NOTES, not appointments.
     • Crossed-out lines are CANCELLED, not appointments.
     • Duration is NOT on the page and is never extracted.
     • Accuracy over completeness: unclear → null or confidence "low". Never invent text. */
'use strict';

// What the reading model accepts. The browser normalizes every upload (including HEIC) to image/jpeg
// before it gets here, so this is a safety net, not the user-facing rule. Keep in sync with
// js/config.js UPLOAD (server never sees the original file type).
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_PARTS_PER_PAGE = 3; // full spread + left + right close-ups

const EXTRACTION_PROMPT = `You are reading photograph(s) of ONE two-page weekly spread from a hairstylist's handwritten appointment book. You may receive the full spread plus left/right close-ups of the same spread — they are the SAME week; use the full view for dates and the close-ups for handwriting. The handwriting is cursive with abbreviations. Read slowly and literally.

PAGE LAYOUT
The spread shows one week: Monday–Wednesday on the left page, Thursday–Sunday on the right (Saturday and Sunday share the bottom right). The MONTH NAME and year are printed in large type at the top-left of the LEFT page, with a small printed calendar beside it; every day box is printed with its weekday and day number. Take the month from that printed header — never infer it from the handwriting. A week that starts on the 31st runs into the next month (e.g. Mon Aug 31 → Tue Sep 1). Handwriting inside a day box belongs to that date. Entries can be written in two columns inside one day box, and one entry can wrap onto a second line. Never list the same entry twice.

HOW THE STYLIST WRITES AN APPOINTMENT
Usually: START TIME, then the client's first name, then a dollar amount and the service/style, in any order, e.g.
  "10 Alicia $160 Shampoo Flat Iron"   "1:15 Karin SBD"   "2:45 Rhonda"   "3 Lorenzo twist $100"   "11:30 Janya braids $65"

TIME RULE (most important)
The number at the START of an entry is the appointment start time. It may be an hour ("1", "10") or hour:minutes ("1:15", "2:45", "11:30", "9:30", "12:30"; sloppy "3:3" or "2:3" means 3:30 / 2:30). Read the whole time token before the name. The minutes are NEVER a dollar amount — "1:15 Karin" is 1:15 with no price, not $15. A time is never a duration. Return start_time exactly as written (e.g. "2:45"), without AM/PM unless written.

PRICE RULE
A price has a $ sign before or after ("$125", "150$", "130$") or is a clearly separate amount next to the service. Read the digits carefully and literally; do not round to a familiar number. This stylist's $ sign is a quick vertical stroke that can look like the digit 1 — "$65" is sixty-five, not 165; "$30" is thirty, not 130. Prices in this book are usually between $30 and $300. If the digits are unclear, return price null with confidence.price "low" rather than guessing. Struck-through prices that were rewritten: use the final one. A time never becomes a price and a price never becomes a time.

SERVICE RULE
Copy the service/style words as written into service_raw — words only, never the time or the dollar amount (those go in start_time and price). Keep the stylist's abbreviations (SBD, NS, retwist, locs, crochet, sew in, weave, color, relaxer, updo, roller set, flat iron, braids, box braids, twist, 2 strand, trim, haircut, touch up, treatment). Do not expand or reinterpret abbreviations. Split combinations into the services array. "Family discount" is NOT a service: set discount_type "family" and add "Family Discount" to business_notes. If the service is unreadable, service_raw "" and confidence.service "low".

WHAT IS NOT AN APPOINTMENT
• entry_type "note": personal reminders and business notes — "moving", "away", "dentist", "laser", utility or bill notes like "paid $50 SMUD shut off", travel, birthdays, anything with no client haircare service. Also a bare time with a personal word and no client/service.
• entry_type "cancelled": any line that is struck through / scribbled out.
Return these too, with entry_type set, so the stylist can see what was skipped. Everything else is entry_type "appointment".

CLIENT NAME
Best reading of the first name in client_name_internal (repeat clients matter). Unreadable → null. Leave client_alias "".

DATES
Every entry gets date YYYY-MM-DD from its day box, using the printed month/day and the year provided. List every date printed on this spread in dates_visible, including days with nothing written.

RAW TEXT
Put your literal transcription of the whole entry in raw_text (e.g. "2:45 Rhonda") so the stylist can check your reading.

CONFIDENCE
Rate date, start_time, client_name, service, price, discount as high / medium / low. Low means you are unsure; null means you cannot read it. Never present a guess as high.
Also give overall_confidence as a number from 0 to 1: how sure you are that the date, start time, service, and price are all read correctly. 0.9+ when every one of those is clear. Do NOT lower it for an unreadable or missing client name — the name is not used in the analysis.

RETURN ONLY VALID RAW JSON — no markdown, no code fences, no commentary — exactly:
{
  "readable": true,
  "dates_visible": ["YYYY-MM-DD"],
  "notes": "",
  "entries": [
    {
      "entry_type": "appointment",
      "date": "YYYY-MM-DD",
      "day_of_week": "",
      "start_time": "",
      "client_name_internal": null,
      "client_alias": "",
      "service_raw": "",
      "services": [],
      "price": null,
      "discount_type": null,
      "business_notes": [],
      "visible_notes": "",
      "raw_text": "",
      "overall_confidence": 0.9,
      "confidence": { "date": "high", "start_time": "high", "client_name": "medium", "service": "medium", "price": "high", "discount": "high" }
    }
  ]
}
Never include duration_minutes or any duration field. If the page cannot be read at all, set readable false and explain briefly in notes.`;

function stripFences(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = t.indexOf('{'); const last = t.lastIndexOf('}');
  if (first > 0 || (last >= 0 && last < t.length - 1)) t = t.slice(first, last + 1);
  return t;
}

const CONF = new Set(['high', 'medium', 'low']);
const conf = (v, fallback) => (CONF.has(v) ? v : fallback);
const TYPES = new Set(['appointment', 'note', 'cancelled']);

function normalizeEntry(e, imageIndex) {
  const price = typeof e.price === 'number' ? e.price : (typeof e.price === 'string' && e.price.trim() ? Number(String(e.price).replace(/[^0-9.]/g, '')) : null);
  const c = e.confidence || {};
  // Service words only: strip any "$125" / "125$" / "130" price tokens or a leading time that leaked in.
  const serviceRaw = (typeof e.service_raw === 'string' ? e.service_raw : '')
    .replace(/\$\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*\$/g, ' ')
    .replace(/^\s*\d{1,2}(?::\d{1,2})?\s+/, '')
    .replace(/\s{2,}/g, ' ').trim();
  let type = TYPES.has(e.entry_type) ? e.entry_type : 'appointment';
  // Safety net: an "appointment" with no service, no price, and a note-like word is a note.
  if (type === 'appointment' && !serviceRaw && price == null && /^(moving|away|dentist|laser|paid|shut ?off|bill|vacation|off|closed)\b/i.test(String(e.raw_text || ''))) type = 'note';
  return {
    entry_type: type,
    image_index: imageIndex,
    date: typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null,
    day_of_week: typeof e.day_of_week === 'string' ? e.day_of_week : '',
    start_time: e.start_time == null || e.start_time === '' ? null : String(e.start_time).trim(),
    client_name_internal: typeof e.client_name_internal === 'string' && e.client_name_internal.trim() ? e.client_name_internal.trim() : null,
    client_alias: '',
    service_raw: serviceRaw,
    services: Array.isArray(e.services) ? e.services.map(String) : [],
    price: Number.isFinite(price) ? price : null,
    discount_type: typeof e.discount_type === 'string' && e.discount_type.trim() ? e.discount_type.trim().toLowerCase() : null,
    business_notes: Array.isArray(e.business_notes) ? e.business_notes.map(String) : [],
    visible_notes: typeof e.visible_notes === 'string' ? e.visible_notes : '',
    raw_text: typeof e.raw_text === 'string' ? e.raw_text.trim() : '',
    overall_confidence: typeof e.overall_confidence === 'number' ? Math.max(0, Math.min(1, e.overall_confidence)) : undefined,
    confidence: {
      date: conf(c.date, 'medium'),
      start_time: conf(c.start_time, e.start_time ? 'medium' : 'low'),
      client_name: conf(c.client_name, 'medium'),
      service: conf(c.service, serviceRaw ? 'medium' : 'low'),
      price: conf(c.price, price == null ? 'low' : 'medium'),
      discount: conf(c.discount, 'high'),
    },
  };
}

async function readOnePage({ apiKey, apiUrl, model, parts, index, year, timeoutMs }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let raw;
  try {
    const content = [];
    const labels = parts.length === 3
      ? ['FULL spread — use this for the printed month, year, and day numbers:', 'LEFT page close-up — use this to read the handwriting:', 'RIGHT page close-up — use this to read the handwriting:']
      : parts.length === 2 ? ['LEFT page of the spread:', 'RIGHT page of the same spread:'] : [];
    parts.forEach((p, i) => {
      if (labels[i]) content.push({ type: 'text', text: labels[i] });
      content.push({ type: 'image', source: { type: 'base64', media_type: p.media_type, data: p.data } });
    });
    content.push({ type: 'text', text: `This is page photo ${index + 1}. The year for every date is ${year}. Transcribe every handwritten entry on both pages of the spread and return the JSON object only.` });
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 8000, temperature: 0, system: EXTRACTION_PROMPT, messages: [{ role: 'user', content }] }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Model API responded ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    raw = Array.isArray(data.content) ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('') : '';
  } finally { clearTimeout(t); }

  let parsed;
  try { parsed = JSON.parse(stripFences(raw)); } catch {
    const e = new Error(`Combed could not structure what it read from page ${index + 1}. Please try again.`); e.code = 'MALFORMED_JSON'; e.raw = raw; e.image_index = index; throw e;
  }
  const entries = (Array.isArray(parsed.entries) ? parsed.entries : []).map((e) => normalizeEntry(e, index));
  const dates = Array.isArray(parsed.dates_visible) ? parsed.dates_visible.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  return {
    page: { image_index: index, readable: parsed.readable !== false && (entries.length > 0 || dates.length > 0), dates_visible: dates, entries_found: entries.filter((e) => e.entry_type === 'appointment').length, notes: typeof parsed.notes === 'string' ? parsed.notes : '' },
    entries,
  };
}

/* `pages`: [{ parts: [{media_type,data}, …] }] — one page photo, optionally pre-split into left/right crops.
   `images`: [{media_type,data}] — legacy single-image-per-page form; still accepted. */
async function extractBook({ apiKey, apiUrl, model, pages, images, year, timeoutMs = 240000 }) {
  if (!apiKey) throw new Error('MODEL_API_KEY is not configured');
  const pageList = Array.isArray(pages) && pages.length ? pages : (Array.isArray(images) ? images.map((img) => ({ parts: [img] })) : []);
  if (!pageList.length) throw new Error('No images provided');
  if (pageList.length > 6) throw new Error('Please upload at most 6 page photos at a time');
  pageList.forEach((pg, i) => {
    const parts = Array.isArray(pg?.parts) ? pg.parts : [];
    const fail = (msg) => { const e = new Error(msg); e.image_index = i; throw e; };
    if (!parts.length) fail(`Photo ${i + 1} arrived empty. Please add it again.`);
    if (parts.length > MAX_PARTS_PER_PAGE) fail(`Photo ${i + 1} was sent in too many pieces (${parts.length}); expected at most ${MAX_PARTS_PER_PAGE}.`);
    const bad = parts.find((p) => !p || typeof p.data !== 'string' || p.data.length < 100);
    if (bad) fail(`Photo ${i + 1} could not be prepared — the image data was empty.`);
    const wrongType = parts.find((p) => !ALLOWED_MEDIA.has(p.media_type));
    if (wrongType) fail(/hei[cf]/i.test(wrongType.media_type || '')
      ? 'This photo is in iPhone HEIC format. Please export or share it as a JPG and upload it again.'
      : `Photo ${i + 1} has an unsupported type (${wrongType.media_type || 'unknown'}). Supported: JPG, PNG, WEBP, GIF.`);
    parts.forEach((p) => console.log(`[extract-book] page ${i + 1} part: ${p.media_type}, ${Math.round((p.data.length * 3) / 4 / 1024)} KB`));
  });

  const results = await Promise.all(pageList.map((pg, index) => readOnePage({ apiKey, apiUrl, model, parts: pg.parts, index, year, timeoutMs })));
  const all = results.flatMap((r) => r.entries);
  const dated = all.filter((e) => e.date);
  return {
    pages: results.map((r) => r.page),
    entries: dated.filter((e) => e.entry_type === 'appointment'),
    skipped: dated.filter((e) => e.entry_type !== 'appointment'),
    undated_entries: all.length - dated.length,
  };
}

module.exports = { extractBook, EXTRACTION_PROMPT };
