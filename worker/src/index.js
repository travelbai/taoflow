const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const API = 'https://api.taostats.io/api';
const RAO = 1_000_000_000;

// ─── Taostats helpers ────────────────────────────────────────────────────────

function rao(v) {
  return Number(v ?? 0) / RAO;
}

async function apiFetch(env, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: env.TAOSTATS_API_KEY },
  });
  if (!res.ok) throw new Error(`taostats ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fetch all pages up to maxPages (200 items each)
async function fetchPages(env, path, params = {}, maxPages = 10) {
  const first = await apiFetch(env, path, { ...params, page: 1, limit: 200 });
  const totalPages = Math.min(first.pagination?.total_pages ?? 1, maxPages);
  if (totalPages <= 1) return first.data ?? [];
  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      apiFetch(env, path, { ...params, page: i + 2, limit: 200 }).then(r => r.data ?? [])
    )
  );
  return [...(first.data ?? []), ...rest.flat()];
}

// ─── Data processing ─────────────────────────────────────────────────────────

// Get net TAO flow from a tao_flow record (handles different field name conventions)
function recordFlow(r) {
  if (r.net_tao !== undefined) return rao(r.net_tao);
  if (r.tao_flow !== undefined) return rao(r.tao_flow);
  return rao(r.tao_in ?? 0) - rao(r.tao_out ?? 0);
}

// Aggregate tao_flow records into { [netuid]: netFlowTAO }
function aggregateFlows(records) {
  const map = {};
  for (const r of records) {
    map[r.netuid] = (map[r.netuid] ?? 0) + recordFlow(r);
  }
  return map;
}

function relativeTime(ts) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 3600) return `${Math.floor(secs / 60)} mins ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hours ago`;
  return `${Math.floor(secs / 86400)} days ago`;
}

// ─── Core refresh logic ──────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function refresh(env) {
  const now = Math.floor(Date.now() / 1000);

  // Phase 1: core subnet + pool data
  const [subnets, pools] = await Promise.all([
    fetchPages(env, '/subnet/latest/v1', {}, 3),
    fetchPages(env, '/dtao/pool/latest/v1', {}, 3),
  ]);

  await sleep(500);

  // Phase 2: stats + registrations
  const [regCostResp, recentRegsResp] = await Promise.all([
    apiFetch(env, '/stats/latest/v1', { limit: 1 }),
    apiFetch(env, '/subnet/registration/v1', { limit: 5, order: 'timestamp_desc' }),
  ]);

  await sleep(500);

  // Phase 3: 4H flow only (24H/7D/1M come from subnet fields directly)
  const flow4h = await fetchPages(env, '/dtao/tao_flow/v1', { timestamp_start: now - 4 * 3600 }, 1)
    .catch(() => []);
  const flows4h = aggregateFlows(flow4h);

  // Index pools by netuid
  const poolMap = Object.fromEntries(pools.map(p => [p.netuid, p]));

  // Only show active subnets: subtoken_enabled = true (deregistered subnets have it false)
  const activeSubnets = subnets.filter(s => s.netuid > 0 && s.subtoken_enabled === true);

  // Emission % = subnet emission / total block emission * 100
  // Bittensor post-halving block emission = 0.5 TAO = 5e8 rao
  const BLOCK_EMISSION_RAO = 5e8;

  // Build subnet list
  const subnetList = activeSubnets.map(s => {
      const pool = poolMap[s.netuid] ?? {};

      // Price is directly provided by the API
      const price = Number(pool.price ?? 0);

      // 24h price change
      const priceChange = Number(pool.price_change_1_day ?? 0);

      // Emission % = subnet emission / total block emission (0.5 TAO post-halving)
      const emissionPct = Number(s.emission ?? 0) / BLOCK_EMISSION_RAO * 100;

      // ROI estimate: annual subnet emission TAO / TVL TAO * 100
      const annualEmission = (Number(s.emission ?? 0) / RAO) * 7200 * 365 * 0.5;
      const tvl = Number(pool.total_tao ?? 0) / RAO;
      const roi = tvl > 0 ? +(annualEmission / tvl * 100).toFixed(1) : 0;

      return {
        id: s.netuid,
        name: s.name || `SN${s.netuid}`,
        price: +price.toFixed(4),
        priceChange: +priceChange.toFixed(2),
        netFlow4H:  Math.round(flows4h[s.netuid] ?? 0),
        // 24H/7D/1M come directly from subnet pre-computed fields (in rao)
        netFlow24H: Math.round(rao(s.net_flow_1_day  ?? 0)),
        netFlow7D:  Math.round(rao(s.net_flow_7_days  ?? 0)),
        netFlow1M:  Math.round(rao(s.net_flow_30_days ?? 0)),
        emission: +emissionPct.toFixed(2),
        roi,
      };
    });

  // Registration (recycle) fee — from /stats/latest/v1 -> subnet_registration_cost
  const recycleFee = Math.round(rao(regCostResp.data?.[0]?.subnet_registration_cost ?? regCostResp.data?.[0]?.registration_cost ?? 0));

  // Timeline from recent registrations
  const timeline = (recentRegsResp.data ?? []).map(r => ({
    type: 'registration',
    time: relativeTime(r.timestamp ?? r.created_at),
    title: `SN${r.netuid} 注册成功`,
    creator: `${(r.owner?.ss58 ?? r.creator ?? '').slice(0, 6)}...`,
    fee: Math.round(rao(r.registration_cost ?? r.cost ?? 0)),
    feeTrend: 'flat',
  }));

  // Total registered slots = all non-root subnets (including deregistered ones)
  const totalSlots = subnets.filter(s => s.netuid > 0).length;

  const data = {
    subnets: subnetList,
    timeline,
    meta: {
      activeSubnets: subnetList.length,
      totalSubnets: totalSlots,
      recycleFee,
      recycleFeeUp: true,
      updatedAt: new Date().toISOString(),
    },
  };

  await env.TAOFLOW_KV.put('taoflow_data', JSON.stringify(data));
  return data;
}

// ─── Worker handlers ─────────────────────────────────────────────────────────

export default {
  // Serve cached KV data; /refresh?token=... triggers manual re-fetch
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const { pathname, searchParams } = new URL(request.url);

    // Manual refresh endpoint — requires REFRESH_TOKEN secret
    if (pathname === '/refresh') {
      if (!env.REFRESH_TOKEN || searchParams.get('token') !== env.REFRESH_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }
      try {
        const data = await refresh(env);
        return new Response(
          JSON.stringify({ ok: true, subnets: data.subnets.length, updatedAt: data.meta.updatedAt }),
          { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    const cached = await env.TAOFLOW_KV.get('taoflow_data', { type: 'json' });
    if (!cached) {
      return new Response(JSON.stringify({ error: 'No data found' }), {
        status: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
    });
  },

  // Scheduled handler: runs automatically via cron trigger
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
};
