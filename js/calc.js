/* Combed — BUSINESS CALCULATIONS
   Pure functions. Input: reviewed appointments, service profiles, goals, observed dates.
   Output: the numeric half of the Combed Analysis Response Schema.
   Narrative fields are left blank for the reasoning layer (AI or demo narrative).

   TWO TIERS
   ─────────────────────────────────────────────────────────────────────────
   TIER 1 — supported by the appointment book alone (always computed)
     gross_revenue        = Σ price                     (countable appts only)
     average_ticket       = gross_revenue / countable appointments
     average_price (svc)  = Σ price / count             per service
     standard_average     = same, excluding discounted appointments
     price range          = min..max observed price     per service
     price spread         = (max − min) / standard_average   (unexplained if discounts removed)
     revenue share        = service gross / total gross
     appointment spacing  = hours between first and last START of a day (NOT duration)
     start clustering     = count of appointment STARTS per weekday × period

   TIER 2 — only when the stylist has supplied a typical duration for every observed service
     booked_hours             = Σ typical_duration_minutes / 60
     revenue_per_booked_hour  = gross_revenue / booked_hours
     target_hourly_rate       = desired_weekly_gross / max_weekly_chair_hours
     sustainable_price_signal = target_hourly_rate × (duration/60) + supply_cost, rounded to $5
     suggested_test_increase  = $5 if gap < $15, $10 if gap < $35, else $15  (planning signal only)
   When Tier 2 is unavailable, those fields are null — never estimated from spacing.
   ───────────────────────────────────────────────────────────────────────── */
window.Combed = window.Combed || {};

(function () {
  const { CONFIG, util } = Combed;
  const { isCountable, durationAvailability } = Combed.ingest;
  const r1 = (n) => util.round(n, 1);
  const r2 = (n) => util.round(n, 2);
  const roundTo5 = (n) => Math.round(n / 5) * 5;
  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

  /* Price consistency for one service (Tier 1). */
  function pricingStatus({ count, spread, discountedCount, standardSpread }) {
    if (count < 2) return 'NEEDS MORE DATA';
    if (spread === 0) return 'CONSISTENT';
    if (discountedCount > 0 && standardSpread <= 0.1) return 'DISCOUNT EXPLAINED';
    if (standardSpread <= 0.12) return 'SMALL RANGE';
    return 'WIDE RANGE';
  }

  function serviceStatus({ count, share, rank, status }) {
    if (count < 2) return 'NEEDS MORE DATA';
    if (status === 'WIDE RANGE') return 'PRICE CHECK';
    if (rank < 3 && share >= 0.15) return 'KEEP STRONG';
    if (count >= 3) return 'STEADY';
    return 'WATCH';
  }

  function timeStatus(rate, target) {
    if (target == null || rate == null) return 'NEEDS MORE DATA';
    if (rate >= target) return 'KEEP';
    if (rate >= target * 0.9) return 'WATCH';
    if (rate >= target * 0.75) return 'REVISIT';
    return 'STRONG CANDIDATE FOR A PRICE UPDATE';
  }

  function effortCategory(rate, effort, threshold) {
    const high = rate >= threshold;
    if (high && effort <= 3) return 'STRONG RETURN';
    if (high && effort >= 4) return 'PREMIUM WORK';
    if (!high && effort >= 3) return 'WATCH CLOSELY';
    return 'EASY BUT LOW RETURN';
  }

  function computeMetrics({ appointments, serviceProfiles, goals, observedDates }) {
    const countable = appointments.filter(isCountable);
    const uncounted = appointments.filter((a) => !isCountable(a));
    const timed = durationAvailability(appointments);
    const durationOK = timed.available;

    const targetHourly = goals.desired_weekly_gross > 0 && goals.max_weekly_chair_hours > 0
      ? goals.desired_weekly_gross / goals.max_weekly_chair_hours : null;

    /* ── Chair metrics ─────────────────────────────────────────────────── */
    const gross = countable.reduce((s, a) => s + a.price, 0);
    const workingDates = [...new Set(appointments.map((a) => a.date))].sort();
    const discounted = countable.filter((a) => a.discount_type);
    const bookedMin = durationOK ? countable.reduce((s, a) => s + a.typical_duration_minutes, 0) : null;

    const svcCounts = {};
    countable.forEach((a) => { const k = a.service_name || 'Unnamed service'; svcCounts[k] = (svcCounts[k] || 0) + 1; });
    const topService = Object.entries(svcCounts).sort((a, b) => b[1] - a[1])[0] || null;

    const chair_metrics = {
      appointments: countable.length,
      working_days: workingDates.length,
      gross_revenue: gross,
      average_ticket: countable.length ? r2(gross / countable.length) : 0,
      top_service: topService ? topService[0] : null,
      top_service_count: topService ? topService[1] : 0,
      booked_hours: durationOK ? r1(bookedMin / 60) : null,
      revenue_per_booked_hour: durationOK && bookedMin ? r2(gross / (bookedMin / 60)) : null,
      // extras (additive, never renamed)
      observed_calendar_days: observedDates.length,
      entries_in_book: appointments.length,
      entries_without_price: uncounted.length,
      entries_flagged: appointments.filter((a) => a.needs_review).length,
      discounted_appointments: discounted.length,
      discounted_revenue: discounted.reduce((s, a) => s + a.price, 0),
      average_appointments_per_workday: workingDates.length ? r1(countable.length / workingDates.length) : 0,
      duration_available: durationOK,
      duration_missing_services: timed.missing_services,
      target_hourly_rate: durationOK && targetHourly ? r2(targetHourly) : null,
      period_start: observedDates[0] || null,
      period_end: observedDates[observedDates.length - 1] || null,
    };

    /* ── Daily performance ─────────────────────────────────────────────── */
    const daily_performance = workingDates.map((date) => {
      const day = countable.filter((a) => a.date === date && a.start_time)
        .map((a) => ({ ...a, start: util.parseTime(a.start_time) })).sort((x, y) => x.start - y.start);
      const all = countable.filter((a) => a.date === date);
      const rev = all.reduce((s, a) => s + a.price, 0);
      const starts = day.map((a) => a.start);
      const gaps = []; for (let i = 1; i < starts.length; i++) gaps.push((starts[i] - starts[i - 1]) / 60);
      const bh = durationOK ? all.reduce((s, a) => s + a.typical_duration_minutes, 0) / 60 : null;
      return {
        date,
        day_of_week: util.dayOfWeek(date),
        appointments: all.length,
        gross_revenue: rev,
        average_price: all.length ? r2(rev / all.length) : 0,
        first_start: starts.length ? util.fmtTime(starts[0]) : null,
        last_start: starts.length ? util.fmtTime(starts[starts.length - 1]) : null,
        start_spread_hours: starts.length > 1 ? r1((starts[starts.length - 1] - starts[0]) / 60) : 0,
        avg_gap_between_starts_hours: gaps.length ? r1(mean(gaps)) : null,
        longest_gap_between_starts_hours: gaps.length ? r1(Math.max(...gaps)) : null,
        // Tier 2 (schema keys kept; null when unavailable)
        booked_hours: durationOK ? r1(bh) : null,
        work_window_hours: null,
        idle_hours: null,
        revenue_per_booked_hour: durationOK && bh ? r2(rev / bh) : null,
      };
    });

    /* ── Service performance (Tier 1 + optional Tier 2) ─────────────────── */
    const groups = {};
    countable.forEach((a) => { const k = a.service_name || 'Unnamed service'; (groups[k] = groups[k] || []).push(a); });
    const profileByName = new Map(serviceProfiles.map((p) => [Combed.ingest.normalizeServiceName(p.service_name) || p.service_name, p]));

    let service_performance = Object.entries(groups).map(([name, list]) => {
      const rev = list.reduce((s, a) => s + a.price, 0);
      const prices = list.map((a) => a.price);
      const std = list.filter((a) => !a.discount_type);
      const stdPrices = std.map((a) => a.price);
      const avg = mean(prices);
      const stdAvg = stdPrices.length ? mean(stdPrices) : avg;
      const spread = avg ? (Math.max(...prices) - Math.min(...prices)) / avg : 0;
      const stdSpread = stdAvg && stdPrices.length ? (Math.max(...stdPrices) - Math.min(...stdPrices)) / stdAvg : 0;
      const discountedCount = list.length - std.length;
      const durMin = durationOK ? list.reduce((s, a) => s + a.typical_duration_minutes, 0) : null;
      const profile = profileByName.get(name);
      return {
        service_name: name,
        appointment_count: list.length,
        gross_revenue: rev,
        revenue_share: gross ? r2(rev / gross) : 0,
        average_price: r2(avg),
        standard_average_price: r2(stdAvg),
        min_price: Math.min(...prices),
        max_price: Math.max(...prices),
        standard_min_price: stdPrices.length ? Math.min(...stdPrices) : null,
        standard_max_price: stdPrices.length ? Math.max(...stdPrices) : null,
        discounted_count: discountedCount,
        price_status: pricingStatus({ count: list.length, spread, discountedCount, standardSpread: stdSpread }),
        average_ticket: r2(avg),
        // Tier 2
        booked_hours: durationOK ? r1(durMin / 60) : null,
        revenue_per_booked_hour: durationOK && durMin ? r2(rev / (durMin / 60)) : null,
        average_duration_minutes: durationOK ? Math.round(durMin / list.length) : null,
        average_physical_effort: profile && typeof profile.physical_effort === 'number' ? profile.physical_effort : null,
        status: '',
        insight: '',
      };
    }).sort((a, b) => b.gross_revenue - a.gross_revenue);
    service_performance = service_performance.map((s, i) => ({ ...s, status: serviceStatus({ count: s.appointment_count, share: s.revenue_share, rank: i, status: s.price_status }) }));

    /* ── Pricing signals (price consistency + optional time-based signal) ─ */
    const pricing_signals = service_performance.map((s) => {
      const profile = profileByName.get(s.service_name);
      const dur = durationOK && profile ? profile.typical_duration_minutes : null;
      const rate = dur ? s.standard_average_price / (dur / 60) : null;
      const signal = dur && targetHourly ? roundTo5(targetHourly * (dur / 60) + (profile.supply_cost || 0)) : null;
      const gap = signal != null ? signal - s.standard_average_price : 0;
      return {
        service_name: s.service_name,
        appointment_count: s.appointment_count,
        average_price: s.average_price,
        standard_average_price: s.standard_average_price,
        min_price: s.min_price,
        max_price: s.max_price,
        standard_min_price: s.standard_min_price,
        standard_max_price: s.standard_max_price,
        discounted_count: s.discounted_count,
        status: s.price_status,
        explanation: '',
        // Tier 2 (null until durations exist)
        current_price: s.standard_average_price,
        duration_minutes: dur,
        current_hourly_rate: rate != null ? r2(rate) : null,
        target_hourly_rate: dur && targetHourly ? r2(targetHourly) : null,
        sustainable_price_signal: signal,
        suggested_test_increase: signal == null ? null : gap <= 0 ? 0 : gap < 15 ? 5 : gap < 35 ? 10 : 15,
        time_status: dur ? timeStatus(rate, targetHourly) : 'NEEDS MORE DATA',
        supply_cost: profile?.supply_cost ?? null,
      };
    });

    /* ── Effort vs value (Tier 2 only) ─────────────────────────────────── */
    const threshold = chair_metrics.revenue_per_booked_hour || 0;
    const effort_vs_value = durationOK
      ? service_performance.filter((s) => typeof s.average_physical_effort === 'number' && s.revenue_per_booked_hour != null).map((s) => ({
        service_name: s.service_name,
        revenue_per_booked_hour: s.revenue_per_booked_hour,
        physical_effort: s.average_physical_effort,
        category: effortCategory(s.revenue_per_booked_hour, s.average_physical_effort, threshold),
        insight: '',
        gross_revenue: s.gross_revenue,
        appointment_count: s.appointment_count,
      }))
      : [];

    /* ── Schedule analysis (starts, spacing, clustering — no durations) ── */
    const byWeekday = {};
    daily_performance.forEach((d) => { (byWeekday[d.day_of_week] = byWeekday[d.day_of_week] || []).push(d); });
    const weekday_profile = CONFIG.WEEKDAYS.filter((w) => byWeekday[w]).map((w) => {
      const days = byWeekday[w];
      const firsts = days.map((d) => util.parseTime(d.first_start)).filter((v) => v != null);
      const lasts = days.map((d) => util.parseTime(d.last_start)).filter((v) => v != null);
      const appts = mean(days.map((d) => d.appointments));
      const spread = mean(days.map((d) => d.start_spread_hours));
      return {
        day_of_week: w,
        occurrences: days.length,
        avg_appointments: r1(appts),
        avg_gross_revenue: Math.round(mean(days.map((d) => d.gross_revenue))),
        avg_first_start: firsts.length ? util.fmtTime(Math.round(mean(firsts) / 15) * 15) : null,
        avg_last_start: lasts.length ? util.fmtTime(Math.round(mean(lasts) / 15) * 15) : null,
        avg_start_spread_hours: r1(spread),
        avg_gap_between_starts_hours: r1(mean(days.map((d) => d.avg_gap_between_starts_hours).filter((v) => v != null))),
        // spacing per appointment: hours of spread per appointment — higher = more spread out
        spacing_score: appts ? r2(spread / appts) : 0,
        avg_booked_hours: durationOK ? r1(mean(days.map((d) => d.booked_hours))) : null,
      };
    });

    const strongest = [...weekday_profile].sort((a, b) => b.avg_gross_revenue - a.avg_gross_revenue)[0];
    const weakest = [...weekday_profile].sort((a, b) => a.avg_gross_revenue - b.avg_gross_revenue)[0];
    const mostSpread = [...weekday_profile].filter((w) => w.avg_appointments >= 2).sort((a, b) => b.spacing_score - a.spacing_score)[0] || weakest;

    // Consolidation candidate: lightest weekday with ≤3 appointments on average and other days clearly denser.
    let consolidation = null;
    if (weakest && weakest.avg_appointments <= 3) {
      const others = weekday_profile.filter((w) => w.day_of_week !== weakest.day_of_week);
      const denser = others.filter((w) => w.avg_appointments >= weakest.avg_appointments + 1);
      if (denser.length) {
        consolidation = {
          candidate_day: weakest.day_of_week,
          avg_appointments: weakest.avg_appointments,
          avg_revenue: weakest.avg_gross_revenue,
          avg_start_spread_hours: weakest.avg_start_spread_hours,
          absorbing_days: denser.map((w) => w.day_of_week),
          share_of_revenue: gross ? r2((weakest.avg_gross_revenue * weakest.occurrences) / gross) : 0,
        };
      }
    }

    // Start clustering grid: weekday × period → appointment STARTS (averaged per occurrence).
    const start_grid = {};
    countable.filter((a) => a.start_time).forEach((a) => {
      const min = util.parseTime(a.start_time);
      const p = CONFIG.PERIODS.find((per) => min >= per.start * 60 && min < per.end * 60);
      if (!p) return;
      start_grid[a.day_of_week] = start_grid[a.day_of_week] || Object.fromEntries(CONFIG.PERIODS.map((x) => [x.key, 0]));
      start_grid[a.day_of_week][p.key] += 1;
    });
    Object.keys(start_grid).forEach((w) => {
      const occ = byWeekday[w]?.length || 1;
      Object.keys(start_grid[w]).forEach((k) => { start_grid[w][k] = r1(start_grid[w][k] / occ); });
    });

    const schedule_analysis = {
      strongest_day: strongest?.day_of_week || '',
      weakest_day: weakest?.day_of_week || '',
      most_fragmented_day: mostSpread?.day_of_week || '',
      potential_consolidation: '',
      estimated_time_reclaimable_hours: null, // requires durations; never derived from spacing
      weekday_profile,
      consolidation_candidate: consolidation,
      start_grid,
      widest_spacing_day: daily_performance.reduce((best, d) => ((d.longest_gap_between_starts_hours || 0) > (best?.longest_gap_between_starts_hours || 0) ? d : best), null),
    };

    return {
      chair_metrics,
      daily_performance,
      service_performance,
      pricing_signals,
      effort_vs_value,
      schedule_analysis,
      uncounted_entries: uncounted.map((a) => ({ date: a.date, start_time: a.start_time || a.start_time_raw, client_alias: a.client_alias, flags: a.flags })),
    };
  }

  Combed.calc = { computeMetrics };
})();
