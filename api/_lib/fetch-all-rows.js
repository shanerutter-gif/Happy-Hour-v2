// Shared paged PostgREST fetch for the SEO edge functions.
//
// Replaces the copies of fetchAllRows that used to live in api/spots.js,
// api/spots-directory.js, api/sitemap-venues.js and api/sitemap-cities.js.
// The old helper silently `break`ed out of its paging loop on any failed
// page fetch and returned the partial result as if complete. On /spots/<slug>
// that meant venues on a missing page resolved as "not found" and got a
// styled HTTP 404 — for real users as well as crawlers — whenever a Supabase
// page fetch flaked under load (the Oct 2026 impressions cliff; see
// seo-cliff-diagnosis-2026-10-17.md).
//
// This version fails loud instead:
//   - every page requests `Prefer: count=exact` and the collected row count
//     is verified against the Content-Range total;
//   - each page is retried (bounded, small backoff) on HTTP errors, network
//     errors, and unparseable/non-array bodies;
//   - if the complete result still cannot be assembled it throws
//     IncompleteFetchError, and callers answer 503 (retryable) rather than
//     resolving/rendering against partial data.
//
// Fetch ORDER is part of the contract: callers pass their query URL through
// untouched (no order= is added here or there) because canonical slug
// assignment in _lib/seo.js is fetch-order-dependent ("first wins" for
// duplicate names). Do not add sorting to "help" — it would reshuffle
// canonical slugs site-wide.

export class IncompleteFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IncompleteFetchError';
  }
}

const PAGE_SIZE = 1000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 600]; // before attempts 2 and 3

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// "0-999/1922" or "*/1922" -> 1922. Anything else -> null (total unknown).
export function parseContentRangeTotal(header) {
  if (!header) return null;
  const m = /\/(\d+)\s*$/.exec(String(header));
  return m ? Number(m[1]) : null;
}

async function fetchPage(url, headers, from, fetchImpl) {
  const to = from + PAGE_SIZE - 1;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const res = await fetchImpl(url, {
        headers: {
          ...headers,
          Range: `${from}-${to}`,
          'Range-Unit': 'items',
          Prefer: 'count=exact',
        },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) {
        lastErr = new Error('response body was not a JSON array');
        continue;
      }
      const total = parseContentRangeTotal(
        res.headers && typeof res.headers.get === 'function'
          ? res.headers.get('content-range')
          : null
      );
      return { rows, total };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new IncompleteFetchError(
    `paged fetch failed for range ${from}-${to} after ${MAX_ATTEMPTS} attempts` +
    (lastErr ? `: ${lastErr.message}` : '')
  );
}

// Fetch ALL rows for a PostgREST query, paging past the 1,000-row cap via
// Range headers. Throws IncompleteFetchError unless the complete result set
// was assembled (verified against the count=exact total when PostgREST
// reports one; falls back to short-page termination when it does not).
export async function fetchAllRows(url, headers, fetchImpl = fetch) {
  const out = [];
  let expectedTotal = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { rows, total } = await fetchPage(url, headers, from, fetchImpl);
    if (total !== null) expectedTotal = total;
    out.push(...rows);
    if (expectedTotal !== null) {
      if (out.length >= expectedTotal) break;
      // Count says more rows exist but this page came back empty — the
      // completeness check below fails loud instead of trusting it.
      if (rows.length === 0) break;
    } else if (rows.length < PAGE_SIZE) {
      break;
    }
  }
  if (expectedTotal !== null && out.length !== expectedTotal) {
    throw new IncompleteFetchError(
      `paged fetch incomplete: collected ${out.length} of ${expectedTotal} rows`
    );
  }
  return out;
}

// The fail-loud response for "the index could not be assembled right now":
// 503 (temporary — crawlers retry instead of dropping pages, unlike 404),
// a short Retry-After, and no-store so the failure itself is never cached.
export function serviceUnavailableResponse() {
  return new Response('Service temporarily unavailable — please retry shortly.', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '30',
    },
  });
}
