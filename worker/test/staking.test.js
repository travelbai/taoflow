import assert from 'node:assert/strict';
import test from 'node:test';
import worker, {
  STAKING_WARMUP_MAX_CONCURRENCY,
  fetchStakingForNetuid,
  selectStakingWarmupNetuids,
  warmupStakingSnapshots,
} from '../src/index.js';

class MemoryKV {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
  }

  async get(key, options) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options?.type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

function snapshot(updatedAt, data = [{ name: 'Validator', hotkey: 'hk', apy_1h: 1, apy_1d: 2, apy_7d: 3, apy_30d: 4 }]) {
  return JSON.stringify({ updatedAt, data });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function envWith(kv) {
  return { TAOFLOW_KV: kv, TAOSTATS_API_KEY: 'test-key', REFRESH_TOKEN: 'refresh-token' };
}

test('/staking/apy only reads KV and chooses the highest 7D eligible validator', async () => {
  const kv = new MemoryKV({
    taoflow_staking_1: snapshot(new Date().toISOString(), [
      { name: 'Lower', hotkey: 'lower', stake: 2_000, apy_1h: 1, apy_1d: 2, apy_7d: 3, apy_30d: 4 },
      { name: 'Higher', hotkey: 'higher', stake: 2_000, apy_1h: 5, apy_1d: 6, apy_7d: 7, apy_30d: 8 },
      { name: 'Tiny outlier', hotkey: 'tiny', stake: 999, apy_1h: 9999, apy_1d: 9999, apy_7d: 9999, apy_30d: 9999 },
    ]),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('upstream must not be called'); };
  try {
    const response = await worker.fetch(new Request('https://worker.test/staking/apy?netuids=1,2'), envWith(kv));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data['1'].validator.name, 'Higher');
    assert.equal(body.data['1'].validator.apy_7d, 7);
    assert.equal(body.data['2'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /staking returns fresh, stale, and pending KV states without upstream fetches', async () => {
  const kv = new MemoryKV({
    taoflow_staking_1: snapshot(new Date().toISOString()),
    taoflow_staking_2: snapshot(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('upstream must not be called'); };
  try {
    const fresh = await (await worker.fetch(new Request('https://worker.test/staking?netuid=1'), envWith(kv))).json();
    const stale = await (await worker.fetch(new Request('https://worker.test/staking?netuid=2'), envWith(kv))).json();
    const pending = await (await worker.fetch(new Request('https://worker.test/staking?netuid=3'), envWith(kv))).json();
    assert.equal(fresh.stale, false);
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.data, JSON.parse(kv.values.get('taoflow_staking_2')).data);
    assert.deepEqual(pending, { data: [], updatedAt: null, pending: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('protected manual staking refresh still calls upstream and writes KV', async () => {
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.pathname.endsWith('/dtao/validator/yield/latest/v1')) {
      return jsonResponse({ data: [{ name: 'Manual', hotkey: { ss58: 'manual-hotkey' }, stake: 2_000_000_000, one_day_apy: 0.12 }] });
    }
    if (url.pathname.endsWith('/dtao/validator/latest/v1')) {
      return jsonResponse({ data: [{ hotkey: { ss58: 'manual-hotkey' }, take: 0.1 }] });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.test/refresh?token=refresh-token&type=staking&netuid=9', { method: 'POST' }), envWith(kv));
    assert.equal(response.status, 200);
    assert.ok(kv.values.has('taoflow_staking_9'));
    assert.ok(calls.some(path => path.endsWith('/dtao/validator/yield/latest/v1')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed background refresh preserves a stale snapshot that remains readable', async () => {
  const stale = snapshot(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
  const kv = new MemoryKV({ taoflow_staking_7: stale, taoflow_take_map: JSON.stringify({ ts: Date.now(), map: {} }) });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ error: 'upstream failure' }, 500);
  try {
    await assert.rejects(() => fetchStakingForNetuid(envWith(kv), 7, {}));
    assert.equal(kv.values.get('taoflow_staking_7'), stale);
    const body = await (await worker.fetch(new Request('https://worker.test/staking?netuid=7'), envWith(kv))).json();
    assert.equal(body.stale, true);
    assert.equal(body.data.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('warm-up selects missing, invalid, then oldest expired snapshots', async () => {
  const now = Date.now();
  const kv = new MemoryKV({
    taoflow_staking_1: snapshot(new Date(now - 60 * 60 * 1000).toISOString()),
    taoflow_staking_3: snapshot('not-a-date'),
    taoflow_staking_4: snapshot(new Date(now - 26 * 60 * 60 * 1000).toISOString()),
    taoflow_staking_5: snapshot(new Date(now - 40 * 60 * 60 * 1000).toISOString()),
  });
  const selected = await selectStakingWarmupNetuids(envWith(kv), [1, 2, 3, 4, 5].map(id => ({ id })), now);
  assert.deepEqual(selected, [2, 3, 5, 4]);
});

test('warm-up shares one take map request and never exceeds configured concurrency', async () => {
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  let takeMapCalls = 0;
  let activeYieldCalls = 0;
  let maxActiveYieldCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/dtao/validator/latest/v1')) {
      takeMapCalls += 1;
      return jsonResponse({ data: [] });
    }
    if (url.pathname.endsWith('/dtao/validator/yield/latest/v1')) {
      activeYieldCalls += 1;
      maxActiveYieldCalls = Math.max(maxActiveYieldCalls, activeYieldCalls);
      await new Promise(resolve => setTimeout(resolve, 15));
      activeYieldCalls -= 1;
      return jsonResponse({ data: [{ name: 'Warm', hotkey: { ss58: 'warm-hotkey' }, stake: 1_000_000_000 }] });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const result = await warmupStakingSnapshots(envWith(kv), [1, 2, 3, 4, 5].map(id => ({ id })));
    assert.deepEqual(result.selected, [1, 2, 3, 4]);
    assert.equal(result.refreshed, 4);
    assert.equal(takeMapCalls, 1);
    assert.ok(maxActiveYieldCalls <= STAKING_WARMUP_MAX_CONCURRENCY);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
