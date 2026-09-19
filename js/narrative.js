/* Combed — DEMO NARRATIVE (offline reasoning fallback)
   Fills the narrative fields of the Analysis Response Schema from the numbers.
   Used in DEMO MODE; in LIVE MODE the AI writes these.
   Rule: say what the book shows. Per-hour language only when duration_available. */
window.Combed = window.Combed || {};

(function () {
  const { util } = Combed;
  const $ = util.money;
  const hr = (n) => `${$(n)}/hr`;

  const THEMES = [
    { key: 'natural', label: 'Natural hair', words: ['natural hair', 'natural', 'edges', 'healthy hair'] },
    { key: 'silk press', label: 'Silk press / flat iron', words: ['silk press', 'flat iron', 'press'] },
    { key: 'braids', label: 'Braids & twists', words: ['braid', 'twist', 'knotless', 'locs'] },
    { key: 'color', label: 'Color', words: ['color', 'colour', 'highlight'] },
    { key: 'evening', label: 'Late hours', words: ['late', 'after work', 'evening'] },
  ];

  function summarizeMarket(places) {
    const reviews = [];
    places.forEach((p) => (p.reviews || []).forEach((r) => reviews.push(String(typeof r === 'string' ? r : r.text || '').toLowerCase())));
    const themes = THEMES.map((t) => ({ ...t, count: reviews.filter((r) => t.words.some((w) => r.includes(w))).length })).sort((a, b) => b.count - a.count);
    const parseClose = (str) => { const m = String(str).match(/(?:[–-]|\bto\b)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i); if (!m) return null; let h = Number(m[1]); if (/pm/i.test(m[3]) && h < 12) h += 12; return h; };
    const withHours = places.filter((p) => p.hours && Object.keys(p.hours).length);
    const lateWeekday = withHours.filter((p) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].some((d) => (parseClose(p.hours[d]) || 0) >= 19));
    const rated = places.filter((p) => typeof p.rating === 'number');
    return {
      places_scanned: places.length, review_count: reviews.length, themes,
      late_weekday_count: lateWeekday.length, with_hours_count: withHours.length,
      avg_rating: rated.length ? util.round(rated.reduce((s, p) => s + p.rating, 0) / rated.length, 1) : null,
    };
  }

  /* Which of the stylist's services touches a review theme? Word overlap on the service name. */
  const serviceTouches = (svc, theme) => theme.words.some((w) => svc.service_name.toLowerCase().includes(w.split(' ')[0]));

  function buildMarketSignals(places, calc) {
    if (!places || !places.length) return [];
    const m = summarizeMarket(places);
    const signals = [];
    const top = calc.service_performance[0];
    const topThree = calc.service_performance.slice(0, 3);

    const theme = m.themes.find((t) => t.count >= 2 && t.key !== 'evening' && topThree.some((s) => serviceTouches(s, t)))
      || m.themes.find((t) => t.count >= 2 && t.key !== 'evening');
    if (theme) {
      const hit = topThree.find((s) => serviceTouches(s, theme));
      signals.push({
        title: `${theme.label} is showing up`,
        signal_type: 'review_theme',
        observation: `${theme.label} language appeared in ${theme.count} of ${m.review_count} nearby reviews we scanned.`,
        business_relevance: hit
          ? `${hit.service_name} — ${hit.appointment_count} of your observed appointments and ${$(hit.gross_revenue)} of observed revenue — sits inside this conversation.`
          : 'This is a live customer conversation in your area. Worth knowing where your menu overlaps it.',
        recommended_test: hit ? `Protect ${hit.service_name} availability before adding a new service.` : 'Note which of your services touch this theme before considering a new one.',
        confidence: theme.count >= 4 ? 'medium' : 'low',
        evidence_count: theme.count,
      });
    }

    if (m.with_hours_count) {
      signals.push({
        title: m.late_weekday_count >= m.with_hours_count / 2 ? 'Later hours are common' : 'Later hours are the exception',
        signal_type: 'business_hours',
        observation: `${m.late_weekday_count} of ${m.with_hours_count} nearby salons with posted hours stay open until 7 PM or later on at least one weekday.`,
        business_relevance: 'Context, not a directive. Your goal is fewer, fuller days — not longer ones.',
        recommended_test: 'If a client asks for a later slot, offer it on a day you already work rather than opening a new one.',
        confidence: 'medium',
        evidence_count: m.late_weekday_count,
      });
    }

    const wk = calc.schedule_analysis.weakest_day;
    if (m.with_hours_count && wk) {
      const closedOnWeak = places.filter((p) => p.hours && Object.keys(p.hours).length && !p.hours[wk]).length;
      const weakAvg = $(calc.schedule_analysis.weekday_profile.find((w) => w.day_of_week === wk)?.avg_gross_revenue);
      const quiet = closedOnWeak >= 2;
      signals.push({
        title: quiet ? `${wk} looks quiet around you too` : `Others stay open on ${wk}`,
        signal_type: 'market_density',
        observation: quiet
          ? `${closedOnWeak} of ${m.with_hours_count} nearby salons with posted hours don’t list ${wk} hours at all.`
          : `Most nearby salons with posted hours (${m.with_hours_count - closedOnWeak} of ${m.with_hours_count}) list ${wk} hours.`,
        business_relevance: quiet
          ? `${wk} is also your lightest day (about ${weakAvg} on average). The neighborhood may agree with your book.`
          : `Your light ${wk} (about ${weakAvg} on average) looks like a scheduling pattern, not a neighborhood one.`,
        recommended_test: `Treat ${wk} as the first day to test consolidating.`,
        confidence: quiet ? 'medium' : 'low',
        evidence_count: closedOnWeak,
      });
    }
    return signals.slice(0, 4);
  }

  function buildDemoReport(calc, marketPlaces) {
    const cm = calc.chair_metrics;
    const sa = calc.schedule_analysis;
    const svc = calc.service_performance;
    const timed = cm.duration_available;
    const top = svc[0];
    const weak = sa.weekday_profile.find((w) => w.day_of_week === sa.weakest_day);
    const strong = sa.weekday_profile.find((w) => w.day_of_week === sa.strongest_day);
    const cons = sa.consolidation_candidate;
    const wide = calc.pricing_signals.filter((p) => p.status === 'WIDE RANGE');
    const discountExplained = calc.pricing_signals.filter((p) => p.status === 'DISCOUNT EXPLAINED');

    /* ── Executive summary ─────────────────────────────────────────────── */
    const executive_summary = {
      headline: cons ? `You don’t need more clients. You may need a better ${cons.candidate_day}.` : 'Your chair is busy. Here’s what the book says about it.',
      summary: [
        `Across ${cm.observed_calendar_days} observed calendar days you worked ${cm.working_days} of them, saw ${cm.appointments} clients, and brought in about ${$(cm.gross_revenue)} — an average ticket of ${$(cm.average_ticket)}.`,
        top ? `${top.service_name} was your biggest earner at ${$(top.gross_revenue)} across ${top.appointment_count} visits${cm.top_service && cm.top_service !== top.service_name ? `, while ${cm.top_service} was booked most often (${cm.top_service_count} times)` : ''}.` : '',
        weak && strong ? `${strong.day_of_week}s averaged ${$(strong.avg_gross_revenue)}; ${weak.day_of_week}s averaged ${$(weak.avg_gross_revenue)} from about ${weak.avg_appointments} appointments spread over ${weak.avg_start_spread_hours} hours.` : '',
        cm.discounted_appointments ? `${cm.discounted_appointments} appointments were marked Family Discount and were kept separate when we looked at your standard prices.` : '',
        timed ? `With your typical service times, your chair earned about ${hr(cm.revenue_per_booked_hour)} for the hours you were doing hair.` : '',
      ].filter(Boolean).join(' '),
      primary_opportunity: cons
        ? `Tighten ${cons.candidate_day} and hold your standard prices steady before adding anything to your week.`
        : (wide.length ? `Settle on one standard price for ${wide[0].service_name} before anything else.` : 'Protect the services already carrying your revenue before adding another workday.'),
    };

    /* ── Service insights ──────────────────────────────────────────────── */
    const service_performance = svc.map((s) => ({
      ...s,
      insight: s.status === 'NEEDS MORE DATA'
        ? 'Only booked once in this period — not enough to judge yet.'
        : s.status === 'KEEP STRONG'
          ? `${$(s.gross_revenue)} across ${s.appointment_count} visits — ${Math.round(s.revenue_share * 100)}% of everything your chair brought in. This is work worth protecting.`
          : s.status === 'PRICE CHECK'
            ? `Charged between ${$(s.min_price)} and ${$(s.max_price)} across ${s.appointment_count} visits, and discounts don’t explain the whole range. Worth settling on one standard price.`
            : `${s.appointment_count} visits, ${$(s.gross_revenue)} total, usually around ${$(s.standard_average_price)}. Steady, not a headline.`,
    }));

    /* ── Pricing explanations ──────────────────────────────────────────── */
    const pricing_signals = calc.pricing_signals.map((p) => {
      let explanation;
      if (p.status === 'NEEDS MORE DATA') explanation = 'Booked once in this period. We need a few more visits before we can talk about consistency.';
      else if (p.status === 'CONSISTENT') explanation = `Every one of the ${p.appointment_count} visits was ${$(p.average_price)}. Clear and predictable.`;
      else if (p.status === 'DISCOUNT EXPLAINED') explanation = `You charged between ${$(p.min_price)} and ${$(p.max_price)}. The lower amounts were marked Family Discount; your standard price held around ${$(p.standard_average_price)}. Those discounted visits were set aside so they don’t distort the picture.`;
      else if (p.status === 'SMALL RANGE') explanation = `You charged between ${$(p.min_price)} and ${$(p.max_price)}, averaging ${$(p.standard_average_price)}. Close enough to call it one price.`;
      else if (p.discounted_count) explanation = `You charged between ${$(p.min_price)} and ${$(p.max_price)} across ${p.appointment_count} visits. ${p.discounted_count} lower-priced visit${p.discounted_count === 1 ? ' was' : 's were'} marked Family Discount and set aside — but the rest still ranged ${$(p.standard_min_price)}–${$(p.standard_max_price)}, usually around ${$(p.standard_average_price)}. Worth deciding on one standard price so every visit earns it.`;
      else explanation = `You charged between ${$(p.min_price)} and ${$(p.max_price)} across ${p.appointment_count} visits with no discount noted, usually around ${$(p.standard_average_price)}. Worth deciding on one standard price so every visit earns it.`;
      if (timed && p.time_status !== 'NEEDS MORE DATA') {
        const hours = util.round(p.duration_minutes / 60, 1);
        explanation += p.time_status === 'KEEP'
          ? ` With your ${hours}-hour estimate this earns about ${hr(p.current_hourly_rate)} — at or above your ${hr(p.target_hourly_rate)} target.`
          : ` With your ${hours}-hour estimate this earns about ${hr(p.current_hourly_rate)}, below the ${hr(p.target_hourly_rate)} target you set. Instead of jumping straight to ${$(p.sustainable_price_signal)}, consider testing a ${$(p.suggested_test_increase)} increase first.`;
      }
      return { ...p, explanation };
    });

    /* ── Effort (Tier 2 only) ──────────────────────────────────────────── */
    const effort_vs_value = calc.effort_vs_value.map((e) => ({
      ...e,
      insight: {
        'STRONG RETURN': `Good money (${hr(e.revenue_per_booked_hour)}) for effort level ${e.physical_effort}. Keep this on the menu.`,
        'PREMIUM WORK': `Hard on your body (effort ${e.physical_effort}) but it pays — ${hr(e.revenue_per_booked_hour)}. Space these out.`,
        'WATCH CLOSELY': `Effort level ${e.physical_effort} for ${hr(e.revenue_per_booked_hour)}. This may be asking too much from you for what it brings in.`,
        'EASY BUT LOW RETURN': `Easy on you (effort ${e.physical_effort}) but only ${hr(e.revenue_per_booked_hour)}. Fine as a filler — not a foundation.`,
      }[e.category] || '',
    }));

    /* ── Schedule ──────────────────────────────────────────────────────── */
    const schedule_analysis = {
      ...sa,
      potential_consolidation: cons
        ? `${cons.candidate_day} stands out. You’re opening the salon for about ${cons.avg_appointments} appointments, with the first around ${weak.avg_first_start} and the last around ${weak.avg_last_start}. That’s roughly ${Math.round(cons.share_of_revenue * 100)}% of your observed revenue. ${cons.absorbing_days.slice(0, 2).join(' and ')} already carry more appointments each. Could ${cons.candidate_day} become an off day?`
        : `Your days are fairly evenly loaded. The widest gap between two appointment starts was ${sa.widest_spacing_day?.longest_gap_between_starts_hours || 0} hours on ${sa.widest_spacing_day ? util.shortDate(sa.widest_spacing_day.date) : ''}.`,
    };

    /* ── Plan ──────────────────────────────────────────────────────────── */
    const priceMove = wide[0] || null;
    const next_20_day_plan = {
      schedule_move: cons
        ? `Test moving your ${cons.candidate_day} clients into ${cons.absorbing_days.slice(0, 2).join(' and ')} openings.`
        : `Book back-to-back where you can on ${sa.widest_spacing_day ? sa.widest_spacing_day.day_of_week : 'your lightest day'} to close the widest gaps between appointments.`,
      pricing_move: priceMove
        ? `Pick one standard price for ${priceMove.service_name} — your visits ranged ${$(priceMove.min_price)}–${$(priceMove.max_price)}.`
        : (discountExplained.length
          ? `Keep ${discountExplained[0].service_name} at ${$(discountExplained[0].standard_average_price)} for standard visits; your Family Discount visits are intentional and already separate.`
          : 'Hold your prices steady this cycle — they’re consistent across the book.'),
      service_move: top ? `Protect ${top.service_name} availability — ${$(top.gross_revenue)} of observed revenue, your biggest earner.` : '',
      time_goal: cons ? `Aim for one fewer salon day by reclaiming ${cons.candidate_day}.` : '',
      revenue_goal: `Maintain at least 95% of ${$(cm.gross_revenue)} observed gross revenue over the next 20 days${cons ? ' while reclaiming one workday' : ''}.`,
      primary_metric: 'Average ticket',
      primary_metric_target: `${$(cm.average_ticket)} → ${$(Math.ceil((cm.average_ticket + 4) / 5) * 5)} ${cons ? 'with one fewer workday' : 'without adding a workday'}`,
    };

    return {
      generated_by: 'demo_narrative',
      executive_summary,
      chair_metrics: cm,
      daily_performance: calc.daily_performance,
      service_performance,
      pricing_signals,
      effort_vs_value,
      schedule_analysis,
      local_market_signals: buildMarketSignals(marketPlaces, calc),
      next_20_day_plan,
    };
  }

  Combed.narrative = { buildDemoReport, summarizeMarket };
})();
