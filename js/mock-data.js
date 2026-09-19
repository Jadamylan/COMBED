/* Combed — DEMO / MOCK DATA
   ─────────────────────────────────────────────────────────────────────────
   Anonymized SAMPLE data shaped exactly like the real inputs:

     SOURCE A  appointment-book extraction  — what the cursive-reading step
               will return from the 4 photos. Contains date, start time,
               client name, price, service/style wording, discount notes.
               It does NOT contain duration. (The book doesn't have it.)

     SOURCE B  optional stylist service profiles — typical duration, physical
               effort, supply cost. Blank by default. Time-based analysis
               stays locked until the stylist fills these in.

   Client names here are fictional and exist only so the anonymizer has
   something to anonymize. They are stripped before anything is displayed
   or sent to the server.

   Replacing this with real data later = swap `extraction()` for the
   image-extraction API result. Nothing downstream changes.
   ───────────────────────────────────────────────────────────────────────── */
window.Combed = window.Combed || {};

(function () {
  const { CONFIG, util } = Combed;

  /* ── SOURCE B: service profiles (optional; durations blank on purpose) ── */
  const SERVICE_PROFILES = [
    { service_name: 'Shampoo + Flat Iron',       typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null },
    { service_name: 'Natural Style',             typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null },
    { service_name: 'Braids',                    typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null },
    { service_name: 'Twist',                     typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null },
    { service_name: 'Wash + Blow Dry + Trim',    typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null },
    { service_name: 'Wash + Blow Dry',           typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null },
    { service_name: 'Trim',                      typical_duration_minutes: null, physical_effort: null, supply_cost: null, duration_source: null },
  ];

  /* Sample durations a demo viewer can load to see the time-based sections unlock.
     Labeled as estimates. Never applied automatically. */
  const SAMPLE_DURATIONS = {
    'Shampoo + Flat Iron':    { typical_duration_minutes: 90,  physical_effort: 3, supply_cost: 5 },
    'Natural Style':          { typical_duration_minutes: 75,  physical_effort: 3, supply_cost: 6 },
    'Braids':                 { typical_duration_minutes: 180, physical_effort: 5, supply_cost: 8 },
    'Twist':                  { typical_duration_minutes: 120, physical_effort: 4, supply_cost: 6 },
    'Wash + Blow Dry + Trim': { typical_duration_minutes: 60,  physical_effort: 2, supply_cost: 3 },
    'Wash + Blow Dry':        { typical_duration_minutes: 45,  physical_effort: 2, supply_cost: 3 },
    'Trim':                   { typical_duration_minutes: 30,  physical_effort: 1, supply_cost: 1 },
  };

  /* ── Business goals (editable in the UI) ─────────────────────────────── */
  const BUSINESS_GOALS = {
    desired_workdays_per_week: 4,
    desired_weekly_gross: 1600,
    max_weekly_chair_hours: 24,
    monthly_fixed_costs: 900,
    monthly_supply_costs: 250,
  };

  /* ── SOURCE A, compact: [month, day, [[bookTime, service_raw, name, price, opts], …]]
     bookTime is written exactly as it appears in the book ("3", "3:30", "10").
     It is a START TIME. opts: { discount: 'family', low: ['price'|'service'|…], notes }.
     Only dates in CONFIG.OBSERVED_DATES may appear. Sun/Mon pages have no entries. */
  const PAGES = [
    [7, 28, [['10', 'Shampoo / Flat Iron', 'Lisa', 85], ['1', 'Wash, Blow Dry, Trim', 'Gail', 70], ['3', 'Trim', 'Pat', 30]]],
    [7, 29, [['9', 'Natural Style', 'Denise', 95], ['11', 'Shampoo / Flat Iron', 'Marva', 85], ['1', 'Braids', 'Toni', 150], ['4', 'Shampoo / Flat Iron', 'Renee', 65, { discount: 'family' }]]],
    [7, 30, [['9', 'Twist', 'Yvonne', 120], ['12', 'Natural Style', 'Carla', 95], ['2', 'Shampoo / Flat Iron', 'Bev', 90], ['3:30', 'Wash + Blow Dry', 'Joyce', 55]]],
    [7, 31, [['8', 'Braids', 'Sandra', 160], ['11', 'Shampoo + Flat Iron', 'Kim', 85], ['1', 'Natural Style', 'Nadine', 100], ['3', 'Shampoo / Flat Iron', 'Rhonda', 85], ['4:30', 'Trim', 'Trina', 30]]],
    [8, 1,  [['8', 'Natural Style', 'Loretta', 95], ['10', 'Shampoo / Flat Iron', 'Michelle', 95], ['11:30', 'Twist', 'Angie', 120], ['2', 'Natural Style', 'Dee', 95], ['3:30', 'Wash, Blow Dry, Trim', 'Paula', 70], ['5', 'Shampoo / Flat Iron', 'Vickie', 75]]],
    [8, 4,  [['11', 'Shampoo / Flat Iron', 'Lisa', 85], ['3', 'Wash + Blow Dry', 'Tasha', 55]]],
    [8, 5,  [['9', 'Natural Style', 'Denise', 95], ['11', 'Braids', 'Brenda', 150], ['2', 'Shampoo / Flat Iron', 'Marva', 85, { low: ['price'] }], ['4', 'Natural Style', 'Cheryl', 90]]],
    [8, 6,  [['9', 'Shampoo / Flat Iron', 'Bev', 85], ['11', 'Twist', 'Yvonne', 120], ['1:30', 'Natural Style', 'Carla', 95], ['3', 'Trim', 'Jackie', 30], ['4', 'Shampoo / Flat Iron', 'Renee', 65, { discount: 'family' }]]],
    [8, 7,  [['8', 'Natural Style', 'Nadine', 95], ['10', 'Shampoo / Flat Iron', 'Kim', 85], ['12', 'Braids', 'Monique', 150], ['3', 'Wash, Blow Dry, Trim', 'Wanda', 70], ['4:30', 'Shampoo / Flat Iron', 'Rhonda', 85, { low: ['service'] }]]],
    [8, 8,  [['8', 'Shampoo / Flat Iron', 'Michelle', 95], ['9:30', 'Natural Style', 'Loretta', 95], ['11', 'Twist', 'Erica', 120], ['1:30', 'Natural Style', 'Dee', 95], ['3', 'Shampoo / Flat Iron', 'Gloria', 85], ['4:30', 'Wash + Blow Dry', 'Joyce', 55],
             ['5:30', 'Shampoo / Flat Iron', null, null, { low: ['client_name', 'price'], notes: 'name and amount smudged' }]]],
    [8, 18, [['10', 'Shampoo / Flat Iron', 'Lisa', 85], ['1', 'Natural Style', 'Tasha', 95], ['4', 'Trim', 'Pat', 30]]],
    [8, 19, [['9', 'Natural Style', 'Denise', 95], ['11', 'Shampoo / Flat Iron', 'Marva', 85], ['1', 'Braids', 'Toni', 150], ['4', 'Shampoo / Flat Iron', 'Renee', 65, { discount: 'family' }]]],
    [8, 20, [['9', 'Twist', 'Yvonne', 120], ['12', 'Natural Style', 'Carla', 95], ['2', 'Shampoo / Flat Iron', 'Bev', 85], ['3:30', 'Wash, Blow Dry, Trim', 'Angie', 70]]],
    [8, 21, [['8', 'Braids', 'Sandra', 150], ['11', 'Shampoo / Flat Iron', 'Kim', 85], ['1', 'Natural Style', 'Nadine', 95], ['3', 'Shampoo / Flat Iron', 'Rhonda', 85], ['4:30', 'Trim', 'Trina', 30]]],
    [8, 22, [['8', 'Natural Style', 'Loretta', 95], ['10', 'Shampoo / Flat Iron', 'Michelle', 95], ['11:30', 'Twist', 'Erica', 120], ['2', 'Natural Style', 'Dee', 95], ['3:30', 'Wash, Blow Dry, Trim', 'Paula', 70], ['5', 'Shampoo / Flat Iron', 'Vickie', 75]]],
  ];

  function assertObserved(month, day) {
    if (!CONFIG.OBSERVED_DATES.some(([m, d]) => m === month && d === day)) {
      throw new Error(`Mock pages contain a non-observed date: ${month}/${day}`);
    }
  }

  /* SOURCE A — exactly the extraction schema the cursive-reading step returns. */
  function buildMockExtraction() {
    const rows = [];
    PAGES.forEach(([month, day, entries]) => {
      assertObserved(month, day);
      const date = util.isoDate(CONFIG.DEMO_YEAR, month, day);
      entries.forEach(([time, serviceRaw, name, price, opts = {}]) => {
        const low = new Set(opts.low || []);
        rows.push({
          date,
          day_of_week: util.dayOfWeek(date),
          start_time: time,                 // as written; interpreted downstream
          client_name_internal: name,       // stripped by the anonymizer
          client_alias: '',                 // assigned by the anonymizer
          service_raw: serviceRaw,
          services: [],                     // split downstream from service_raw
          price: price ?? null,
          discount_type: opts.discount || null,
          business_notes: opts.discount === 'family' ? ['Family Discount'] : [],
          visible_notes: opts.notes || '',
          confidence: {
            date: 'high',
            start_time: low.has('start_time') ? 'low' : 'high',
            client_name: low.has('client_name') ? 'low' : (name ? 'medium' : 'low'),
            service: low.has('service') ? 'low' : 'medium',
            price: low.has('price') ? 'low' : (price != null ? 'high' : 'low'),
            discount: 'high',
          },
        });
      });
    });
    return rows;
  }

  Combed.MOCK = {
    label: 'Sample data (anonymized demo)',
    extraction: buildMockExtraction,
    serviceProfiles: () => SERVICE_PROFILES.map((s) => ({ ...s })),
    sampleDurations: () => JSON.parse(JSON.stringify(SAMPLE_DURATIONS)),
    goals: () => ({ ...BUSINESS_GOALS }),
    observedDates: () => CONFIG.OBSERVED_DATES.map(([m, d]) => util.isoDate(CONFIG.DEMO_YEAR, m, d)),
  };
})();
