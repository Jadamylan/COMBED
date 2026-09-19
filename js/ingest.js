/* Combed — INGEST
   Turns raw appointment-book extraction into reviewed, anonymized records.

   What the book actually says          →  What Combed stores
   ─────────────────────────────────────────────────────────────────────
   "3"  (a bare number in the schedule) →  start_time "3:00 PM"  (NEVER a duration)
   "Shampoo / Flat Iron"                →  service_raw kept verbatim,
                                           service_name "Shampoo + Flat Iron",
                                           services ["Shampoo", "Flat Iron"]
   "Lisa"                               →  client_alias "Client 01"; the name is dropped
   "$65" + "Family Discount"            →  price 65, discount_type "family"

   Duration is NOT in the book. It only enters through stylist service profiles
   (SOURCE B), and time-based analysis stays locked until every observed service
   has one. Appointment spacing is never treated as service duration. */
window.Combed = window.Combed || {};

(function () {
  const { CONFIG, util } = Combed;

  /* "3" → "3:00 PM", "10" → "10:00 AM", "3:30" → "3:30 PM", "11:30 AM" → as-is. null if unreadable. */
  function interpretBookTime(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const explicit = util.parseTime(s);
    if (/[ap]\.?m/i.test(s) && explicit != null) return util.fmtTime(explicit);
    // Accept "3", "3:30", and the stylist's shorthand "3:3" (= 3:30) / "9:3" (= 9:30).
    const m = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = m[2] == null ? 0 : (m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2]));
    if (h < 1 || h > 12 || min > 59) return null;
    const isAM = CONFIG.BOOK_TIME_AM_HOURS.includes(h);
    return util.fmtTime((isAM ? h : (h === 12 ? 12 : h + 12)) * 60 + min);
  }

  /* "Wash, Blow Dry, Trim" → ["Wash", "Blow Dry", "Trim"]. Keeps the stylist's wording. */
  function splitServices(raw) {
    return String(raw || '')
      .split(/\s*(?:[\/,+&]|\band\b|\bw\/\b)\s*/i)
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()));
  }

  /* Canonical grouping name: same combination written differently groups together. */
  function normalizeServiceName(raw) {
    const parts = splitServices(raw);
    return parts.length ? parts.join(' + ') : null;
  }

  /* Assign Client 01, 02… by first appearance; strip the internal name entirely. */
  function anonymize(extraction) {
    const map = new Map();
    let n = 0;
    return extraction.map((row) => {
      const key = row.client_name_internal ? row.client_name_internal.trim().toLowerCase() : null;
      let alias = row.client_alias;
      if (!alias) {
        if (key) { if (!map.has(key)) map.set(key, `Client ${util.pad2(++n)}`); alias = map.get(key); }
        else alias = 'Unknown client';
      }
      const { client_name_internal, ...rest } = row; // eslint-disable-line no-unused-vars
      return { ...rest, client_alias: alias };
    });
  }

  /* Overall confidence 0–1 for one appointment.
     Prefers a numeric overall_confidence from the reader; otherwise normalizes the field labels
     (high .95 / medium .75 / low .5) weighted toward the fields the analysis depends on.
     A missing price, service, or start time caps the score at 0.5 — it can't be analyzed anyway. */
  function scoreConfidence(row, conf, start) {
    const S = CONFIG.CONFIDENCE_SCORES;
    const n = (label) => S[label] ?? S.medium;
    // Per-field labels cover exactly the fields the analysis uses (not the client name).
    const labelScore = 0.15 * n(conf.date) + 0.2 * n(conf.start_time) + 0.3 * n(conf.service) + 0.35 * n(conf.price);
    // Readers tend to give a holistic number that is dragged down by unreadable names; take the better evidence.
    let score = typeof row.overall_confidence === 'number' ? Math.max(labelScore, Math.max(0, Math.min(1, row.overall_confidence))) : labelScore;
    // Anything the analysis can't use is never "verified", whatever the labels say.
    if (typeof row.price !== 'number' || !row.service_raw || !start) score = Math.min(score, 0.5);
    // A field the reader explicitly marked low keeps the row out of the automatic set.
    if (['date', 'start_time', 'service', 'price'].some((k) => conf[k] === 'low')) score = Math.min(score, 0.8);
    return Math.round(score * 100) / 100;
  }

  const REASON = { start_time: 'Start time unclear', service: 'Service handwriting unclear', price: 'Amount unclear', discount: 'Discount note unclear', client_name: 'Name unclear' };
  function reviewReason(row, conf, start, flags) {
    if (typeof row.price !== 'number') return 'No readable amount';
    if (!row.service_raw) return 'No readable service';
    if (!start) return 'Start time unreadable';
    return flags.map((f) => REASON[f]).filter(Boolean).join('; ') || 'Reader was not confident enough';
  }

  /* Extraction → review-ready appointment records. */
  function prepareAppointments(extraction) {
    return anonymize(extraction).map((row, i) => {
      const conf = { date: 'high', start_time: 'high', client_name: 'medium', service: 'medium', price: 'high', discount: 'high', ...(row.confidence || {}) };
      const start = interpretBookTime(row.start_time);
      const flags = [];
      if (!start || conf.start_time === 'low') flags.push('start_time');
      if (!row.service_raw || conf.service === 'low') flags.push('service');
      if (typeof row.price !== 'number' || conf.price === 'low') flags.push('price');
      if (conf.discount === 'low') flags.push('discount');
      const overall = scoreConfidence(row, conf, start);
      return {
        overall_confidence: overall,
        review_reason: overall < CONFIG.AUTO_INCLUDE_CONFIDENCE ? reviewReason(row, conf, start, flags) : null,
        id: `appt-${i}`,
        date: row.date,
        day_of_week: row.day_of_week || util.dayOfWeek(row.date),
        start_time: start,
        start_time_raw: row.start_time ?? null,
        client_alias: row.client_alias,
        service_raw: row.service_raw || '',
        service_name: normalizeServiceName(row.service_raw),
        services: row.services && row.services.length ? row.services : splitServices(row.service_raw),
        price: typeof row.price === 'number' ? row.price : null,
        discount_type: row.discount_type || null,
        business_notes: row.business_notes || [],
        visible_notes: row.visible_notes || '',
        raw_text: row.raw_text || '',
        confidence: conf,
        flags,
        needs_review: flags.length > 0,
        reviewed: false,
        data_source: 'appointment_book',
        // filled by attachServiceProfiles when the stylist supplies them
        typical_duration_minutes: null,
        physical_effort: null,
        supply_cost: null,
        duration_source: null,
      };
    }).sort((a, b) => (a.date === b.date ? (util.parseTime(a.start_time) ?? 9e9) - (util.parseTime(b.start_time) ?? 9e9) : a.date < b.date ? -1 : 1));
  }

  /* Re-derive fields after the stylist edits a row in the review screen. */
  function applyEdit(record, field, value) {
    if (field === 'service_raw') {
      record.service_raw = value;
      record.service_name = normalizeServiceName(value);
      record.services = splitServices(value);
      record.confidence.service = 'high';
    } else if (field === 'price') {
      record.price = value === '' || value == null ? null : Number(value);
      record.confidence.price = record.price == null ? 'low' : 'high';
    } else if (field === 'start_time') {
      record.start_time_raw = value;
      record.start_time = interpretBookTime(value);
      record.confidence.start_time = record.start_time ? 'high' : 'low';
    } else if (field === 'discount') {
      record.discount_type = value ? 'family' : null;
      record.business_notes = value ? ['Family Discount'] : record.business_notes.filter((n) => !/family/i.test(n));
      record.confidence.discount = 'high';
    }
    record.data_source = 'stylist_corrected';
    record.flags = [];
    if (!record.start_time) record.flags.push('start_time');
    if (!record.service_raw) record.flags.push('service');
    if (record.price == null) record.flags.push('price');
    record.needs_review = record.flags.length > 0;
    // A stylist edit is authoritative: complete rows become fully confident and join the analysis.
    record.overall_confidence = record.needs_review ? 0.5 : 1;
    record.review_reason = record.needs_review ? reviewReason(record, record.confidence, record.start_time, record.flags) : null;
    return record;
  }

  /* Build Day split: what feeds the analysis vs. what is shown for later review. */
  function splitByConfidence(appointments, threshold = CONFIG.AUTO_INCLUDE_CONFIDENCE) {
    const verified = appointments.filter((a) => a.overall_confidence >= threshold && isCountable(a));
    const reviewLater = appointments.filter((a) => !verified.includes(a));
    return { verifiedAppointments: verified, reviewLaterAppointments: reviewLater };
  }

  /* SOURCE B → onto appointments. Only stylist-supplied durations count. */
  function attachServiceProfiles(appointments, profiles) {
    const byName = new Map(profiles.filter((p) => p.service_name).map((p) => [normalizeServiceName(p.service_name) || p.service_name, p]));
    appointments.forEach((a) => {
      const p = a.service_name ? byName.get(a.service_name) : null;
      const hasDuration = p && typeof p.typical_duration_minutes === 'number' && p.typical_duration_minutes > 0;
      a.typical_duration_minutes = hasDuration ? p.typical_duration_minutes : null;
      a.duration_source = hasDuration ? (p.duration_source || 'stylist_estimate') : null;
      a.physical_effort = p && typeof p.physical_effort === 'number' ? p.physical_effort : null;
      a.supply_cost = p && typeof p.supply_cost === 'number' ? p.supply_cost : null;
    });
    return appointments;
  }

  /* Countable = has a readable price. Revenue math only uses these. */
  const isCountable = (a) => typeof a.price === 'number' && a.price >= 0;

  /* Time-based analysis is available only when every countable appointment has a stylist duration. */
  function durationAvailability(appointments) {
    const countable = appointments.filter(isCountable);
    const missing = [...new Set(countable.filter((a) => !a.typical_duration_minutes).map((a) => a.service_name || a.service_raw || 'Unnamed service'))];
    return { available: countable.length > 0 && missing.length === 0, missing_services: missing };
  }

  /* Service names seen in the book that have no profile row yet — so the UI can offer them. */
  function unseenServices(appointments, profiles) {
    const have = new Set(profiles.map((p) => normalizeServiceName(p.service_name) || p.service_name));
    return [...new Set(appointments.map((a) => a.service_name).filter(Boolean))].filter((n) => !have.has(n));
  }

  Combed.ingest = { interpretBookTime, splitServices, normalizeServiceName, anonymize, prepareAppointments, applyEdit, attachServiceProfiles, isCountable, durationAvailability, unseenServices, splitByConfidence, scoreConfidence };
})();
