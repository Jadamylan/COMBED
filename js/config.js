/* Combed — shared frontend configuration.
   Everything here is safe to ship to the browser. No secrets live here. */
window.Combed = window.Combed || {};

Combed.CONFIG = {
  // Year for the demo dataset. Change here; the dataset re-derives every date.
  DEMO_YEAR: 2026,

  // The 20 observed appointment-book calendar days (month, day).
  // NOTE: Aug 10–16 are intentionally absent. Never fill them in.
  OBSERVED_DATES: [
    [7, 27], [7, 28], [7, 29], [7, 30], [7, 31],
    [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7], [8, 8], [8, 9],
    [8, 17], [8, 18], [8, 19], [8, 20], [8, 21], [8, 22],
  ],

  LOCATION: {
    city: 'North Highlands',
    state: 'CA',
    label: 'North Highlands, California',
  },

  // Time-of-day periods used for schedule utilization (24h hours).
  PERIODS: [
    { key: 'morning',   label: 'Morning',   start: 7,  end: 11 },
    { key: 'midday',    label: 'Midday',    start: 11, end: 14 },
    { key: 'afternoon', label: 'Afternoon', start: 14, end: 17 },
    { key: 'evening',   label: 'Evening',   start: 17, end: 21 },
  ],

  WEEKDAYS: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

  LOADING_MESSAGES: [
    'Reading your appointment book…',
    'Matching your services…',
    'Checking what each hour is earning…',
    'Finding the gaps…',
    'Looking around North Highlands…',
    'Combing through your numbers…',
    'Building your Chair Cone…',
  ],

  // Allowed vocab — single source of truth shared with the server prompt (lib/report.js mirrors these).
  // service_performance.status — what the book supports without durations
  SERVICE_STATUSES: ['KEEP STRONG', 'STEADY', 'WATCH', 'PRICE CHECK', 'NEEDS MORE DATA'],
  // pricing_signals.status — price consistency across the observed appointments
  PRICING_STATUSES: ['CONSISTENT', 'SMALL RANGE', 'WIDE RANGE', 'DISCOUNT EXPLAINED', 'NEEDS MORE DATA'],
  // pricing_signals.time_status — only when stylist-supplied durations exist
  TIME_STATUSES: ['KEEP', 'WATCH', 'REVISIT', 'STRONG CANDIDATE FOR A PRICE UPDATE', 'NEEDS MORE DATA'],
  EFFORT_CATEGORIES: ['STRONG RETURN', 'WATCH CLOSELY', 'EASY BUT LOW RETURN', 'PREMIUM WORK'],
  CONFIDENCE: ['high', 'medium', 'low'],
  // Build Day: appointments at or above this overall confidence feed the analysis automatically.
  AUTO_INCLUDE_CONFIDENCE: 0.85,
  // Label → numeric normalization when the reader returns labels instead of numbers.
  CONFIDENCE_SCORES: { high: 0.95, medium: 0.75, low: 0.5 },

  // Book-time interpretation: a bare number like "3" is a START TIME, never a duration.
  // Hours 7–11 read as morning; 12 and 1–6 read as afternoon/evening.
  BOOK_TIME_AM_HOURS: [7, 8, 9, 10, 11],
};

/* Small shared helpers */
Combed.util = {
  pad2: (n) => String(n).padStart(2, '0'),

  isoDate(year, month, day) {
    return `${year}-${this.pad2(month)}-${this.pad2(day)}`;
  },

  // Day of week computed from the date, never hardcoded.
  dayOfWeek(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Combed.CONFIG.WEEKDAYS[new Date(y, m - 1, d).getDay()];
  },

  shortDate(iso) {
    const [, m, d] = iso.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[m - 1]} ${d}`;
  },

  // "9:30 AM" -> 570 (minutes since midnight). Returns null if unparseable.
  parseTime(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  },

  fmtTime(minutes) {
    let h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${this.pad2(m)} ${ap}`;
  },

  money(n, opts = {}) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    const v = opts.cents ? n.toFixed(2) : Math.round(n).toLocaleString('en-US');
    return `$${v}`;
  },

  round(n, places = 1) {
    const f = 10 ** places;
    return Math.round(n * f) / f;
  },

  esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
};
