/* Combed — SAMPLE local-market data for offline DEMO MODE only.
   These are fictional businesses. In live mode this array is replaced by the
   normalized Apify result returned from POST /api/local-market. */
window.Combed = window.Combed || {};

Combed.MOCK_MARKET = {
  label: 'Sample local data (demo — not from Apify)',
  places: [
    {
      name: 'Sample Salon A', category: 'Hair salon', address: 'Watt Ave, North Highlands, CA',
      rating: 4.7, review_count: 112,
      hours: { Tuesday: '9 AM–7 PM', Wednesday: '9 AM–7 PM', Thursday: '9 AM–7 PM', Friday: '9 AM–7 PM', Saturday: '8 AM–5 PM' },
      website: '', popular_times: null,
      reviews: ['Best silk press I have had in years, my natural hair felt so healthy.', 'She stays open late so I can come after work.', 'Great with natural hair and gentle on my edges.'],
    },
    {
      name: 'Sample Salon B', category: 'Beauty salon', address: 'Elkhorn Blvd, North Highlands, CA',
      rating: 4.4, review_count: 58,
      hours: { Monday: '10 AM–6 PM', Tuesday: '10 AM–6 PM', Wednesday: '10 AM–6 PM', Thursday: '10 AM–8 PM', Friday: '10 AM–8 PM', Saturday: '9 AM–6 PM' },
      website: '', popular_times: null,
      reviews: ['My silk press lasted two weeks.', 'Relaxer touch-up was quick and my scalp did not burn.'],
    },
    {
      name: 'Sample Salon C', category: 'Hair salon', address: 'Roseville Rd, North Highlands, CA',
      rating: 4.9, review_count: 203,
      hours: { Wednesday: '9 AM–6 PM', Thursday: '9 AM–6 PM', Friday: '9 AM–6 PM', Saturday: '8 AM–4 PM', Sunday: '10 AM–3 PM' },
      website: '', popular_times: null,
      reviews: ['Booked a silk press and trim, very professional.', 'Love that they take natural hair seriously.', 'Sunday appointments are a lifesaver.'],
    },
    {
      name: 'Sample Salon D', category: 'Hair salon', address: 'Antelope Rd, North Highlands, CA',
      rating: 4.2, review_count: 34,
      hours: { Tuesday: '10 AM–6 PM', Wednesday: '10 AM–6 PM', Thursday: '10 AM–6 PM', Friday: '10 AM–6 PM', Saturday: '10 AM–4 PM' },
      website: '', popular_times: null,
      reviews: ['Color came out exactly how I wanted.', 'A little pricey but worth it for the color work.'],
    },
    {
      name: 'Sample Salon E', category: 'Braiding salon', address: 'Watt Ave, North Highlands, CA',
      rating: 4.6, review_count: 89,
      hours: { Monday: '9 AM–7 PM', Tuesday: '9 AM–7 PM', Wednesday: '9 AM–7 PM', Thursday: '9 AM–7 PM', Friday: '9 AM–7 PM', Saturday: '9 AM–7 PM' },
      website: '', popular_times: null,
      reviews: ['Knotless braids were neat and not too tight.', 'Twists looked great, took about three hours.'],
    },
    {
      name: 'Sample Salon F', category: 'Hair salon', address: 'Madison Ave, North Highlands, CA',
      rating: 4.5, review_count: 71,
      hours: { Tuesday: '9 AM–5 PM', Wednesday: '9 AM–5 PM', Thursday: '9 AM–7 PM', Friday: '9 AM–7 PM', Saturday: '8 AM–3 PM' },
      website: '', popular_times: null,
      reviews: ['Silk press and healthy hair trim, will be back.', 'Evening appointments available which helps a lot.'],
    },
    {
      name: 'Sample Salon G', category: 'Beauty salon', address: 'Elkhorn Blvd, North Highlands, CA',
      rating: 4.0, review_count: 22,
      hours: { Wednesday: '10 AM–5 PM', Thursday: '10 AM–5 PM', Friday: '10 AM–5 PM', Saturday: '9 AM–4 PM' },
      website: '', popular_times: null,
      reviews: ['Nice shampoo and set for my mother.'],
    },
    {
      name: 'Sample Salon H', category: 'Hair salon', address: 'Don Julio Blvd, North Highlands, CA',
      rating: 4.8, review_count: 140,
      hours: { Tuesday: '9 AM–6 PM', Wednesday: '9 AM–6 PM', Thursday: '9 AM–6 PM', Friday: '9 AM–6 PM', Saturday: '8 AM–5 PM' },
      website: '', popular_times: null,
      reviews: ['She specializes in natural hair and it shows.', 'Silk press was bouncy and lasted.', 'Locs retwist was clean.'],
    },
  ],
};
