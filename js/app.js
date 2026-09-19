/* Combed — APP CONTROLLER
   upload → review the book → (optional) service profiles → goals → analyze → loading → report

   LIVE mode:  calc (browser) → POST /api/local-market → POST /api/generate-report → render
   DEMO mode:  calc (browser) → demo narrative (browser) → render

   Replacing mock appointments with real cursive extraction later means
   swapping `state.extraction` for the extraction API result. Nothing else changes. */
(function () {
  const { CONFIG, util, MOCK, MOCK_MARKET, ingest, calc, narrative, render } = Combed;
  const { esc } = util;
  const $ = (sel, root = document) => root.querySelector(sel);

  /* ── State ─────────────────────────────────────────────────────────── */
  const state = {
    extraction: [],        // SOURCE A raw (sample until the stylist's pages are read)
    appointments: [],      // anonymized, review-ready records
    serviceProfiles: [],   // SOURCE B (optional durations / effort / supply)
    goals: {},
    observedDates: [],
    dataLabel: MOCK.label, // what the report eyebrow says about where the data came from
    skipped: [],           // notes / cancellations the reader set aside (shown, never counted)
    bookRead: false,       // true once the uploaded photos have been read
    lastReport: null,
  };

  function loadSampleData() {
    state.extraction = MOCK.extraction();
    state.appointments = ingest.prepareAppointments(state.extraction);
    state.serviceProfiles = MOCK.serviceProfiles();
    state.goals = MOCK.goals();
    state.observedDates = MOCK.observedDates();
    state.dataLabel = MOCK.label;
    state.skipped = [];
    state.bookRead = false;
    $('#data-badge').textContent = MOCK.label;
    addProfileRowsForUnseenServices();
    renderApptTable();
    renderSkipped();
    renderMenuTable();
    renderGoals();
  }

  // Any service in the book that has no profile row yet gets an empty one, so the stylist can fill it.
  function addProfileRowsForUnseenServices() {
    ingest.unseenServices(state.appointments, state.serviceProfiles).forEach((name) => {
      state.serviceProfiles.push({ service_name: name, typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null });
    });
  }

  /* Real pages read by the model replace the sample data. Nothing downstream changes. */
  function loadExtraction(result) {
    state.extraction = result.entries;
    state.appointments = ingest.prepareAppointments(state.extraction);
    // Observed calendar days = every date visible on the pages (including empty days), plus any entry dates.
    const dates = new Set();
    result.pages.forEach((p) => p.dates_visible.forEach((d) => dates.add(d)));
    state.appointments.forEach((a) => dates.add(a.date));
    state.observedDates = [...dates].sort();
    // Keep the stylist's profile rows; start fresh for services that only exist in the sample.
    const seen = new Set(state.appointments.map((a) => a.service_name).filter(Boolean));
    state.serviceProfiles = state.serviceProfiles.filter((s) => seen.has(ingest.normalizeServiceName(s.service_name) || s.service_name));
    addProfileRowsForUnseenServices();
    state.dataLabel = `Your appointment book · ${result.pages.length} page${result.pages.length === 1 ? '' : 's'}`;
    state.skipped = result.skipped || [];
    state.bookRead = true;
    $('#data-badge').textContent = 'From your appointment book';
    renderApptTable();
    renderSkipped();
    renderMenuTable();
  }

  /* Notes and cancellations the reader set aside. Shown for trust; one click adds a misfiled visit back. */
  function renderSkipped() {
    const wrap = $('#skipped'); const list = $('#skipped-list');
    wrap.hidden = state.skipped.length === 0;
    list.innerHTML = state.skipped.map((s, i) => `
      <li><strong>${util.shortDate(s.date)}${s.start_time ? ` · ${esc(s.start_time)}` : ''}</strong>
        <span class="raw-read">“${esc(s.raw_text || s.service_raw || s.visible_notes || '—')}”</span>
        <span class="pill pill--muted">${s.entry_type === 'cancelled' ? 'crossed out' : 'note'}</span>
        <button type="button" class="btn btn--tiny" data-restore="${i}">Add as appointment</button></li>`).join('');
  }
  $('#skipped-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-restore]'); if (!btn) return;
    const [s] = state.skipped.splice(Number(btn.dataset.restore), 1);
    const restored = ingest.prepareAppointments([{ ...s, entry_type: 'appointment' }])[0];
    restored.id = `appt-restored-${Date.now()}`;
    // New alias number so it can't collide with an existing client's alias.
    const maxN = Math.max(0, ...state.appointments.map((a) => Number((/^Client (\d+)$/.exec(a.client_alias) || [])[1] || 0)));
    restored.client_alias = s.client_name_internal ? `Client ${util.pad2(maxN + 1)}` : 'Unknown client';
    restored.needs_review = true; restored.flags = [...new Set([...restored.flags, 'service', 'price'])];
    state.appointments.push(restored);
    state.appointments.sort((a, b) => (a.date === b.date ? (util.parseTime(a.start_time) ?? 9e9) - (util.parseTime(b.start_time) ?? 9e9) : a.date < b.date ? -1 : 1));
    addProfileRowsForUnseenServices();
    renderApptTable(); renderSkipped(); renderMenuTable();
  });

  /* ── Review table ("Make sure we read your book right") ────────────── */
  const FLAG_LABEL = { start_time: 'Check time', service: 'Check service', price: 'Check amount', discount: 'Check discount', client_name: 'Check name' };

  function renderApptTable() {
    const tbody = $('#appt-table tbody');
    const threshold = CONFIG.AUTO_INCLUDE_CONFIDENCE;
    tbody.innerHTML = state.appointments.map((a) => `
      <tr data-id="${a.id}" class="${a.overall_confidence < threshold ? 'is-review' : ''}">
        <td><span class="cell-date">${util.shortDate(a.date)}</span><small>${a.day_of_week.slice(0, 3)}</small></td>
        <td><input type="text" class="in-time ${a.flags.includes('start_time') ? 'is-flag' : ''}" value="${esc(a.start_time_raw ?? '')}" data-k="start_time" aria-label="Start time as written" placeholder="e.g. 3"><small>${a.start_time ? esc(a.start_time) : '<span class="flag">unreadable</span>'}</small></td>
        <td>${esc(a.client_alias)}</td>
        <td><input type="text" class="in-service ${a.flags.includes('service') ? 'is-flag' : ''}" value="${esc(a.service_raw)}" data-k="service_raw" aria-label="Service as written"><small>${a.service_name && a.service_name !== a.service_raw ? `grouped as ${esc(a.service_name)}` : ''}</small>${a.raw_text ? `<span class="raw-read" title="What the reader saw">read as: “${esc(a.raw_text)}”</span>` : ''}</td>
        <td><div class="in-money"><b>$</b><input type="number" min="0" step="5" class="${a.flags.includes('price') ? 'is-flag' : ''}" value="${a.price ?? ''}" data-k="price" aria-label="Amount charged"></div></td>
        <td class="cell-center"><input type="checkbox" data-k="discount" ${a.discount_type ? 'checked' : ''} aria-label="Family discount"></td>
        <td class="cell-check">${a.overall_confidence < threshold
          ? `<div class="flags">${(a.flags.length ? a.flags : ['confidence']).map((f) => `<span class="flag-chip">⚠ ${FLAG_LABEL[f] || `${Math.round(a.overall_confidence * 100)}% confident`}</span>`).join('')}${a.visible_notes ? `<small>${esc(a.visible_notes)}</small>` : ''}<small>set aside for later</small>${ingest.isCountable(a) && a.start_time && a.service_raw ? '<button type="button" class="btn btn--tiny" data-confirm>Looks right — include it</button>' : ''}</div>`
          : `<span class="ok" title="${Math.round(a.overall_confidence * 100)}% confident">✓</span>`}</td>
      </tr>`).join('');
    renderReview();
  }

  $('#appt-table').addEventListener('input', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const a = state.appointments.find((x) => x.id === tr.dataset.id); if (!a) return;
    const k = e.target.dataset.k;
    ingest.applyEdit(a, k, k === 'discount' ? e.target.checked : e.target.value);
    a.reviewed = true;
    // Light refresh of this row's derived cells without re-rendering (keeps focus).
    const timeSmall = tr.querySelector('.in-time + small');
    if (timeSmall) timeSmall.innerHTML = a.start_time ? esc(a.start_time) : '<span class="flag">unreadable</span>';
    const svcSmall = tr.querySelector('.in-service + small');
    if (svcSmall) svcSmall.textContent = a.service_name && a.service_name !== a.service_raw ? `grouped as ${a.service_name}` : '';
    tr.querySelectorAll('.is-flag').forEach((el) => el.classList.remove('is-flag'));
    tr.classList.toggle('is-review', a.needs_review);
    tr.querySelector('.cell-check').innerHTML = a.needs_review
      ? `<div class="flags">${a.flags.map((f) => `<span class="flag-chip">⚠ ${FLAG_LABEL[f] || f}</span>`).join('')}<small>set aside for later</small></div>`
      : '<span class="ok">✓</span>';
    renderReview();
  });
  $('#appt-table').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-confirm]'); if (!btn) return;
    const tr = btn.closest('tr');
    const a = state.appointments.find((x) => x.id === tr.dataset.id); if (!a) return;
    a.reviewed = true; a.needs_review = false; a.flags = []; a.data_source = 'stylist_confirmed';
    if (ingest.isCountable(a) && a.start_time && a.service_raw) { a.overall_confidence = 1; a.review_reason = null; }
    tr.classList.remove('is-review');
    tr.querySelectorAll('.is-flag').forEach((el) => el.classList.remove('is-flag'));
    tr.querySelector('.cell-check').innerHTML = '<span class="ok">✓</span>';
    renderReview();
  });

  function renderReview() {
    const { verifiedAppointments, reviewLaterAppointments } = ingest.splitByConfidence(state.appointments);
    $('#review-count').textContent = `${state.appointments.length} entries found · ${verifiedAppointments.length} ready for analysis${reviewLaterAppointments.length ? ` · ${reviewLaterAppointments.length} set aside for later` : ''}`;
    const wrap = $('#review'); const list = $('#review-list');
    wrap.hidden = reviewLaterAppointments.length === 0;
    list.innerHTML = reviewLaterAppointments.map((a) => `
      <li><strong>${util.shortDate(a.date)} · ${esc(a.start_time || a.start_time_raw || '?')} · ${esc(a.client_alias)}</strong> — ${esc(a.review_reason || 'reader was not confident')} (${Math.round(a.overall_confidence * 100)}% confident)${a.visible_notes ? ` (${esc(a.visible_notes)})` : ''}.
        <em>Not counted in today's analysis. Fix it here and it joins automatically — or leave it for later.</em></li>`).join('');
  }

  $('#reset-data').addEventListener('click', loadSampleData);

  /* ── Service profiles (optional SOURCE B) ──────────────────────────── */
  function renderMenuTable() {
    const tbody = $('#menu-table tbody');
    tbody.innerHTML = state.serviceProfiles.map((s, i) => `
      <tr data-i="${i}">
        <td><input type="text" value="${esc(s.service_name)}" data-k="service_name" aria-label="Service name"></td>
        <td><input type="number" min="0" step="5" value="${s.typical_duration_minutes ?? ''}" data-k="typical_duration_minutes" aria-label="Typical minutes" placeholder="—"></td>
        <td><input type="number" min="1" max="5" step="1" value="${s.physical_effort ?? ''}" data-k="physical_effort" aria-label="Physical effort 1 to 5" placeholder="—"></td>
        <td><div class="in-money"><b>$</b><input type="number" min="0" step="1" value="${s.supply_cost ?? ''}" data-k="supply_cost" aria-label="Supply cost" placeholder="—"></div></td>
        <td><button type="button" class="icon-btn" data-remove aria-label="Remove ${esc(s.service_name)}">×</button></td>
      </tr>`).join('');
    updateDurationStatus();
  }

  function updateDurationStatus() {
    ingest.attachServiceProfiles(state.appointments, state.serviceProfiles);
    const d = ingest.durationAvailability(state.appointments);
    const el = $('#duration-status');
    if (d.available) el.innerHTML = '<strong>Time-based sections unlocked.</strong> Your Chair Cone will include estimated hours, revenue per hour, and money-versus-energy — labeled as estimates.';
    else if (d.missing_services.length === state.serviceProfiles.length || !state.serviceProfiles.some((s) => s.typical_duration_minutes)) el.textContent = 'No service times yet. Your Chair Cone will stick to what the book supports: appointments, revenue, prices, services, and days.';
    else el.innerHTML = `Still missing a typical time for: <strong>${d.missing_services.map(esc).join(', ')}</strong>. Time-based sections stay locked until every service you performed has one.`;
  }

  $('#menu-table').addEventListener('input', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const s = state.serviceProfiles[Number(tr.dataset.i)];
    const k = e.target.dataset.k;
    s[k] = e.target.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
    if (k === 'typical_duration_minutes') s.duration_source = s.typical_duration_minutes ? 'stylist_estimate' : null;
    updateDurationStatus();
  });
  $('#menu-table').addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove]')) return;
    state.serviceProfiles.splice(Number(e.target.closest('tr').dataset.i), 1);
    renderMenuTable();
  });
  $('#add-service').addEventListener('click', () => {
    state.serviceProfiles.push({ service_name: '', typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null });
    renderMenuTable();
    const last = $('#menu-table tbody tr:last-child input'); if (last) last.focus();
  });
  $('#sample-durations').addEventListener('click', () => {
    const sample = MOCK.sampleDurations();
    state.serviceProfiles.forEach((s) => {
      const hit = sample[ingest.normalizeServiceName(s.service_name) || s.service_name];
      if (hit) Object.assign(s, hit, { duration_source: 'stylist_estimate' });
    });
    renderMenuTable();
  });
  $('#clear-durations').addEventListener('click', () => {
    state.serviceProfiles.forEach((s) => Object.assign(s, { typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null }));
    renderMenuTable();
  });

  /* ── Goals ─────────────────────────────────────────────────────────── */
  const goalsForm = $('#goals-form');
  function renderGoals() {
    Object.entries(state.goals).forEach(([k, v]) => { const el = goalsForm.elements[k]; if (el) el.value = v ?? ''; });
    updateTargetLine();
  }
  function updateTargetLine() {
    const g = state.goals; const el = $('#goals-target');
    if (g.desired_weekly_gross > 0 && g.max_weekly_chair_hours > 0) {
      el.innerHTML = `That works out to a target of <strong>${util.money(g.desired_weekly_gross / g.max_weekly_chair_hours)}/hr</strong> for every hour you're booked — used once your typical service times are in.`;
    } else {
      el.textContent = 'Add a weekly income and hours target and Combed will turn it into an hourly target for your chair.';
    }
  }
  goalsForm.addEventListener('input', (e) => {
    state.goals[e.target.name] = e.target.value === '' ? null : Number(e.target.value);
    updateTargetLine();
  });

  /* ── Upload + read the book ────────────────────────────────────────── */
  const fileInput = $('#file-input'); const thumbs = $('#thumbs'); const dz = $('#dropzone');
  const files = [];
  function refreshReadActions() { $('#read-actions').hidden = files.length === 0; state.bookRead = false; }
  function addFiles(list) {
    [...list].filter((f) => f.type.startsWith('image/') || /\.heic$/i.test(f.name)).slice(0, Math.max(0, 6 - files.length)).forEach((f) => {
      files.push(f);
      const li = document.createElement('li');
      const url = URL.createObjectURL(f);
      li.innerHTML = `<img src="${url}" alt="Appointment book page ${files.length}"><span>Page ${files.length}</span><button type="button" aria-label="Remove page ${files.length}">×</button>`;
      li.querySelector('button').addEventListener('click', () => { files.splice(files.indexOf(f), 1); URL.revokeObjectURL(url); li.remove(); refreshReadActions(); });
      thumbs.appendChild(li);
    });
    refreshReadActions();
  }
  fileInput.addEventListener('change', (e) => addFiles(e.target.files));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  /* Prepare one page photo for the reader.
     A landscape photo of a two-page spread is sent three ways: the FULL spread (so the printed month,
     year, and day numbers are always in view) plus LEFT and RIGHT close-ups (with a little overlap) so
     the cursive arrives at full legibility — the reading model downsizes anything over ~1568px.
     Each part is capped at 1568px on its long edge as JPEG. Also converts HEIC where the browser can
     decode it (Safari); otherwise we ask for JPG. Returns { parts: [{media_type, data}, …] }. */
  function fileToPageParts(file, maxPx = 1568) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const W = img.naturalWidth, H = img.naturalHeight;
        const crops = W > H * 1.15
          ? [{ sx: 0, sw: W }, { sx: 0, sw: Math.round(W * 0.54) }, { sx: Math.round(W * 0.46), sw: W - Math.round(W * 0.46) }]   // full, left, right
          : [{ sx: 0, sw: W }];                                                                                                     // single page
        const parts = crops.map(({ sx, sw }) => {
          const scale = Math.min(1, maxPx / Math.max(sw, H));
          const c = document.createElement('canvas');
          c.width = Math.round(sw * scale); c.height = Math.round(H * scale);
          c.getContext('2d').drawImage(img, sx, 0, sw, H, 0, 0, c.width, c.height);
          return { media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.9).split(',')[1] };
        });
        URL.revokeObjectURL(url);
        resolve({ parts });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} couldn't be opened in this browser. HEIC photos need to be saved as JPG first.`)); };
      img.src = url;
    });
  }

  async function readBook({ quiet = false } = {}) {
    const btn = $('#read-btn'); const status = $('#read-status'); const notes = $('#page-notes');
    btn.disabled = true; status.classList.remove('is-error'); notes.hidden = true; notes.innerHTML = '';
    try {
      status.textContent = 'Preparing your photos…';
      const pages = [];
      for (const f of files) pages.push(await fileToPageParts(f));
      status.textContent = `Reading ${pages.length} page${pages.length === 1 ? '' : 's'} of cursive… this can take a minute.`;
      const res = await postJSON('/api/extract-book', { pages, year: CONFIG.DEMO_YEAR }, 300000);

      loadExtraction(res);
      const { verifiedAppointments, reviewLaterAppointments } = ingest.splitByConfidence(state.appointments);
      console.log('Extracted appointments:', state.appointments.length, '| verified:', verifiedAppointments.length, '| review later:', reviewLaterAppointments.length);
      status.textContent = `Found ${res.entries.length} appointments across ${res.pages.length} page${res.pages.length === 1 ? '' : 's'} — ${verifiedAppointments.length} ready for analysis${reviewLaterAppointments.length ? `, ${reviewLaterAppointments.length} set aside for later` : ''}.`;

      notes.innerHTML = res.pages.map((p) => `<li class="${p.readable ? '' : 'is-warn'}"><strong>Page ${p.image_index + 1}:</strong> ${p.readable
        ? `${p.entries_found} appointment${p.entries_found === 1 ? '' : 's'}${p.dates_visible.length ? ` · ${p.dates_visible.length} calendar day${p.dates_visible.length === 1 ? '' : 's'} visible` : ''}`
        : `couldn't be read clearly — try a straighter, brighter photo of this page.${p.notes ? ` (${esc(p.notes)})` : ''}`}</li>`).join('')
        + (res.undated_entries ? `<li class="is-warn">${res.undated_entries} entr${res.undated_entries === 1 ? 'y' : 'ies'} had no readable date and ${res.undated_entries === 1 ? 'was' : 'were'} left out.</li>` : '')
        + (res.skipped?.length ? `<li>${res.skipped.length} line${res.skipped.length === 1 ? '' : 's'} set aside as notes or cancellations — listed under the review table.</li>` : '');
      notes.hidden = false;
      if (!quiet) $('#review-book').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    } catch (err) {
      console.error(err);
      status.classList.add('is-error');
      status.textContent = err.message || "Combed couldn't read your pages this time. Your photos are still here — try again.";
      if (quiet) throw err;
      return false;
    } finally { btn.disabled = false; }
  }
  $('#read-btn').addEventListener('click', () => readBook());

  /* ── Loading / error ───────────────────────────────────────────────── */
  let loadTimer = null;
  function showLoading(on) {
    const el = $('#loading'); const msg = $('#loading-msg');
    clearInterval(loadTimer);
    el.hidden = !on;
    if (!on) return;
    let i = 0; msg.textContent = CONFIG.LOADING_MESSAGES[0];
    loadTimer = setInterval(() => { i = (i + 1) % CONFIG.LOADING_MESSAGES.length; msg.textContent = CONFIG.LOADING_MESSAGES[i]; }, 2200);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function showError(message) {
    $('#error').hidden = false;
    $('#error-msg').textContent = message || 'Your information is still here — try the analysis again.';
    $('#error').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideError() { $('#error').hidden = true; }

  async function postJSON(url, body, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    } finally { clearTimeout(t); }
  }

  /* ── Analyze ───────────────────────────────────────────────────────── */
  const mode = () => document.querySelector('input[name=mode]:checked').value;

  async function analyze() {
    hideError();
    $('#report').hidden = true;
    const btn = $('#analyze-btn'); btn.disabled = true;

    // Photos added but never read? Read them first so the report is about the real book, not the sample.
    if (files.length && !state.bookRead && mode() === 'live') {
      try { await readBook({ quiet: true }); }
      catch (err) { btn.disabled = false; showError(`We couldn't read your pages: ${err.message} Fix the photo or remove it, then try again.`); return; }
    }

    showLoading(true);

    try {
      /* 1. Confidence split — only verified appointments feed the analysis. Nothing waits on approval. */
      ingest.attachServiceProfiles(state.appointments, state.serviceProfiles);
      const { verifiedAppointments, reviewLaterAppointments } = ingest.splitByConfidence(state.appointments);
      console.log('Extracted appointments:', state.appointments.length);
      console.log('Verified appointments:', verifiedAppointments.length);
      console.log('Review later:', reviewLaterAppointments.length);
      if (!verifiedAppointments.length) {
        showLoading(false);
        showError("We couldn't confidently read enough appointments to build your Chair Cone yet. Fix a few rows in the review table above, or try clearer photos.");
        return;
      }

      /* 2. Deterministic calculations */
      const calculated = calc.computeMetrics({
        appointments: verifiedAppointments, serviceProfiles: state.serviceProfiles, goals: state.goals, observedDates: state.observedDates,
      });
      console.log('Calculated metrics:', calculated.chair_metrics.appointments, 'appointments,', calculated.chair_metrics.gross_revenue, 'gross');

      const coverage = { included: verifiedAppointments.length, total: state.appointments.length };
      let report, meta;

      if (mode() === 'demo') {
        await new Promise((r) => setTimeout(r, 2600));
        report = narrative.buildDemoReport(calculated, MOCK_MARKET.places);
        const ms = narrative.summarizeMarket(MOCK_MARKET.places);
        meta = { modeLabel: `Demo report · ${state.dataLabel} · offline narrative`, marketSource: 'demo', marketLabel: MOCK_MARKET.label, marketMeta: `${ms.places_scanned} sample places · ${ms.review_count} sample reviews` };
      } else {
        /* 3. Apify — never blocks */
        let market = { success: false, places: [], summary: null };
        console.log('Calling local market...');
        try {
          market = await postJSON('/api/local-market', { location: CONFIG.LOCATION.label }, 150000);
          console.log('Local market places:', (market.places || []).length);
        } catch (err) { console.warn('Local market unavailable, continuing:', err.message); }
        const places = market.places || [];

        /* 4. AI reasoning — one attempt, then deterministic fallback */
        const payload = {
          appointments: verifiedAppointments.map(({ id, ...a }) => a), // aliases only; names were stripped at ingest
          services: state.serviceProfiles,
          business_goals: state.goals,
          calculated_metrics: calculated,
          local_market_data: places,
          local_market_summary: market.summary || null,
          observed_calendar_days: state.observedDates.length,
          location: CONFIG.LOCATION.label,
        };
        let fallbackNotice = null;
        console.log('Calling report generator...');
        try {
          const res = await postJSON('/api/generate-report', payload, 180000);
          report = res.report;
          console.log('Report JSON received');
          if (!render.validateReport(report).ok) throw new Error('AI report missing required sections');
        } catch (err) {
          console.warn('AI report unavailable, using deterministic narrative:', err.message);
          report = narrative.buildDemoReport(calculated, places);
          fallbackNotice = 'Combed used your salon numbers directly for this report.';
        }
        const s = market.summary;
        meta = {
          modeLabel: `Live report · ${state.dataLabel} · ${fallbackNotice ? 'salon numbers' : 'AI reasoning'}`,
          marketSource: market.success ? 'apify' : 'none',
          marketError: !market.success,
          marketMeta: s ? `${s.places_scanned} nearby places scanned · ${s.review_count} reviews read` : '',
          fallbackNotice,
        };
      }

      /* 5. One render path for demo and live */
      meta.coverage = coverage;
      meta.reviewLater = reviewLaterAppointments;
      state.lastReport = report;
      saveSnapshot(report, meta);
      console.log('Rendering Chair Cone');
      const out = $('#report');
      out.innerHTML = render.renderReport(report, meta);
      showLoading(false);
      out.hidden = false;
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      out.focus({ preventScroll: true });
    } catch (err) {
      console.error(err);
      showLoading(false);
      const base = /abort/i.test(err.name || '') ? 'That took longer than expected.' : (err.message || 'Something went wrong.');
      showError(/try the analysis again/i.test(base) ? base : `${base} Your information is still here — try the analysis again.`);
    } finally { btn.disabled = false; }
  }

  $('#analyze-btn').addEventListener('click', analyze);
  $('#retry-btn').addEventListener('click', analyze);
  $('#demo-instead-btn').addEventListener('click', () => { document.querySelector('input[name=mode][value=demo]').checked = true; analyze(); });

  /* ── Future comparison loop: keep period snapshots ─────────────────── */
  function saveSnapshot(report, meta) {
    try {
      const key = 'combed.snapshots';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      const cm = report.chair_metrics;
      list.push({
        generated_at: new Date().toISOString(),
        mode: meta.marketSource === 'demo' ? 'demo' : 'live',
        period: { start: cm.period_start, end: cm.period_end, observed_calendar_days: cm.observed_calendar_days },
        chair_metrics: { appointments: cm.appointments, working_days: cm.working_days, gross_revenue: cm.gross_revenue, average_ticket: cm.average_ticket, booked_hours: cm.booked_hours, revenue_per_booked_hour: cm.revenue_per_booked_hour, duration_available: cm.duration_available },
        next_20_day_plan: report.next_20_day_plan,
      });
      localStorage.setItem(key, JSON.stringify(list.slice(-10)));
    } catch { /* storage unavailable — fine */ }
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */
  loadSampleData();
  if (location.protocol === 'file:') {
    document.querySelector('input[name=mode][value=demo]').checked = true;
    document.querySelector('input[name=mode][value=live]').disabled = true;
  }
})();
