/* Combed — AI REASONING LAYER (server-side only)
   One Messages API call → strict JSON → merged with the calculated numbers.

   Division of labour:
     • numbers  come from the browser's calc engine (authoritative, never rewritten)
     • words    come from the model (headline, insights, statuses, plan)
   mergeReport() enforces this so the frontend always renders trustworthy figures. */
'use strict';

// Mirrors js/config.js — keep in sync.
const SERVICE_STATUSES = ['KEEP STRONG', 'STEADY', 'WATCH', 'PRICE CHECK', 'NEEDS MORE DATA'];
const PRICING_STATUSES = ['CONSISTENT', 'SMALL RANGE', 'WIDE RANGE', 'DISCOUNT EXPLAINED', 'NEEDS MORE DATA'];
const TIME_STATUSES = ['KEEP', 'WATCH', 'REVISIT', 'STRONG CANDIDATE FOR A PRICE UPDATE', 'NEEDS MORE DATA'];
const EFFORT_CATEGORIES = ['STRONG RETURN', 'WATCH CLOSELY', 'EASY BUT LOW RETURN', 'PREMIUM WORK'];
const SIGNAL_TYPES = ['review_theme', 'business_hours', 'service_theme', 'market_density', 'customer_language', 'popular_time'];
const CONFIDENCE = ['high', 'medium', 'low'];

const SYSTEM_PROMPT = `You are Combed, a business-intelligence coach for longtime independent hairstylists.
Voice: an intelligent daughter explaining the numbers to her mom. Warm, short sentences, clear, never condescending, no jargon.

You will receive JSON with: appointments (anonymized, from a handwritten appointment book), services (optional stylist profiles), business_goals, calculated_metrics, local_market_data, local_market_summary.
The stylist's goal is SUSTAINABLE income with LESS unnecessary time behind the chair — not more clients, more days, discounts, or longer hours.

WHAT THE BOOK ACTUALLY CONTAINS
The appointment book records: date, appointment START time, client (already aliased), amount charged, service/style wording, and notes such as "Family Discount".
It does NOT record how long any service took. Numbers written in the schedule are start times, never durations.

HARD RULES
1. RETURN ONLY VALID RAW JSON matching the schema below. No markdown, no code fences, no text before or after.
2. Every number you cite must come from calculated_metrics or local_market_summary. Never invent, round creatively, or extrapolate numbers.
3. DURATION GATE. Check calculated_metrics.chair_metrics.duration_available.
   • If false: NEVER mention hours, revenue per hour, time spent, utilization, "takes too long", or time saved. Do not treat gaps between appointment starts as service time or idle time. Talk about appointments, revenue, average ticket, price ranges, discounts, service mix, which days were strongest/lightest, and how spread out a day's appointments were.
   • If true: you may use the per-hour figures in calculated_metrics, and must call them estimates based on the stylist's typical service times.
4. PRICING. Talk about price consistency: observed range, average observed price, standard price with Family Discount visits set aside. Never say a discounted appointment was priced wrong — discounts are intentional. Only when duration_available is true may you also discuss the per-hour rate, target, sustainable_price_signal, and a small test increase.
5. Never call gross revenue "profit". Never call the period a month — say "20 observed calendar days" or "the appointment-book dates provided".
6. Do not use client names. Aliases only, and only if needed.
7. local_market_signals: 2–4 items, ONLY if local_market_data is non-empty. evidence_count must equal a count present in local_market_summary (e.g. review_theme_mentions[].mentions, open_past_7pm_weekday, open_by_day) or be null. Use hedged language: "appears", "may indicate", "worth testing". Never name a competitor. Never infer competitor pricing.
8. Statuses/categories must use the allowed values exactly. Keep calculated statuses unless you have a clear data reason to change them. effort_vs_value must be an empty array when duration_available is false.
9. Prefer 3 plan moves; give a 4th (time_goal) only when the schedule data supports fewer days.
   BE CONCISE: summary ≤ 4 sentences; every other string ≤ 30 words. The whole response must stay compact.
10. Base the executive_summary on what the numbers actually show. Acknowledge uncertainty (flagged entries, entries without a readable amount) briefly if calculated_metrics reports any. If the data does not support a conclusion, do not draw it.

SCHEMA (fill every key; arrays must keep the same service_name keys as calculated_metrics):
{
  "executive_summary": { "headline": "", "summary": "3-4 sentences", "primary_opportunity": "" },
  "service_performance": [ { "service_name": "", "status": "one of ${SERVICE_STATUSES.join(' | ')}", "insight": "" } ],
  "pricing_signals": [ { "service_name": "", "status": "one of ${PRICING_STATUSES.join(' | ')}", "time_status": "one of ${TIME_STATUSES.join(' | ')} (NEEDS MORE DATA when duration_available is false)", "explanation": "" } ],
  "effort_vs_value": [ { "service_name": "", "category": "one of ${EFFORT_CATEGORIES.join(' | ')}", "insight": "" } ],
  "schedule_analysis": { "potential_consolidation": "2-3 sentences about appointment counts and how spread out the lightest day is; end with a question like 'Could Tuesday become an off day?' only if supported" },
  "local_market_signals": [ { "title": "", "signal_type": "one of ${SIGNAL_TYPES.join(' | ')}", "observation": "", "business_relevance": "", "recommended_test": "", "confidence": "high|medium|low", "evidence_count": null } ],
  "next_20_day_plan": { "schedule_move": "", "pricing_move": "", "service_move": "", "time_goal": "", "revenue_goal": "", "primary_metric": "", "primary_metric_target": "" }
}`;

function stripFences(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = t.indexOf('{'); const last = t.lastIndexOf('}');
  if (first > 0 || (last >= 0 && last < t.length - 1)) t = t.slice(first, last + 1);
  return t;
}

async function callModel({ apiKey, apiUrl, model, payload, timeoutMs = 150000 }) {
  if (!apiKey) throw new Error('MODEL_API_KEY is not configured');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 9000,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Here is the stylist's data. Return only the JSON object.\n\n${JSON.stringify(payload)}` }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Model API responded ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = Array.isArray(data.content) ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('') : (data.output_text || '');
    if (data.stop_reason === 'max_tokens') console.warn('[generate-report] model output hit max_tokens — response is truncated');
    return text;
  } finally { clearTimeout(t); }
}

/* Merge: calculated numbers win; model supplies words + validated labels. */
function mergeReport(calc, ai) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const byName = (arr) => Object.fromEntries((Array.isArray(arr) ? arr : []).filter((x) => x && x.service_name).map((x) => [x.service_name.toLowerCase(), x]));

  const aiSvc = byName(ai.service_performance);
  const aiPrice = byName(ai.pricing_signals);
  const aiEffort = byName(ai.effort_vs_value);

  const summary = ai.executive_summary || {};
  const plan = ai.next_20_day_plan || {};

  const signals = (Array.isArray(ai.local_market_signals) ? ai.local_market_signals : []).slice(0, 4).map((s) => ({
    title: str(s.title),
    signal_type: oneOf(s.signal_type, SIGNAL_TYPES, 'review_theme'),
    observation: str(s.observation),
    business_relevance: str(s.business_relevance),
    recommended_test: str(s.recommended_test),
    confidence: oneOf(s.confidence, CONFIDENCE, 'low'),
    evidence_count: Number.isInteger(s.evidence_count) ? s.evidence_count : null,
  })).filter((s) => s.title && s.observation);

  return {
    generated_by: 'ai',
    executive_summary: {
      headline: str(summary.headline),
      summary: str(summary.summary),
      primary_opportunity: str(summary.primary_opportunity),
    },
    chair_metrics: calc.chair_metrics,
    daily_performance: calc.daily_performance,
    service_performance: calc.service_performance.map((s) => {
      const a = aiSvc[s.service_name.toLowerCase()] || {};
      return { ...s, status: s.status === 'NEEDS MORE DATA' ? s.status : oneOf(a.status, SERVICE_STATUSES, s.status), insight: str(a.insight) };
    }),
    pricing_signals: calc.pricing_signals.map((p) => {
      const a = aiPrice[p.service_name.toLowerCase()] || {};
      const timed = Boolean(calc.chair_metrics.duration_available);
      return {
        ...p,
        status: p.status === 'NEEDS MORE DATA' ? p.status : oneOf(a.status, PRICING_STATUSES, p.status),
        // Time-based status can only exist when durations exist — the calc value is authoritative otherwise.
        time_status: timed ? oneOf(a.time_status, TIME_STATUSES, p.time_status) : 'NEEDS MORE DATA',
        explanation: str(a.explanation) || p.explanation,
      };
    }),
    // Duration gate enforced server-side too: no effort analysis without stylist durations.
    effort_vs_value: calc.chair_metrics.duration_available ? calc.effort_vs_value.map((e) => {
      const a = aiEffort[e.service_name.toLowerCase()] || {};
      return { ...e, category: oneOf(a.category, EFFORT_CATEGORIES, e.category), insight: str(a.insight) };
    }) : [],
    schedule_analysis: { ...calc.schedule_analysis, potential_consolidation: str((ai.schedule_analysis || {}).potential_consolidation) },
    local_market_signals: signals,
    next_20_day_plan: {
      schedule_move: str(plan.schedule_move),
      pricing_move: str(plan.pricing_move),
      service_move: str(plan.service_move),
      time_goal: str(plan.time_goal),
      revenue_goal: str(plan.revenue_goal),
      primary_metric: str(plan.primary_metric),
      primary_metric_target: str(plan.primary_metric_target),
    },
  };
}

function validateCalculated(calc) {
  return calc && calc.chair_metrics && Array.isArray(calc.daily_performance) && Array.isArray(calc.service_performance)
    && Array.isArray(calc.pricing_signals) && Array.isArray(calc.effort_vs_value) && calc.schedule_analysis;
}

async function generateReport({ apiKey, apiUrl, model, payload }) {
  if (!validateCalculated(payload.calculated_metrics)) throw new Error('calculated_metrics is missing or malformed');
  // Belt and braces: real names must never reach the model, even if a future client forgets to strip them.
  (payload.appointments || []).forEach((a) => { delete a.client_name_internal; });

  // Trim what the model sees: it needs numbers + context, not every raw row.
  const slim = {
    location: payload.location,
    observed_calendar_days: payload.observed_calendar_days,
    business_goals: payload.business_goals,
    services: payload.services,
    // Aliases only. No names, no durations unless the stylist supplied them.
    appointments_sample: (payload.appointments || []).slice(0, 90).map((a) => ({
      date: a.date, day_of_week: a.day_of_week, start_time: a.start_time, client_alias: a.client_alias,
      service_raw: a.service_raw, service_name: a.service_name, price: a.price, discount_type: a.discount_type,
      flags: a.flags, typical_duration_minutes: a.typical_duration_minutes ?? null,
    })),
    calculated_metrics: payload.calculated_metrics,
    local_market_summary: payload.local_market_summary,
    local_market_data: (payload.local_market_data || []).map((p) => ({ category: p.category, rating: p.rating, review_count: p.review_count, hours: p.hours, reviews: p.reviews })),
  };

  const raw = await callModel({ apiKey, apiUrl, model, payload: slim });
  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err) {
    const e = new Error('Combed could not format the report correctly. Please try the analysis again.');
    e.code = 'MALFORMED_JSON';
    e.raw = raw;
    throw e;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.executive_summary || !parsed.next_20_day_plan) {
    const e = new Error('Combed could not format the report correctly. Please try the analysis again.');
    e.code = 'SCHEMA_MISMATCH';
    throw e;
  }
  return mergeReport(payload.calculated_metrics, parsed);
}

module.exports = { generateReport, mergeReport, stripFences, SYSTEM_PROMPT };
