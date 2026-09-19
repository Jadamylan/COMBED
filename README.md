# COMBED

**Know your chair. Work it smarter.**

Combed turns the handwritten appointment book a stylist already uses into clear answers about her schedule, her prices, her services, and her time. It reads photos of the book, combines what it finds with the business knowledge only the stylist has, adds local market context, and produces a plain-language plan for the next 20 days.

Built for longtime independent hairstylists who know hair, not spreadsheets. First test user: an old-school salon in North Highlands, California.

---

## What it does

```
Appointment-book photos (cursive)
        ↓  vision reading, one page at a time
Structured appointments  →  confidence ≥ 85% go straight into the analysis
        ↓                    (the rest are listed under "Review for Later Analysis")
Business calculations (revenue, average ticket, price consistency, service mix, day patterns)
        +  Live local-market signals from Apify (North Highlands salons)
        +  Live AI reasoning
        ↓
YOUR CHAIR CONE  →  Your Next 20 Days
```

The report is one scrolling page:

1. **Your Chair Cone** — appointments, observed gross revenue, average ticket, top booked service, analysis coverage
2. **Here's what your chair is telling you** — a short synopsis grounded in the numbers
3. **What each day brought in** — revenue by working day
4. **Which services brought the most into your chair** — services ranked by observed revenue
5. **Are your prices working as hard as you are?** — price consistency per service, Family Discount visits set aside
6. **What's worth your energy?** — money vs. physical effort (unlocks once the stylist adds typical service times)
7. **Where your chair is working hardest** — when appointments start, by weekday
8. **What's happening around your chair** — local signals, powered by Apify
9. **Your Next 20 Days** — up to four moves and one measurable goal
10. **Review for Later Analysis** — appointments that were not read confidently enough to include

### Honest by design

- Numbers written in the schedule are **start times**, never durations. The book does not record how long a service took, so Combed never shows hours, revenue per hour, or time-based price signals until the stylist supplies typical service times herself.
- Client names are replaced with `Client 01, 02, …` the moment a page is read. Names never reach the report or the server.
- Discounted visits are separated, not judged. Gross revenue is never called profit.
- Every recommendation has a "Why Combed is saying this" disclosure with the supporting numbers.
- If the local-market lookup fails, the report still renders. If the AI step fails, the report renders from the calculated numbers with a rule-based narrative.

---

## Project layout

```
index.html            the whole customer-facing app, one page
css/styles.css        brand system (cream / emerald / lime / magenta; Archivo Black + Work Sans)
js/config.js          demo year, observed dates, status vocabulary, confidence threshold
js/ingest.js          book-time interpretation, service grouping, anonymization, confidence scoring
js/calc.js            business calculations (formulas documented at the top of the file)
js/narrative.js       rule-based narrative used in demo mode and as the AI fallback
js/render.js          renders the report schema; the single render path for demo and live
js/app.js             upload → read → optional review → goals → analyze → report
js/mock-data.js       anonymized sample appointments in the exact extraction schema
js/mock-market.js     fictional local places for offline demo mode
server.js             Express server; serves the page and keeps every secret server-side
lib/extract.js        appointment-book reading (vision) with the cursive interpretation rules
lib/apify.js          Apify Actor call, result normalization, counted market summary
lib/report.js         AI report call, strict JSON handling, numbers-win merge
assets/               hero collage photos (salon-1/2/3.jpg)
```

### API routes

| Route | Purpose |
|---|---|
| `POST /api/extract-book` | Read page photos → structured appointments (with per-page readability and skipped notes) |
| `POST /api/local-market` | Run the configured Apify Actor for North Highlands salons → normalized places + counted summary |
| `POST /api/generate-report` | Send calculated metrics + market data to the reasoning model → Combed report JSON |
| `GET /api/health` | Confirms which keys are configured without revealing them |

---

## Running it

Requires Node 20.12+ (uses the built-in `.env` loader; no dotenv dependency).

```bash
npm install
cp .env.example .env     # add your keys
npm start                # http://localhost:3000
```

If port 3000 is busy: `PORT=3210 npm start`.

### Environment variables

| Variable | Notes |
|---|---|
| `MODEL_API_KEY` | Messages API key for reading pages and generating the report |
| `MODEL_NAME` | Defaults to `claude-sonnet-4-5` |
| `MODEL_API_URL` | Defaults to `https://api.anthropic.com/v1/messages` |
| `APIFY_API_TOKEN` | Apify token, used server-side only |
| `APIFY_ACTOR_ID` | `username~actor-name`; defaults to `compass~crawler-google-places`. Input builder lives in `lib/apify.js` |
| `APIFY_MAX_RESULTS` | Keep small (default 10) for a fast live run |
| `PORT` | Defaults to 3000 |

`.env` is git-ignored. Never commit keys.

### Demo mode

Switch the toggle above **Comb my business** to *Demo* to run the full report offline with the labeled sample data and fictional local places. Demo and live mode share the same rendering code.

### Using real appointment-book photos

1. Drop up to six page photos into the upload box. Accepted: JPG, PNG, WEBP, HEIC/HEIF (iPhone). Every photo is normalized to JPEG in the browser before it is sent anywhere; HEIC is decoded natively where the browser supports it (Safari) and converted on demand elsewhere. A photo that can't be converted is skipped with a clear message and does not block the others.
2. Press **Read my book**. Each spread is read separately; a landscape photo is sent as the full spread plus left/right close-ups so the printed dates stay in view and the cursive stays legible.
3. Entries read at 85%+ confidence are included automatically. Everything else appears under **Review for Later Analysis** and in the optional review table, where a correction promotes the row into the analysis.
4. Press **Comb my business**.

Upload rules (accepted types, size cap, normalized type) live in one place: `CONFIG.UPLOAD` in `js/config.js`.

---

## How Combed calculates

Observed gross revenue is the dollar amounts written next to appointments, added up. Average ticket is revenue divided by appointments with a readable amount. A service's observed range is the lowest and highest amount charged for it; visits marked Family Discount are set aside before a price is called "standard". A day's spread is the time from the first appointment start to the last appointment start.

Only when the stylist supplies typical service times: estimated hours, revenue per estimated hour, target hourly rate (desired weekly gross ÷ preferred weekly chair hours), and a sustainable price signal (target rate × typical hours + supply cost, rounded to $5). Those are shown as estimates and never inferred from the gaps between appointments.

---

## Roadmap

- Compare consecutive 20-day periods (observe → recommend → change → measure → improve). Report snapshots are already stored locally for this.
- Stylist-supplied service duration profiles as a first-class step.
- Broader service vocabulary learned from the stylist's own book.
