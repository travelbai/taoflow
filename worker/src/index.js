const ALLOWED_ORIGINS = [
  'https://taoflow.pages.dev',
  'http://localhost',
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + ':'));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const API = 'https://api.taostats.io/api';
const RAO = 1_000_000_000;

// ─── Taostats helpers ────────────────────────────────────────────────────────

function rao(v) {
  return Number(v ?? 0) / RAO;
}

async function apiFetch(env, path, params = {}, retries = 3) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), { headers: { Authorization: env.TAOSTATS_API_KEY } });
    if (res.status === 429 && attempt < retries) {
      await sleep(3000 * (attempt + 1)); // 3s, 6s, 9s
      continue;
    }
    if (!res.ok) throw new Error(`taostats ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

// Fetch all pages concurrently up to maxPages (200 items each)
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

function relativeTime(ts) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 3600) return `${Math.floor(secs / 60)} mins ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hours ago`;
  return `${Math.floor(secs / 86400)} days ago`;
}

// ─── Refresh logic ───────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const BLOCK_EMISSION_RAO = 5e8; // 0.5 TAO/block post-halving

const WHALE_THRESHOLD = 1000; // TAO
const WHALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEW_SUBNET_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function buildSubnetList(subnets, pools, flows4h, prevSignals = {}, whaleFlows = {}, taoPrice = 0) {
  const poolMap = Object.fromEntries(pools.map(p => [p.netuid, p]));
  const activeSubnets = subnets.filter(s => s.netuid > 0 && s.subtoken_enabled === true);
  const now = Date.now();
  const newSignals = {};

  const result = activeSubnets.map(s => {
    const pool = poolMap[s.netuid] ?? {};
    const price = Number(pool.price ?? 0);
    const priceChange = Number(pool.price_change_1_day ?? 0);
    const emissionPct = Number(s.emission ?? 0) / BLOCK_EMISSION_RAO * 100;
    const taoIn = Number(pool.total_tao ?? 0) / RAO;
    const tvlUsd = +(taoIn * taoPrice).toFixed(2);
    const net4h = Math.round(flows4h[s.netuid] ?? 0);

    // Whale signal: based on large single-wallet trades (>1000 TAO) in last 24H
    const prev = prevSignals[s.netuid];
    const wf = whaleFlows[s.netuid];
    let signal = null;

    if (wf?.in >= WHALE_THRESHOLD) {
      newSignals[s.netuid] = { type: 'in', since: now };
      signal = 'in';
    } else if (wf?.out >= WHALE_THRESHOLD) {
      newSignals[s.netuid] = { type: 'out', since: now };
      signal = 'out';
    } else if (prev && now - prev.since < WHALE_TTL_MS) {
      // No new signal but previous one is still within 24h window
      newSignals[s.netuid] = prev;
      signal = prev.type;
    }
    // else: expired or no signal — omit from newSignals

    return {
      id: s.netuid,
      name: (pool.name && pool.name !== 'Unknown' ? pool.name : ''),
      price: +price.toFixed(8),
      priceChange: +priceChange.toFixed(2),
      netFlow4H:  net4h,
      netFlow24H: Math.round(rao(s.net_flow_1_day  ?? 0)),
      netFlow7D:  Math.round(rao(s.net_flow_7_days  ?? 0)),
      netFlow1M:  Math.round(rao(s.net_flow_30_days ?? 0)),
      emission: +emissionPct.toFixed(2),
      tvlUsd,
      isNew: s.registered_at ? (now - new Date(s.registered_at).getTime() < NEW_SUBNET_MS) : false,
      signal, // 'in' | 'out' | null
    };
  });

  return { subnets: result, signals: newSignals };
}

// Core refresh (every 20 min): subnets + pools + 4H flow (snapshot-based) + whale trades
async function refreshCore(env) {
  const now = Math.floor(Date.now() / 1000);

  const [subnets, pools, priceResp] = await Promise.all([
    fetchPages(env, '/subnet/latest/v1', {}, 3),
    fetchPages(env, '/dtao/pool/latest/v1', {}, 3),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd', {
      headers: { 'User-Agent': 'TaoFlow/2.0 (https://taoflow.pages.dev)' },
    }).then(r => r.json()).catch(() => null),
  ]);
  // Read KV once — used for cachedPrice fallback + meta reuse
  const [cached, taoHistory] = await Promise.all([
    env.TAOFLOW_KV.get('taoflow_data', { type: 'json' }),
    env.TAOFLOW_KV.get('taoflow_tao_history', { type: 'json' }),
  ]);
  const meta = cached?.meta ?? {};
  const prevSignals = cached?.signals ?? {};
  const freshPrice = Number(priceResp?.bittensor?.usd ?? 0);
  const taoPrice = freshPrice > 0 ? freshPrice : (meta.taoPrice ?? 0);

  // Build current total_tao snapshot for 4H flow calculation
  const currentTaoMap = {};
  for (const p of pools) {
    if (p.netuid != null) currentTaoMap[p.netuid] = Number(p.total_tao ?? 0);
  }

  // Prune history older than 5 hours, then find baseline closest to 4H ago
  const history = Array.isArray(taoHistory) ? taoHistory : [];
  const pruned = history.filter(e => now - e.ts < 18000);
  const target4h = now - 4 * 3600;
  let baseline = null;
  for (const e of pruned) {
    if (!baseline || Math.abs(e.ts - target4h) < Math.abs(baseline.ts - target4h)) {
      baseline = e;
    }
  }

  // 4H net flow = current total_tao - baseline total_tao (in TAO)
  const flows4h = {};
  if (baseline?.taoMap) {
    for (const [netuid, curTao] of Object.entries(currentTaoMap)) {
      const baseTao = baseline.taoMap[netuid];
      if (baseTao !== undefined) flows4h[netuid] = (curTao - baseTao) / RAO;
    }
  }

  // Save updated snapshot history (keep last 16 entries ≈ 5.3h at 20-min intervals)
  pruned.push({ ts: now, taoMap: currentTaoMap });
  await env.TAOFLOW_KV.put('taoflow_tao_history', JSON.stringify(pruned.slice(-16)));

  await sleep(500);

  const tradesRaw = await fetchPages(env, '/dtao/trade/v1', { timestamp_start: now - 24 * 3600, limit: 200 }, 1).catch(() => []);

  // Compute per-subnet whale signals from large single-wallet trades
  const whaleFlows = {}; // { [netuid]: { in: max, out: max } }
  for (const t of tradesRaw) {
    const taoVal = rao(t.tao_value ?? t.from_amount ?? 0);
    if (taoVal < WHALE_THRESHOLD) continue;
    const isBuy  = t.to_name?.startsWith('SN');
    const isSell = t.from_name?.startsWith('SN');
    if (!isBuy && !isSell) continue;
    const netuid = isBuy
      ? parseInt(t.to_name.replace('SN', ''), 10)
      : parseInt(t.from_name.replace('SN', ''), 10);
    if (!whaleFlows[netuid]) whaleFlows[netuid] = { in: 0, out: 0 };
    if (isBuy)  whaleFlows[netuid].in  += taoVal;
    if (isSell) whaleFlows[netuid].out += taoVal;
  }

  const { subnets: subnetList, signals } = buildSubnetList(subnets, pools, flows4h, prevSignals, whaleFlows, taoPrice);
  const totalSlots = subnets.filter(s => s.netuid > 0).length;

  const data = {
    subnets: subnetList,
    signals,
    timeline: cached?.timeline ?? [],
    meta: {
      activeSubnets: subnetList.length,
      totalSubnets: totalSlots,
      recycleFee: meta.recycleFee ?? 0,
      recycleFeeUp: meta.recycleFeeUp ?? false,
      taoPrice,
      updatedAt: new Date().toISOString(),
    },
  };

  await env.TAOFLOW_KV.put('taoflow_data', JSON.stringify(data));
  return data;
}

// Full refresh (every 2 hours): only 2 unique API calls — reuses Core KV data
async function refresh(env) {
  // Read what Core just wrote — subnets/pools/flows already fresh
  const cached = await env.TAOFLOW_KV.get('taoflow_data', { type: 'json' });
  if (!cached) {
    // No core data yet — fall back to running core first
    return refreshCore(env);
  }

  const [regCostResp, recentRegsResp] = await Promise.all([
    apiFetch(env, '/stats/latest/v1', { limit: 1 }),
    apiFetch(env, '/subnet/registration/v1', { limit: 5, order: 'timestamp_desc' }),
  ]);

  const recycleFee = Math.round(rao(regCostResp.data?.[0]?.subnet_registration_cost ?? regCostResp.data?.[0]?.registration_cost ?? 0));

  const timeline = (recentRegsResp.data ?? []).map(r => ({
    type: 'registration',
    time: relativeTime(r.timestamp ?? r.created_at),
    title: `SN${r.netuid} 注册成功`,
    creator: r.owner?.ss58 ?? r.creator ?? '',
    fee: Math.round(rao(r.registration_cost ?? r.cost ?? 0)),
    feeTrend: 'flat',
  }));

  const data = {
    ...cached,
    timeline,
    meta: {
      ...cached.meta,
      recycleFee,
      recycleFeeUp: recycleFee > (cached.meta?.recycleFee ?? 0),
      updatedAt: cached.meta.updatedAt, // keep Core's timestamp
    },
  };

  await env.TAOFLOW_KV.put('taoflow_data', JSON.stringify(data));
  return data;
}

// Fetch global validator take map (hotkey → take%), cached in KV for 7 days
const TAKE_CACHE_KEY = 'taoflow_take_map';
async function getTakeMap(env) {
  const cached = await env.TAOFLOW_KV.get(TAKE_CACHE_KEY, { type: 'json' });
  if (cached && Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000) return cached.map;
  const raw = await fetchPages(env, '/dtao/validator/latest/v1', {}, 10);
  const map = {};
  for (const v of raw) {
    const hk = v.hotkey?.ss58 || '';
    if (hk) map[hk] = +(Number(v.take ?? 0) * 100).toFixed(2);
  }
  await env.TAOFLOW_KV.put(TAKE_CACHE_KEY, JSON.stringify({ map, ts: Date.now() }));
  return map;
}

// Fetch and cache validator yield for a single netuid — called on demand from /staking
async function fetchStakingForNetuid(env, netuid) {
  const [yieldRaw, takeMap] = await Promise.all([
    fetchPages(env, '/dtao/validator/yield/latest/v1', { netuid }, 5),
    getTakeMap(env),
  ]);
  const data = yieldRaw.map(v => {
    const hk = v.hotkey?.ss58 || '';
    return {
      name: v.name || '',
      hotkey: hk,
      stake: Math.round(Number(v.stake ?? 0) / RAO),
      apy_1h:  +(Number(v.one_hour_apy   ?? 0) * 100).toFixed(3),
      apy_1d:  +(Number(v.one_day_apy    ?? 0) * 100).toFixed(3),
      apy_7d:  +(Number(v.seven_day_apy  ?? 0) * 100).toFixed(3),
      apy_30d: +(Number(v.thirty_day_apy ?? 0) * 100).toFixed(3),
      commission: takeMap[hk] ?? 18,
    };
  });
  const updatedAt = new Date().toISOString();
  await env.TAOFLOW_KV.put(`taoflow_staking_${netuid}`, JSON.stringify({ data, updatedAt }));
  return { data, updatedAt };
}

// ─── News (X-scraped subnet updates) ─────────────────────────────────────────

async function getNewsList(env, days = 30) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const all = await env.TAOFLOW_KV.get('taoflow_news_all', { type: 'json' });
  if (Array.isArray(all)) {
    return all.filter(n => n.created_at >= cutoff);
  }
  return [];
}

// ─── Worker handlers ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    const { pathname, searchParams } = new URL(request.url);

    // Manual refresh — POST /refresh?token=...  optional &type=staking
    if (pathname === '/refresh') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: getCorsHeaders(request) });
      }
      if (!env.REFRESH_TOKEN || searchParams.get('token') !== env.REFRESH_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: getCorsHeaders(request) });
      }
      try {
        if (searchParams.get('type') === 'staking') {
          const netuid = parseInt(searchParams.get('netuid') ?? '1', 10);
          const result = await fetchStakingForNetuid(env, netuid);
          return new Response(
            JSON.stringify({ ok: true, validators: result.data.length, updatedAt: result.updatedAt }),
            { status: 200, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
          );
        }
        if (searchParams.get('type') === 'full') {
          const data = await refresh(env);
          return new Response(
            JSON.stringify({ ok: true, subnets: data.subnets.length, updatedAt: data.meta.updatedAt }),
            { status: 200, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
          );
        }
        const data = await refreshCore(env);
        return new Response(
          JSON.stringify({ ok: true, subnets: data.subnets.length, updatedAt: data.meta.updatedAt }),
          { status: 200, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
        );
      }
    }

    // News endpoint — fetch X-scraped subnet news from KV, up to 30 days
    if (pathname === '/api/news') {
      const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 30);
      const news = await getNewsList(env, days);
      return new Response(JSON.stringify(news), {
        headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    }

    // Staking endpoint — on-demand fetch per netuid, 24h KV cache
    if (pathname === '/staking') {
      const netuid = parseInt(searchParams.get('netuid') ?? '0', 10);
      const STAKING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — APY data changes slowly
      const cacheKey = `taoflow_staking_${netuid}`;

      const cached = await env.TAOFLOW_KV.get(cacheKey, { type: 'json' });
      if (cached && Date.now() - new Date(cached.updatedAt).getTime() < STAKING_TTL_MS) {
        return new Response(JSON.stringify({ data: cached.data, updatedAt: cached.updatedAt }), {
          headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
      }

      try {
        const result = await fetchStakingForNetuid(env, netuid);
        return new Response(JSON.stringify(result), {
          headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
      } catch (e) {
        // Fall back to stale cache rather than showing empty
        if (cached) {
          return new Response(JSON.stringify({ data: cached.data, updatedAt: cached.updatedAt }), {
            headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: [], error: e.message }), {
          status: 200, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' },
        });
      }
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: getCorsHeaders(request) });
    }

    const cached = await env.TAOFLOW_KV.get('taoflow_data', { type: 'json' });
    if (!cached) {
      return new Response(JSON.stringify({ error: 'No data found' }), {
        status: 404,
        headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' },
      });
    }

    // Strip internal fields before sending to client
    const { signals: _, ...publicData } = cached;
    return new Response(JSON.stringify(publicData), {
      status: 200,
      headers: {
        ...getCorsHeaders(request),
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
    });
  },

  // core every 20 min, full every 2h
  async scheduled(event, env, ctx) {
    if (event.cron === '0 */2 * * *') {
      ctx.waitUntil(refresh(env));
    } else {
      ctx.waitUntil(refreshCore(env));
    }
  },
};
