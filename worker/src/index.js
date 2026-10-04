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

// Constant-time string comparison — avoid early-exit timing leaks on secret tokens
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// In-isolate rate limiter for /refresh — guards against token misuse draining Taostats quota.
// Cron path uses scheduled() directly and bypasses this limiter.
const REFRESH_MIN_INTERVAL_MS = 60_000;
const lastRefreshAt = new Map(); // type → epoch ms

// Hard upper bound on netuid — Bittensor reserves netuid 0 (root) and currently has <200 subnets.
// Used to reject /staking and /refresh?type=staking probes that would otherwise pollute KV
// and burn Taostats quota with garbage requests.
const MAX_NETUID = 1024;
const STAKING_TTL_MS = 24 * 60 * 60 * 1000;
// Keep the ranking representative consistent with the Staking page's default
// view: tiny validator positions can report extreme, non-actionable APY.
const APY_REPRESENTATIVE_MIN_STAKE = 1000;

// Taostats' free tier is deliberately treated as a scarce, shared resource.
// Four subnets per 20-minute core refresh covers 128 subnets in ~10.7 hours;
// running them serially keeps the validator-yield pagination and the shared
// take-map request from becoming a burst.
const STAKING_WARMUP_BATCH_SIZE = 4;
const STAKING_WARMUP_MAX_CONCURRENCY = 1;
const STAKING_WARMUP_INTERVAL_MS = 750;
const MAX_APY_NETUIDS = 200;

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

// ─── Refresh logic ───────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const BLOCK_EMISSION_RAO = 5e8; // 0.5 TAO/block post-halving

const WHALE_THRESHOLD = 1000; // TAO
const WHALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEW_SUBNET_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Net flows are calculated from the same pool total_tao snapshots. Taostats no
// longer supplies its former net_flow_* fields, so every window shares this source.
const FLOW_WINDOWS = [
  { field: 'netFlow4H',  seconds: 4 * 3600,      maxDrift: 60 * 60 },
  { field: 'netFlow24H', seconds: 24 * 3600,     maxDrift: 2 * 3600 },
  { field: 'netFlow7D',  seconds: 7 * 86400,     maxDrift: 12 * 3600 },
  { field: 'netFlow1M',  seconds: 30 * 86400,    maxDrift: 2 * 86400 },
];

// Keep fine-grained recent snapshots for 4H accuracy, then progressively
// downsample older data. This retains enough baselines for all flow windows
// without growing the single KV value to 30 days of 20-minute snapshots.
const SNAPSHOT_RETENTION = [
  { until: 6 * 3600,      interval: 20 * 60 },
  { until: 2 * 86400,     interval: 60 * 60 },
  { until: 9 * 86400,     interval: 6 * 3600 },
  { until: 32 * 86400,    interval: 24 * 3600 },
];

function compactTaoHistory(history, now) {
  const snapshots = Array.isArray(history)
    ? history.filter(entry => Number.isFinite(entry?.ts) && entry.taoMap && now >= entry.ts)
    : [];
  const selected = new Map();

  // Work newest-first so each time bucket keeps its latest real snapshot.
  snapshots.sort((a, b) => b.ts - a.ts);
  for (const entry of snapshots) {
    const age = now - entry.ts;
    const tier = SNAPSHOT_RETENTION.find(rule => age <= rule.until);
    if (!tier) continue;
    const bucket = `${tier.interval}:${Math.floor(entry.ts / tier.interval)}`;
    if (!selected.has(bucket)) selected.set(bucket, entry);
  }
  return [...selected.values()].sort((a, b) => a.ts - b.ts);
}

function calculateFlows(currentTaoMap, history, now) {
  const flows = {};
  for (const window of FLOW_WINDOWS) {
    const target = now - window.seconds;
    let baseline = null;
    for (const snapshot of history) {
      const distance = Math.abs(snapshot.ts - target);
      if (!baseline || distance < baseline.distance) baseline = { snapshot, distance };
    }

    // Do not label a partial history as a full time-window flow. During the
    // first month after deployment these fields remain 0 until a valid baseline exists.
    if (!baseline || baseline.distance > window.maxDrift) continue;
    for (const [netuid, current] of Object.entries(currentTaoMap)) {
      const previous = baseline.snapshot.taoMap[netuid];
      if (previous !== undefined) {
        if (!flows[netuid]) flows[netuid] = {};
        flows[netuid][window.field] = (current - previous) / RAO;
      }
    }
  }
  return flows;
}

function buildSubnetList(subnets, pools, flows, prevSignals = {}, whaleFlows = {}, taoPrice = 0) {
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
    const subnetFlows = flows[s.netuid] ?? {};

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
      netFlow4H:  Math.round(subnetFlows.netFlow4H  ?? 0),
      netFlow24H: Math.round(subnetFlows.netFlow24H ?? 0),
      netFlow7D:  Math.round(subnetFlows.netFlow7D  ?? 0),
      netFlow1M:  Math.round(subnetFlows.netFlow1M  ?? 0),
      emission: +emissionPct.toFixed(2),
      tvlUsd,
      isNew: s.registered_at ? (now - new Date(s.registered_at).getTime() < NEW_SUBNET_MS) : false,
      signal, // 'in' | 'out' | null
    };
  });

  return { subnets: result, signals: newSignals };
}

// Core refresh (every 20 min): subnets + pools + snapshot-based flows + whale trades
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

  const history = compactTaoHistory(taoHistory, now);
  const flows = calculateFlows(currentTaoMap, history, now);

  // Persist the current snapshot after calculating, then compact it into
  // progressively coarser buckets for the 4H/24H/7D/1M baselines.
  const updatedHistory = compactTaoHistory([...history, { ts: now, taoMap: currentTaoMap }], now);
  await env.TAOFLOW_KV.put('taoflow_tao_history', JSON.stringify(updatedHistory));

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

  const { subnets: subnetList, signals } = buildSubnetList(subnets, pools, flows, prevSignals, whaleFlows, taoPrice);
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
  const prevFee = cached.meta?.recycleFee ?? 0;
  const prevUp = cached.meta?.recycleFeeUp ?? false;
  // Hold last direction across plateaus so the indicator reflects the trend, not just per-refresh delta
  const recycleFeeUp = recycleFee > prevFee ? true : recycleFee < prevFee ? false : prevUp;

  const timeline = (recentRegsResp.data ?? []).map(r => ({
    type: 'registration',
    timestamp: r.timestamp ?? r.created_at ?? '',
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
      recycleFeeUp,
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

function parseUpdatedAt(updatedAt) {
  const timestamp = new Date(updatedAt ?? '').getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isStakingSnapshotStale(snapshot, now = Date.now()) {
  const updatedAt = parseUpdatedAt(snapshot?.updatedAt);
  return updatedAt === null || now - updatedAt >= STAKING_TTL_MS;
}

// Fetch and cache validator yield for a single netuid. `takeMap` lets a cron
// batch share its one global validator-take lookup across every subnet.
async function fetchStakingForNetuid(env, netuid, takeMap) {
  const [yieldRaw, resolvedTakeMap] = await Promise.all([
    fetchPages(env, '/dtao/validator/yield/latest/v1', { netuid }, 5),
    takeMap === undefined ? getTakeMap(env) : Promise.resolve(takeMap),
  ]);
  if (!Array.isArray(yieldRaw)) throw new Error(`invalid staking response for netuid ${netuid}`);
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
      commission: resolvedTakeMap[hk] ?? 18,
    };
  });

  // A transient upstream regression must not replace a usable snapshot with
  // an empty array. Empty data is still allowed for a genuinely new subnet.
  const cacheKey = `taoflow_staking_${netuid}`;
  const previous = await env.TAOFLOW_KV.get(cacheKey, { type: 'json' });
  if (data.length === 0 && Array.isArray(previous?.data) && previous.data.length > 0) {
    throw new Error(`refusing to overwrite non-empty staking snapshot for netuid ${netuid} with empty data`);
  }
  const updatedAt = new Date().toISOString();
  await env.TAOFLOW_KV.put(cacheKey, JSON.stringify({ data, updatedAt }));
  return { data, updatedAt };
}

// The APY listing is derived entirely from the persisted snapshot, never from
// Taostats. Returning only the representative validator keeps this endpoint
// compact while preserving all APY windows needed by the ranking UI.
function buildSubnetApySummary(snapshot) {
  const validators = (Array.isArray(snapshot?.data) ? snapshot.data : [])
    .filter(validator => Number(validator?.stake ?? 0) >= APY_REPRESENTATIVE_MIN_STAKE);
  const validator = validators.reduce((best, current) => {
    const currentApy = Number(current?.apy_7d);
    const bestApy = Number(best?.apy_7d);
    return !best || (Number.isFinite(currentApy) ? currentApy : -Infinity) > (Number.isFinite(bestApy) ? bestApy : -Infinity)
      ? current
      : best;
  }, null);
  if (!validator) return null;
  return {
    validator: {
      name: validator.name ?? '',
      hotkey: validator.hotkey ?? '',
      apy_1h: Number(validator.apy_1h ?? 0),
      apy_1d: Number(validator.apy_1d ?? 0),
      apy_7d: Number(validator.apy_7d ?? 0),
      apy_30d: Number(validator.apy_30d ?? 0),
    },
    updatedAt: snapshot.updatedAt ?? null,
    stale: isStakingSnapshotStale(snapshot),
  };
}

async function selectStakingWarmupNetuids(env, subnets, now = Date.now()) {
  const activeNetuids = [...new Set((Array.isArray(subnets) ? subnets : [])
    .map(subnet => Number(subnet?.id))
    .filter(netuid => Number.isInteger(netuid) && netuid >= 0 && netuid <= MAX_NETUID))];

  const candidates = [];
  await Promise.all(activeNetuids.map(async netuid => {
    let snapshot;
    try {
      snapshot = await env.TAOFLOW_KV.get(`taoflow_staking_${netuid}`, { type: 'json' });
    } catch (error) {
      // Treat a KV read failure as unknown, not as missing, so an existing
      // snapshot cannot be inadvertently replaced during a partial outage.
      console.error('staking warm-up KV read failed', { netuid, error: error?.message });
      return;
    }
    const timestamp = parseUpdatedAt(snapshot?.updatedAt);
    const priority = !snapshot ? 0 : timestamp === null ? 1 : now - timestamp >= STAKING_TTL_MS ? 2 : null;
    if (priority !== null) candidates.push({ netuid, priority, updatedAt: timestamp ?? 0 });
  }));

  return candidates
    // Root is not in taoflow_data.subnets, but it has a visible Staking page.
    // When its snapshot is stale, process it before the normal active-subnet
    // queue so the UI's "waiting for background refresh" state is short-lived.
    .sort((a, b) => (a.netuid === 0 ? -1 : b.netuid === 0 ? 1 : a.priority - b.priority || a.updatedAt - b.updatedAt || a.netuid - b.netuid))
    .slice(0, STAKING_WARMUP_BATCH_SIZE)
    .map(candidate => candidate.netuid);
}

async function warmupStakingSnapshots(env, subnets) {
  const netuids = await selectStakingWarmupNetuids(env, subnets);
  if (netuids.length === 0) return { selected: [], refreshed: 0 };

  // Fetch once before processing the serial batch. If it fails, no snapshot is
  // written and every selected subnet remains eligible for the next cron run.
  let takeMap;
  try {
    takeMap = await getTakeMap(env);
  } catch (error) {
    console.error('staking warm-up take map failed', { error: error?.message, netuids });
    return { selected: netuids, refreshed: 0 };
  }

  let refreshed = 0;
  // MAX_CONCURRENCY is intentionally one today. Keep this runner explicit so
  // a future increase cannot accidentally turn into an unbounded Promise.all.
  for (let index = 0; index < netuids.length; index += STAKING_WARMUP_MAX_CONCURRENCY) {
    const batch = netuids.slice(index, index + STAKING_WARMUP_MAX_CONCURRENCY);
    await Promise.all(batch.map(async netuid => {
      try {
        await fetchStakingForNetuid(env, netuid, takeMap);
        refreshed += 1;
      } catch (error) {
        console.error('staking warm-up refresh failed; preserving existing snapshot', { netuid, error: error?.message });
      }
    }));
    if (index + STAKING_WARMUP_MAX_CONCURRENCY < netuids.length) await sleep(STAKING_WARMUP_INTERVAL_MS);
  }
  return { selected: netuids, refreshed };
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
      if (!env.REFRESH_TOKEN || !safeEqual(searchParams.get('token') ?? '', env.REFRESH_TOKEN)) {
        return new Response('Unauthorized', { status: 401, headers: getCorsHeaders(request) });
      }
      // Normalize operation type up-front. Unknown values are rejected (not silently mapped to core)
      // so attackers cannot mint new rate-limit buckets by varying the param.
      const rawType = searchParams.get('type');
      let opKind;        // 'core' | 'full' | 'staking'
      let stakingNetuid; // only set when opKind === 'staking'
      if (rawType == null || rawType === 'core') {
        opKind = 'core';
      } else if (rawType === 'full') {
        opKind = 'full';
      } else if (rawType === 'staking') {
        const n = parseInt(searchParams.get('netuid') ?? '1', 10);
        if (!Number.isInteger(n) || n < 0 || n > MAX_NETUID) {
          return new Response(
            JSON.stringify({ error: 'invalid_netuid' }),
            { status: 400, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
          );
        }
        opKind = 'staking';
        stakingNetuid = n;
      } else {
        return new Response(
          JSON.stringify({ error: 'invalid_type' }),
          { status: 400, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
        );
      }
      const refreshType = opKind === 'staking' ? `staking:${stakingNetuid}` : opKind;
      const lastAt = lastRefreshAt.get(refreshType) ?? 0;
      const sinceMs = Date.now() - lastAt;
      if (sinceMs < REFRESH_MIN_INTERVAL_MS) {
        return new Response(
          JSON.stringify({ error: 'rate_limited', retryAfterMs: REFRESH_MIN_INTERVAL_MS - sinceMs }),
          {
            status: 429,
            headers: {
              ...getCorsHeaders(request),
              'Content-Type': 'application/json',
              'Retry-After': String(Math.ceil((REFRESH_MIN_INTERVAL_MS - sinceMs) / 1000)),
            },
          }
        );
      }
      lastRefreshAt.set(refreshType, Date.now());
      try {
        if (opKind === 'staking') {
          const result = await fetchStakingForNetuid(env, stakingNetuid);
          return new Response(
            JSON.stringify({ ok: true, validators: result.data.length, updatedAt: result.updatedAt }),
            { status: 200, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
          );
        }
        if (opKind === 'full') {
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
      let news = [];
      try {
        news = await getNewsList(env, days);
      } catch (e) {
        // KV transient error — return empty list so the News tab degrades gracefully instead of white-screening
        console.error('getNewsList failed:', e?.message);
      }
      return new Response(JSON.stringify(news), {
        headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }

    // APY ranking endpoint — a single batch KV read, never an upstream fetch.
    if (pathname === '/staking/apy') {
      const rawNetuids = searchParams.get('netuids');
      const netuids = rawNetuids == null ? [] : rawNetuids.split(',').map(value => Number(value.trim()));
      if (
        netuids.length === 0 ||
        netuids.length > MAX_APY_NETUIDS ||
        netuids.some(netuid => !Number.isInteger(netuid) || netuid < 0 || netuid > MAX_NETUID) ||
        new Set(netuids).size !== netuids.length
      ) {
        return new Response(JSON.stringify({ error: 'invalid_netuids' }), {
          status: 400,
          headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' },
        });
      }

      const entries = await Promise.all(netuids.map(async netuid => {
        try {
          const snapshot = await env.TAOFLOW_KV.get(`taoflow_staking_${netuid}`, { type: 'json' });
          const summary = buildSubnetApySummary(snapshot);
          return summary ? [netuid, summary] : null;
        } catch (error) {
          console.error('staking APY KV read failed', { netuid, error: error?.message });
          return null;
        }
      }));
      const data = Object.fromEntries(entries.filter(Boolean));
      return new Response(JSON.stringify({ data }), {
        headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    }

    // Staking endpoint — KV-only. Browser navigation must never spend Taostats
    // quota or turn a cache miss into a thundering herd of upstream requests.
    if (pathname === '/staking') {
      const netuid = parseInt(searchParams.get('netuid') ?? '0', 10);
      // Reject out-of-range netuids before they hit KV.
      if (!Number.isInteger(netuid) || netuid < 0 || netuid > MAX_NETUID) {
        return new Response(
          JSON.stringify({ error: 'invalid_netuid' }),
          { status: 400, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
        );
      }
      const cacheKey = `taoflow_staking_${netuid}`;
      try {
        const cached = await env.TAOFLOW_KV.get(cacheKey, { type: 'json' });
        if (cached) {
          return new Response(JSON.stringify({
            data: Array.isArray(cached.data) ? cached.data : [],
            updatedAt: cached.updatedAt ?? null,
            stale: isStakingSnapshotStale(cached),
          }), {
            headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
          });
        }
        return new Response(JSON.stringify({ data: [], updatedAt: null, pending: true }), {
          headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
        });
      } catch (e) {
        console.error('staking KV read failed', { netuid, error: e?.message });
        return new Response(JSON.stringify({ data: [], updatedAt: null, pending: true }), {
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
      ctx.waitUntil((async () => {
        const data = await refreshCore(env);
        try {
          // Root has a Staking page but is intentionally absent from the
          // active-subnet core list, so explicitly include it in pre-warming.
          await warmupStakingSnapshots(env, [{ id: 0 }, ...data.subnets]);
        } catch (error) {
          // A staking warm-up failure must never make the core cron look failed.
          console.error('staking warm-up failed after core refresh', { error: error?.message });
        }
      })());
    }
  },
};

export {
  STAKING_TTL_MS,
  STAKING_WARMUP_BATCH_SIZE,
  STAKING_WARMUP_MAX_CONCURRENCY,
  buildSubnetApySummary,
  fetchStakingForNetuid,
  isStakingSnapshotStale,
  selectStakingWarmupNetuids,
  warmupStakingSnapshots,
};
