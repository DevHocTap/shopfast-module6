// k6 load test for the cached catalog (SRS F04 + performance table).
//
//   docker run --rm -i -e BASE_URL=https://shopfast.hmicodev.io.vn grafana/k6 run - < tests/load/catalog.js
//
// Thresholds encode the SRS targets: cached lookups p95 < 50 ms. The cache hit ratio (≥ 80%) is
// read afterwards from GET /api/admin/cache/stats (reset it before the run with DELETE).
// Run it from inside the AWS region (EC2/CloudShell): from Vietnam, network latency to Sydney
// alone exceeds 50 ms (docs/07 ADR-12). One source IP hits the per-IP limit (120 req/min), so set
// RATE_LIMIT_ENABLED=false for the measurement window, or keep VUs × rate under the limit.
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const serverTime = new Trend('server_time_ms', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 50),
      duration: __ENV.DURATION || '1m',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:detail}': ['p(95)<50'],
    'http_req_duration{endpoint:list}': ['p(95)<50'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const categories = http.get(`${BASE_URL}/api/categories`).json();
  const ids = [];
  for (let page = 1; page <= 4; page++) {
    const res = http.get(`${BASE_URL}/api/products?limit=50&page=${page}`).json();
    for (const item of res.items) ids.push(item.id);
  }
  return { ids, categoryIds: categories.map((c) => c.id) };
}

/** Popularity is skewed in real shops: a few products get most of the traffic (Zipf-like). */
function popular(items) {
  const index = Math.floor(items.length * Math.pow(Math.random(), 3));
  return items[index];
}

export default function (data) {
  let res;
  if (Math.random() < 0.7) {
    res = http.get(`${BASE_URL}/api/products/${popular(data.ids)}`, {
      tags: { endpoint: 'detail' },
    });
  } else {
    const category = data.categoryIds[Math.floor(Math.random() * data.categoryIds.length)];
    const sort = ['newest', 'price_asc', 'price_desc'][Math.floor(Math.random() * 3)];
    const page = 1 + Math.floor(Math.pow(Math.random(), 2) * 3);
    res = http.get(`${BASE_URL}/api/products?categoryId=${category}&sort=${sort}&page=${page}`, {
      tags: { endpoint: 'list' },
    });
  }
  check(res, { 'status 200': (r) => r.status === 200 });
  const timing = /app;dur=([\d.]+)/.exec(res.headers['Server-Timing'] || '');
  if (timing) serverTime.add(Number(timing[1]));
}
