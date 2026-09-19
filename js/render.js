/* Combed — REPORT RENDERER
   Renders a Combed Analysis Response Schema object into the page.
   Presentation only. No analysis logic lives here.
   Time-based sections render only when chair_metrics.duration_available is true. */
window.Combed = window.Combed || {};

(function () {
  const { CONFIG, util } = Combed;
  const { esc, money: $, round } = util;
  const hr = (n) => (n == null ? '—' : `${$(n)}/hr`);
  const abbr = (day) => day.slice(0, 3);
  const pct = (n) => `${Math.round(n * 100)}%`;
  // "10:00 AM" → "10a", "3:30 PM" → "3:30p"
  const compactTime = (t) => (t ? esc(String(t).replace(':00', '').replace(/\s*AM/i, 'a').replace(/\s*PM/i, 'p')) : '—');

  const STATUS_TONE = {
    'KEEP STRONG': 'good', STEADY: 'good-soft', WATCH: 'warn', 'PRICE CHECK': 'alert', 'NEEDS MORE DATA': 'muted',
    CONSISTENT: 'good', 'SMALL RANGE': 'good-soft', 'DISCOUNT EXPLAINED': 'gold', 'WIDE RANGE': 'alert',
    KEEP: 'good', REVISIT: 'alert', 'STRONG CANDIDATE FOR A PRICE UPDATE': 'alert-solid',
    'STRONG RETURN': 'good', 'PREMIUM WORK': 'gold', 'WATCH CLOSELY': 'alert', 'EASY BUT LOW RETURN': 'muted',
    high: 'good', medium: 'warn', low: 'muted',
  };
  const pill = (text, extra = '') => `<span class="pill pill--${STATUS_TONE[text] || 'muted'} ${extra}">${esc(text)}</span>`;
  const effortDots = (n) => `<span class="effort" aria-label="Physical effort ${n} out of 5">${'●'.repeat(Math.round(n))}${'○'.repeat(5 - Math.round(n))}</span>`;
  const why = (summary, bodyHtml) => `
    <details class="why">
      <summary>${summary || 'Why Combed is saying this'}</summary>
      <div class="why__body">${bodyHtml}</div>
    </details>`;
  const locked = (title, body) => `
    <div class="locked">
      <span class="locked__icon" aria-hidden="true">⏱</span>
      <div><strong>${title}</strong><p>${body}</p></div>
    </div>`;

  /* ── 7 & 8. Chair Cone header + synopsis ───────────────────────────── */
  function renderCone(r, meta) {
    const cm = r.chair_metrics;
    const es = r.executive_summary;
    const foot = [
      `${cm.working_days} observed working days`,
      `${cm.average_appointments_per_workday} appointments per workday on average`,
      cm.discounted_appointments ? `${cm.discounted_appointments} marked Family Discount` : '',
      cm.entries_without_price ? `<span class="flag">${cm.entries_without_price} book ${cm.entries_without_price === 1 ? 'entry' : 'entries'} had no readable amount and ${cm.entries_without_price === 1 ? 'was' : 'were'} left out of revenue</span>` : '',
    ].filter(Boolean).join(' · ');

    return `
      <header class="cone-head">
        <p class="eyebrow">${esc(meta.modeLabel)}</p>
        <h2 class="display">YOUR CHAIR, COMBED</h2>
        <p class="cone-sub">Based on <strong>${cm.observed_calendar_days || 20} observed calendar days</strong>${cm.period_start ? ` · ${util.shortDate(cm.period_start)} – ${util.shortDate(cm.period_end)}` : ''}</p>
        ${meta.coverage ? `<p class="coverage"><span class="coverage__l">Analysis coverage</span> <strong>${meta.coverage.included} of ${meta.coverage.total}</strong> appointments were confidently read and included in this report${meta.coverage.total ? ` (${Math.round((meta.coverage.included / meta.coverage.total) * 100)}%)` : ''}.</p>` : ''}
        ${meta.fallbackNotice ? `<p class="coverage coverage--soft">${esc(meta.fallbackNotice)}</p>` : ''}
      </header>
      <div class="metrics" role="list">
        <div class="metric" role="listitem"><span class="metric__n">${cm.appointments}</span><span class="metric__l">Appointments</span></div>
        <div class="metric metric--accent" role="listitem"><span class="metric__n">${$(cm.gross_revenue)}</span><span class="metric__l">Observed gross revenue</span></div>
        <div class="metric" role="listitem"><span class="metric__n">${$(cm.average_ticket)}</span><span class="metric__l">Average ticket</span></div>
        <div class="metric" role="listitem"><span class="metric__n metric__n--text">${esc(cm.top_service || '—')}</span><span class="metric__l">Top booked service${cm.top_service_count ? ` · ${cm.top_service_count}×` : ''}</span></div>
      </div>
      ${cm.duration_available ? `
      <div class="metrics metrics--secondary" role="list">
        <div class="metric metric--soft" role="listitem"><span class="metric__n">${round(cm.booked_hours, 0)} hrs</span><span class="metric__l">Estimated service time</span></div>
        <div class="metric metric--soft" role="listitem"><span class="metric__n">${hr(cm.revenue_per_booked_hour)}</span><span class="metric__l">Gross revenue per estimated hour</span></div>
        <p class="metrics-note">Based on the typical service times you provided — estimates, not clock time.</p>
      </div>` : ''}
      <p class="metrics-foot">${foot}</p>

      <section class="synopsis">
        <h3>Here's what your chair is telling you.</h3>
        <p class="synopsis__headline editorial">${esc(es.headline)}</p>
        <p class="synopsis__body">${esc(es.summary)}</p>
        ${es.primary_opportunity ? `<p class="synopsis__opp"><span class="tag">Biggest opportunity</span> ${esc(es.primary_opportunity)}</p>` : ''}
      </section>`;
  }

  /* ── 9. Daily money ────────────────────────────────────────────────── */
  function renderDaily(r) {
    const days = r.daily_performance;
    if (!days.length) return '';
    const max = Math.max(...days.map((d) => d.gross_revenue), 1);
    const sa = r.schedule_analysis;
    const best = [...days].sort((a, b) => b.gross_revenue - a.gross_revenue)[0];
    const light = [...days].filter((d) => d.appointments).sort((a, b) => a.gross_revenue - b.gross_revenue)[0];
    const pair = findComparablePair(days);

    return `
      <section class="block">
        <h3 class="block__title">What each day brought in</h3>
        <p class="block__lede">Each bar is one day you worked. Taller means more observed revenue. Under each bar: how many appointments were in the book that day.</p>
        <div class="chart-scroll">
          <div class="bars" role="img" aria-label="Bar chart of observed gross revenue by working day">
            ${days.map((d) => `
              <div class="bar ${d.date === best.date ? 'bar--best' : ''} ${light && d.date === light.date ? 'bar--light' : ''}">
                <span class="bar__val">${$(d.gross_revenue)}</span>
                <div class="bar__track"><div class="bar__fill" style="height:${Math.max(4, (d.gross_revenue / max) * 100)}%"></div></div>
                <span class="bar__date">${util.shortDate(d.date)}</span>
                <span class="bar__day">${abbr(d.day_of_week)}</span>
                <span class="bar__meta">${d.appointments} appt${d.appointments === 1 ? '' : 's'}${d.first_start ? `<br>${compactTime(d.first_start)}–${compactTime(d.last_start)}` : ''}</span>
              </div>`).join('')}
          </div>
        </div>
        <ul class="takeaways">
          <li>Your strongest day was <strong>${util.shortDate(best.date)} (${best.day_of_week})</strong> — ${$(best.gross_revenue)} from ${best.appointments} appointments.</li>
          ${light && light.date !== best.date ? `<li>Your lightest working day was <strong>${util.shortDate(light.date)} (${light.day_of_week})</strong> — ${$(light.gross_revenue)} from ${light.appointments} appointment${light.appointments === 1 ? '' : 's'}, first at ${esc(light.first_start || '—')} and last at ${esc(light.last_start || '—')}.</li>` : ''}
          ${pair ? `<li>${esc(pair)}</li>` : ''}
          ${sa.strongest_day ? `<li>By weekday, <strong>${sa.strongest_day}s</strong> brought in the most on average; <strong>${sa.weakest_day}s</strong> the least.</li>` : ''}
        </ul>
      </section>`;
  }

  function findComparablePair(days) {
    let best = null;
    for (let i = 0; i < days.length; i++) for (let j = i + 1; j < days.length; j++) {
      const a = days[i], b = days[j];
      if (a.appointments === b.appointments && a.appointments >= 3) {
        const diff = Math.abs(a.gross_revenue - b.gross_revenue);
        if (!best || diff > best.diff) best = { a, b, diff };
      }
    }
    if (!best || best.diff < 40) return null;
    const [lo, hi] = best.a.gross_revenue < best.b.gross_revenue ? [best.a, best.b] : [best.b, best.a];
    return `${util.shortDate(lo.date)} (${lo.day_of_week}) and ${util.shortDate(hi.date)} (${hi.day_of_week}) both had ${lo.appointments} appointments, but ${util.shortDate(hi.date)} brought in ${$(hi.gross_revenue - lo.gross_revenue)} more — the mix of services matters as much as the count.`;
  }

  /* ── 10. Service money ─────────────────────────────────────────────── */
  function renderServices(r) {
    const list = r.service_performance;
    if (!list.length) return '';
    const max = Math.max(...list.map((s) => s.gross_revenue), 1) * 1.08;
    return `
      <section class="block">
        <h3 class="block__title">Which services brought the most into your chair?</h3>
        <p class="block__lede">Ranked by observed gross revenue across the appointment-book dates provided. Next to each: how many times it was booked and the average price you charged.</p>
        <div class="hbars" role="img" aria-label="Horizontal bar chart of services ranked by observed gross revenue">
          ${list.map((s) => `
            <div class="hbar">
              <div class="hbar__label"><strong>${esc(s.service_name)}</strong><span>${s.appointment_count} appt${s.appointment_count === 1 ? '' : 's'} · avg ${$(s.average_price)}</span></div>
              <div class="hbar__track">
                <div class="hbar__fill hbar__fill--${STATUS_TONE[s.status] || 'muted'}" style="width:${(s.gross_revenue / max) * 100}%"><span>${$(s.gross_revenue)}</span></div>
              </div>
              <div class="hbar__status">${pill(s.status)}</div>
            </div>`).join('')}
        </div>
        <ul class="takeaways takeaways--cards">
          ${list.filter((s) => s.insight).map((s) => `<li><strong>${esc(s.service_name)}.</strong> ${esc(s.insight)}</li>`).join('')}
        </ul>
      </section>`;
  }

  /* ── 11. Price Check (consistency first; time signal when unlocked) ── */
  function renderPricing(r) {
    const list = r.pricing_signals;
    if (!list.length) return '';
    const timed = r.chair_metrics.duration_available;
    const order = ['WIDE RANGE', 'DISCOUNT EXPLAINED', 'SMALL RANGE', 'CONSISTENT', 'NEEDS MORE DATA'];
    const sorted = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    return `
      <section class="block">
        <h3 class="block__title">Are your prices working as hard as you are?</h3>
        <p class="block__lede">This starts with your own book. For each service: what you actually charged, how much it varied, and whether a marked discount explains the difference. Discounted visits are set aside, not judged.${timed ? ' Because you added typical service times, each card also shows a <em>sustainable price signal</em> — a planning signal, not a rule.' : ''}</p>
        ${!timed ? `<p class="notice notice--soft">Per-hour pricing signals are waiting on your typical service times. Add them under <strong>Add what only you know</strong> and this section will show what each service earns per hour.</p>` : ''}
        <div class="price-grid">
          ${sorted.map((p) => `
            <article class="price-card price-card--${STATUS_TONE[p.status] || 'muted'}">
              <div class="price-card__head"><h4>${esc(p.service_name)}</h4>${pill(p.status)}</div>
              <dl class="price-card__facts">
                <div><dt>Booked</dt><dd>${p.appointment_count}×</dd></div>
                <div><dt>Average observed</dt><dd>${$(p.average_price)}</dd></div>
                <div><dt>Observed range</dt><dd>${p.min_price === p.max_price ? $(p.min_price) : `${$(p.min_price)}–${$(p.max_price)}`}</dd></div>
                <div><dt>${p.discounted_count ? 'Standard range' : 'Discounted visits'}</dt><dd>${p.discounted_count ? (p.standard_min_price === p.standard_max_price ? $(p.standard_min_price) : `${$(p.standard_min_price)}–${$(p.standard_max_price)}`) : 'none'}</dd></div>
              </dl>
              ${p.discounted_count ? `<p class="price-card__disc">${p.discounted_count} visit${p.discounted_count === 1 ? '' : 's'} marked Family Discount — set aside, not judged. Standard visits averaged ${$(p.standard_average_price)}.</p>` : ''}
              <p class="price-card__note">${esc(p.explanation)}</p>
              ${timed && p.time_status !== 'NEEDS MORE DATA' ? `
                <div class="price-card__time">
                  <div class="price-card__time-head"><span>With your ${p.duration_minutes}-min estimate</span>${pill(p.time_status)}</div>
                  <dl class="price-card__facts">
                    <div><dt>Your chair earns</dt><dd>${hr(p.current_hourly_rate)}</dd></div>
                    <div><dt>Your target</dt><dd>${hr(p.target_hourly_rate)}</dd></div>
                  </dl>
                  <div class="price-card__signal"><span>Sustainable price signal</span><strong>${p.sustainable_price_signal != null ? `about ${$(p.sustainable_price_signal)}` : '—'}</strong></div>
                  ${p.suggested_test_increase > 0 ? `<p class="price-card__test">Reasonable test: <strong>+${$(p.suggested_test_increase)}</strong> → ${$(p.standard_average_price + p.suggested_test_increase)}</p>` : ''}
                </div>` : ''}
            </article>`).join('')}
        </div>
      </section>`;
  }

  /* ── 12. Money vs Energy (Tier 2) ──────────────────────────────────── */
  function renderEffort(r) {
    const list = r.effort_vs_value;
    const cm = r.chair_metrics;
    if (!cm.duration_available || !list.length) {
      return `
        <section class="block">
          <h3 class="block__title">What's worth your energy?</h3>
          <p class="block__lede">This compares what a service earns per hour against how hard it is on your body.</p>
          ${locked('Waiting on your typical service times and effort ratings.',
            `The appointment book tells us when clients came in, not how long each service took. Add a typical duration and a 1–5 effort rating for each service under <strong>Add what only you know</strong>${cm.duration_missing_services?.length && cm.duration_missing_services.length <= 3 ? ` (still missing: ${cm.duration_missing_services.map(esc).join(', ')})` : ''} and Combed will unlock this section. Until then we won't guess.`)}
        </section>`;
    }
    const maxRev = Math.max(...list.map((e) => e.gross_revenue || 1));
    const quads = [
      { key: 'STRONG RETURN', sub: 'Good money · manageable effort' },
      { key: 'PREMIUM WORK', sub: 'Good money · hard on your body' },
      { key: 'EASY BUT LOW RETURN', sub: 'Easy on you · lower money' },
      { key: 'WATCH CLOSELY', sub: 'Hard on you · lower money' },
    ];
    return `
      <section class="block">
        <h3 class="block__title">What's worth your energy?</h3>
        <p class="block__lede">You rated each service 1–5 for how much it asks from your body and gave a typical time. Here's that next to what the service earns per estimated hour. Bigger circles brought in more total money. The question: <strong>is this service worth what it asks from you?</strong></p>
        <div class="quads">
          ${quads.map((q) => {
            const items = list.filter((e) => e.category === q.key);
            return `
              <div class="quad quad--${STATUS_TONE[q.key]}">
                <div class="quad__head">${pill(q.key)}<span>${q.sub}</span></div>
                <div class="quad__body">
                  ${items.length ? items.map((e) => `
                    <div class="bubble bubble--${sizeClass(e.gross_revenue, maxRev)}" title="${esc(e.service_name)}">
                      <strong>${esc(e.service_name)}</strong><span>${hr(e.revenue_per_booked_hour)}</span>${effortDots(e.physical_effort)}
                    </div>`).join('') : '<p class="quad__empty">Nothing here right now.</p>'}
                </div>
              </div>`;
          }).join('')}
        </div>
        <ul class="takeaways takeaways--cards">
          ${list.filter((e) => e.insight).map((e) => `<li><strong>${esc(e.service_name)}.</strong> ${esc(e.insight)}</li>`).join('')}
        </ul>
      </section>`;
  }
  const sizeClass = (v, max) => (v / max > 0.66 ? 'lg' : v / max > 0.33 ? 'md' : 'sm');

  /* ── 13. Schedule: where appointments land ─────────────────────────── */
  function renderSchedule(r) {
    const sa = r.schedule_analysis;
    const grid = sa.start_grid || {};
    const days = CONFIG.WEEKDAYS.filter((w) => grid[w]);
    if (!days.length) return '';
    const maxCell = Math.max(...days.flatMap((w) => Object.values(grid[w])), 0.1);
    const level = (v) => (v === 0 ? 0 : v / maxCell > 0.75 ? 4 : v / maxCell > 0.5 ? 3 : v / maxCell > 0.25 ? 2 : 1);
    const prof = sa.weekday_profile || [];
    const byDay = Object.fromEntries(prof.map((p) => [p.day_of_week, p]));
    const fmtN = (v) => (Number.isInteger(v) ? v : v.toFixed(1));

    return `
      <section class="block">
        <h3 class="block__title">Where your chair is working hardest</h3>
        <p class="block__lede">How many appointments typically <em>start</em> in each part of the day, by weekday. Darker means more clients. Blank means nobody was booked to start then. This is about when clients arrive, not how long each service took.</p>
        <div class="heat-scroll">
          <table class="heat">
            <thead><tr><th scope="col">Day</th>${CONFIG.PERIODS.map((p) => `<th scope="col">${p.label}<small>${fmtHour(p.start)}–${fmtHour(p.end)}</small></th>`).join('')}<th scope="col">First → last</th></tr></thead>
            <tbody>
              ${days.map((w) => `
                <tr>
                  <th scope="row">${w}<small>${byDay[w]?.occurrences || 0}×</small></th>
                  ${CONFIG.PERIODS.map((p) => { const v = grid[w][p.key]; return `<td class="heat__cell heat__cell--${level(v)}">${v ? `${fmtN(v)}<small>${v === 1 ? 'appt' : 'appts'}</small>` : '<span class="heat__open">open</span>'}</td>`; }).join('')}
                  <td class="heat__window">${byDay[w] ? `${esc(byDay[w].avg_first_start || '—')} → ${esc(byDay[w].avg_last_start || '—')}<small>${byDay[w].avg_appointments} appts avg</small>` : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="sched-cards">
          <div class="sched-card sched-card--good"><span class="sched-card__l">Strongest day</span><strong>${esc(sa.strongest_day)}</strong><span>${byDay[sa.strongest_day] ? `${$(byDay[sa.strongest_day].avg_gross_revenue)} avg · ${byDay[sa.strongest_day].avg_appointments} appts` : ''}</span></div>
          <div class="sched-card"><span class="sched-card__l">Lightest day</span><strong>${esc(sa.weakest_day)}</strong><span>${byDay[sa.weakest_day] ? `${$(byDay[sa.weakest_day].avg_gross_revenue)} avg · ${byDay[sa.weakest_day].avg_appointments} appts` : ''}</span></div>
          <div class="sched-card sched-card--alert"><span class="sched-card__l">Most spread out</span><strong>${esc(sa.most_fragmented_day)}</strong><span>${byDay[sa.most_fragmented_day] ? `${byDay[sa.most_fragmented_day].avg_appointments} appts across ${byDay[sa.most_fragmented_day].avg_start_spread_hours}h of start times` : ''}</span></div>
        </div>
        <p class="sched-conclusion">${esc(sa.potential_consolidation)}</p>
        ${why('', `
          <table class="mini-table">
            <thead><tr><th>Weekday</th><th>Avg appts</th><th>First start</th><th>Last start</th><th>Spread</th><th>Avg revenue</th></tr></thead>
            <tbody>${prof.map((p) => `<tr><td>${p.day_of_week}</td><td>${p.avg_appointments}</td><td>${esc(p.avg_first_start || '—')}</td><td>${esc(p.avg_last_start || '—')}</td><td>${p.avg_start_spread_hours}h</td><td>${$(p.avg_gross_revenue)}</td></tr>`).join('')}</tbody>
          </table>
          <p>“Spread” is the time between the first appointment start and the last appointment start on that day. It is not how long you worked and not how long services took — the book doesn't record that.</p>`)}
      </section>`;
  }
  const fmtHour = (h) => `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`;

  /* ── 14. Local market ──────────────────────────────────────────────── */
  function renderMarket(r, meta) {
    const list = r.local_market_signals || [];
    return `
      <section class="block block--market">
        <div class="market-head">
          <div>
            <h3 class="block__title">What's happening around your chair</h3>
            <p class="market-sub">Local signals from ${esc(CONFIG.LOCATION.city)}</p>
          </div>
          <span class="powered ${meta.marketSource === 'apify' ? '' : 'powered--demo'}">${meta.marketSource === 'apify' ? 'Powered by Apify' : esc(meta.marketLabel || 'Sample data')}</span>
        </div>
        ${meta.marketError ? `<p class="notice">Local market signals aren't available right now, but your Chair Cone is still based on your salon data.</p>` : ''}
        ${meta.marketMeta ? `<p class="market-meta">${meta.marketMeta}</p>` : ''}
        ${list.length ? `
          <div class="signals">
            ${list.map((s) => `
              <article class="signal">
                <div class="signal__head"><h4>${esc(s.title)}</h4><span class="signal__conf">${pill(s.confidence)}${s.evidence_count != null ? `<small>${s.evidence_count} mention${s.evidence_count === 1 ? '' : 's'}</small>` : ''}</span></div>
                <p>${esc(s.observation)}</p>
                <p class="signal__rel"><span class="tag tag--green">For you</span> ${esc(s.business_relevance)}</p>
                ${s.recommended_test ? `<p class="signal__test"><span class="tag">Worth testing</span> ${esc(s.recommended_test)}</p>` : ''}
              </article>`).join('')}
          </div>
          <p class="fineprint">These are signals from available local data, not universal truths. Business names are not shown.</p>`
          : (!meta.marketError ? '<p class="notice">No local signals came back this time. Your chair analysis above stands on its own.</p>' : '')}
      </section>`;
  }

  /* ── 15 & 16. Next 20 days + goal ──────────────────────────────────── */
  function renderPlan(r) {
    const p = r.next_20_day_plan;
    const sa = r.schedule_analysis;
    const cm = r.chair_metrics;
    const prof = Object.fromEntries((sa.weekday_profile || []).map((w) => [w.day_of_week, w]));
    const weak = prof[sa.weakest_day];
    const named = (text, list) => list.find((s) => text && text.toLowerCase().includes(s.service_name.toLowerCase()));
    const topSvc = named(p.service_move, r.service_performance) || r.service_performance[0];
    const priceSvc = named(p.pricing_move, r.pricing_signals);

    const moves = [
      { n: 1, title: 'COMB YOUR SCHEDULE', text: p.schedule_move, why: weak ? `${weak.day_of_week} averaged ${weak.avg_appointments} appointments and ${$(weak.avg_gross_revenue)}, with the first start around ${esc(weak.avg_first_start || '—')} and the last around ${esc(weak.avg_last_start || '—')}. ${sa.consolidation_candidate ? `${sa.consolidation_candidate.absorbing_days.join(', ')} each average more appointments per day.` : ''}` : '' },
      { n: 2, title: 'COMB YOUR PRICES', text: p.pricing_move, why: priceSvc ? `${priceSvc.service_name}: booked ${priceSvc.appointment_count} times, charged ${priceSvc.min_price === priceSvc.max_price ? $(priceSvc.min_price) : `${$(priceSvc.min_price)}–${$(priceSvc.max_price)}`}, standard average ${$(priceSvc.standard_average_price)}${priceSvc.discounted_count ? `, ${priceSvc.discounted_count} marked Family Discount` : ''}.${priceSvc.current_hourly_rate != null ? ` With your time estimate: ${hr(priceSvc.current_hourly_rate)} vs a ${hr(priceSvc.target_hourly_rate)} target.` : ''}` : '' },
      { n: 3, title: 'COMB YOUR SERVICE MIX', text: p.service_move, why: topSvc ? `${topSvc.service_name} brought in ${$(topSvc.gross_revenue)} across ${topSvc.appointment_count} visits — ${pct(topSvc.revenue_share)} of your observed revenue.` : '' },
      { n: 4, title: 'COMB YOUR TIME', text: p.time_goal, why: `You worked ${cm.working_days} of ${cm.observed_calendar_days} observed days${sa.consolidation_candidate ? `; ${sa.consolidation_candidate.candidate_day}s carried about ${pct(sa.consolidation_candidate.share_of_revenue)} of observed revenue` : ''}.` },
    ].filter((m) => m.text);

    return `
      <section class="plan">
        <header class="plan__head">
          <p class="eyebrow eyebrow--light">Here's your Combed plan.</p>
          <h2 class="display">Your Next 20 Days</h2>
        </header>
        <div class="moves">
          ${moves.map((m) => `
            <article class="move">
              <span class="move__n">${m.n}</span>
              <h3 class="move__title">${m.title}</h3>
              <p class="move__text">${esc(m.text)}</p>
              ${m.why ? why('', `<p>${m.why}</p>`) : ''}
            </article>`).join('')}
        </div>
        <div class="goal">
          <p class="goal__l">Your next 20-day goal</p>
          <p class="goal__main">${esc(p.revenue_goal || p.primary_metric_target)}</p>
          ${p.primary_metric ? `<p class="goal__metric"><span>Watch this number:</span> <strong>${esc(p.primary_metric)}</strong> — ${esc(p.primary_metric_target)}</p>` : ''}
          <p class="goal__loop">Come back after your next 20 days. Combed will compare the two periods: appointments, revenue, average ticket, and workdays.</p>
        </div>
      </section>`;
  }

  /* ── Review for Later Analysis (informational; nothing here was counted) ── */
  function renderReviewLater(list) {
    if (!list || !list.length) return '';
    return `
      <section class="block block--later">
        <div class="market-head">
          <div>
            <h3 class="block__title">Review for Later Analysis</h3>
            <p class="market-sub">We found a few appointments we weren't confident enough to include yet. They were left out of this Chair Cone so they don't distort your results.</p>
          </div>
          <span class="powered powered--demo">Not included in today's analysis</span>
        </div>
        <div class="table-wrap">
          <table class="mini-table mini-table--later">
            <thead><tr><th>Date</th><th>Start</th><th>Service (as read)</th><th>Amount</th><th>Confidence</th><th>Why it's here</th></tr></thead>
            <tbody>
              ${list.map((a) => `<tr>
                <td>${util.shortDate(a.date)}<small>${esc(a.day_of_week || '')}</small></td>
                <td>${esc(a.start_time || a.start_time_raw || '—')}</td>
                <td>${esc(a.service_raw || '—')}${a.raw_text ? `<span class="raw-read">“${esc(a.raw_text)}”</span>` : ''}</td>
                <td>${a.price != null ? $(a.price) : '—'}</td>
                <td>${Math.round((a.overall_confidence || 0) * 100)}%</td>
                <td>${esc(a.review_reason || 'Reader was not confident enough')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="fineprint">You can fix any of these in <em>Make sure we read your book right</em> above and run Combed again — corrected rows join the analysis automatically.</p>
      </section>`;
  }

  /* Minimum shape check + safe defaults so one missing optional section never blocks the report. */
  function validateReport(report) {
    const required = ['executive_summary', 'chair_metrics', 'daily_performance', 'service_performance', 'next_20_day_plan'];
    const missing = required.filter((k) => !report || report[k] == null);
    if (missing.length) return { ok: false, missing };
    report.daily_performance ||= [];
    report.service_performance ||= [];
    report.pricing_signals ||= [];
    report.effort_vs_value ||= [];
    report.local_market_signals ||= [];
    report.schedule_analysis ||= { strongest_day: '', weakest_day: '', most_fragmented_day: '', potential_consolidation: '', weekday_profile: [], start_grid: {} };
    report.executive_summary = { headline: '', summary: '', primary_opportunity: '', ...report.executive_summary };
    report.next_20_day_plan = { schedule_move: '', pricing_move: '', service_move: '', time_goal: '', revenue_goal: '', primary_metric: '', primary_metric_target: '', ...report.next_20_day_plan };
    return { ok: true, missing: [] };
  }

  /* ── Whole report — the ONE render path for demo and live ──────────── */
  function renderReport(report, meta = {}) {
    const check = validateReport(report);
    if (!check.ok) throw new Error(`Report is missing required sections: ${check.missing.join(', ')}`);
    const timed = report.chair_metrics.duration_available;
    return `
      <div class="cone">${renderCone(report, meta)}</div>
      ${renderDaily(report)}
      ${renderServices(report)}
      ${renderPricing(report)}
      ${renderEffort(report)}
      ${renderSchedule(report)}
      ${renderMarket(report, meta)}
      ${renderPlan(report)}
      ${renderReviewLater(meta.reviewLater)}
      <section class="block block--how">
        ${why('How Combed calculates', `
          <p><strong>From your book.</strong> Observed gross revenue = the dollar amounts written next to appointments, added up. Average ticket = revenue ÷ appointments with a readable amount. A service's observed range = the lowest and highest amount charged for it; visits marked Family Discount are set aside before we call a price "standard". A day's spread = time from the first appointment start to the last appointment start. Numbers written in the schedule are start times, never durations.</p>
          <p><strong>What the book can't tell us.</strong> How long each service took. ${timed ? 'You supplied typical service times, so estimated hours, revenue per estimated hour, target hourly rate (desired weekly gross ÷ preferred weekly chair hours) and the sustainable price signal (target rate × typical hours + supply cost, rounded to $5) are shown as estimates.' : 'Until you add typical service times, Combed does not show hours, revenue per hour, or time-based price signals — and never estimates them from the gaps between appointments.'}</p>
          <p>Gross revenue is not profit. Client names are never displayed.</p>`)}
      </section>`;
  }

  Combed.render = { renderReport, validateReport };
})();
