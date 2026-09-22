import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { paymentHealth, paymentHealthSnapshot, persistedPaymentHealthSnapshot, settlementCapacity } from '../sites/worker/payment-health.mjs';
import { mainnetFetch, rpc, runAutomaticSettlement } from '../sites/worker/mainnet.mjs';

let serial = 0;
function config(overrides = {}) {
  const suffix = (++serial).toString(16).padStart(40, '0');
  return { enabled: true, automaticSettlementReady: true, escrowVersion: '6',
    chainId: 4217, escrowAddress: '0x' + suffix, v6DomainSeparator: '0x' + 'ab'.repeat(32),
    settlementSigner: '0x' + '11'.repeat(20), relayerAddress: '0x' + '11'.repeat(20),
    settlementGraceSeconds: 120, ...overrides };
}
function journalDb({ pending = 0, fail = false } = {}) {
  const entries = new Map();
  const counts = { reads: 0, writes: 0, overdue: 0 };
  return { counts, prepare(sql) {
    let args = [];
    return { bind(...value) { args = value; return this; },
      async first() {
        if (fail) throw Error('D1 unavailable');
        if (sql.includes('COUNT(*)')) { counts.overdue++; return { count: pending, oldest: null }; }
        counts.reads++;
        return entries.has(args[0]) ? { value: entries.get(args[0]) } : null;
      },
      async run() {
        if (fail) throw Error('D1 unavailable');
        counts.writes++;
        entries.set(args[0], args[1]);
        return { meta: { changes: 1 } };
      } };
  } };
}
const deployment = cfg => async method =>
  method === 'eth_chainId' ? '0x1079' : cfg.v6DomainSeparator;

test('cold public snapshot is honest; concurrent V6 refresh shares four RPC checks and one DB query', async () => {
  const cfg = config();
  const db = journalDb();
  const rpc = [];
  const balance = async address => { rpc.push('balance:' + address); return 100000n; };
  const read = async method => { rpc.push(method); return deployment(cfg)(method); };
  assert.equal(paymentHealthSnapshot(cfg).state, 'unknown');
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    paymentHealth(db, cfg, balance, read)));
  assert.ok(results.every(result => result.ready && result.fresh && result.state === 'ready'));
  assert.equal(rpc.length, 3); // chain, domain, one shared signer/relayer balance
  assert.equal(db.counts.overdue, 1);
  assert.equal(db.counts.reads, 1);
  assert.equal(db.counts.writes, 1);
  assert.equal(paymentHealthSnapshot(cfg).state, 'ready');
  assert.equal((await paymentHealth(db, cfg, balance, read)).ready, true);
  assert.equal(rpc.length, 3);
});

test('stale ready cannot admit; chain, domain, balance and D1 failures fail closed', async () => {
  for (const failure of ['chain', 'domain', 'balance', 'db']) {
    const cfg = config();
    const db = journalDb({ fail: failure === 'db' });
    const balance = async () => failure === 'balance' ? 0n : 100000n;
    const read = async method => failure === 'chain' && method === 'eth_chainId' ? '0x1'
      : failure === 'domain' && method === 'eth_call' ? '0x' + '00'.repeat(32)
      : deployment(cfg)(method);
    const result = await paymentHealth(db, cfg, balance, read);
    assert.equal(result.ready, false, failure);
    assert.equal(paymentHealthSnapshot(cfg).ready, false, failure);
  }
  const cfg = config();
  const db = journalDb();
  await paymentHealth(db, cfg, async () => 100000n, deployment(cfg));
  const stale = paymentHealthSnapshot(cfg, Date.now() + 16_000);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.ready, false);
  assert.equal(stale.fresh, false);
});

test('capacity distinguishes a low signer, unavailable balance, healthy signer and low relayer', async () => {
  const lowConfig = config({ relayerAddress: null });
  const low = settlementCapacity(await paymentHealth(journalDb(), lowConfig,
    async () => 5_000n, deployment(lowConfig)));
  assert.equal(low.state, 'low');
  assert.equal(low.signer.balanceUnits, '5000');
  assert.equal(low.signer.minimumUnits, '10000');
  assert.equal(low.relayer.state, 'not-configured');
  assert.match(low.warning, /Settlement signer.*below.*New paid activity.*recovery/);
  assert.ok(low.checkedAt && low.fresh);

  const unavailableConfig = config({ relayerAddress: null });
  const unavailable = settlementCapacity(await paymentHealth(journalDb(), unavailableConfig,
    async () => { throw Error('RPC unavailable'); }, deployment(unavailableConfig)));
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.signer.balanceUnits, null);
  assert.match(unavailable.warning, /signer fee balance is unavailable/);

  const readyConfig = config({ relayerAddress: null });
  const ready = settlementCapacity(await paymentHealth(journalDb(), readyConfig,
    async () => 100_000n, deployment(readyConfig)));
  assert.equal(ready.state, 'ready');
  assert.equal(ready.warning, null);

  const relayerConfig = config({ relayerAddress: '0x' + '22'.repeat(20) });
  const relayer = settlementCapacity(await paymentHealth(journalDb(), relayerConfig,
    async address => address === relayerConfig.relayerAddress ? 5_000n : 100_000n, deployment(relayerConfig)));
  assert.equal(relayer.signer.state, 'ready');
  assert.equal(relayer.relayer.state, 'low');
  assert.match(relayer.warning, /MPP relayer/);
});

test('a rejected refresh releases its slot and a failed D1 read leaves public browsing available', async () => {
  const cfg = config();
  const db = journalDb({ fail: true });
  const first = await paymentHealth(db, cfg, async () => 100000n, deployment(cfg));
  assert.equal(first.state, 'unavailable');
  const publicView = await persistedPaymentHealthSnapshot(db, cfg);
  assert.equal(publicView.ready, false);
  const recovered = await paymentHealth(journalDb(), cfg,
    async () => 100000n, deployment(cfg), Date.now() + 16_000);
  assert.equal(recovered.ready, true);
});

test('static requests cause no readiness RPC, background work or settlement lease write', async () => {
  const key = '0x' + '0a'.repeat(32);
  const signer = privateKeyToAccount(key).address;
  const env = { WM_MODE: 'tempo-mainnet', WM_BOUNTY_ESCROW_VERSION: '5',
    WM_BOUNTY_ESCROW_ADDRESS: '0x' + '55'.repeat(20),
    WM_ESCROW_SETTLEMENT_SIGNER: signer, WM_SETTLEMENT_PRIVATE_KEY: key,
    WM_RESULT_SIGNING_READY: 'true', DB: journalDb() };
  let background = 0, staticCalls = 0;
  const result = await mainnetFetch(new Request('https://foundry.example/app.css'), env,
    { waitUntil() { background++; } }, () => { staticCalls++; return new Response('asset'); });
  assert.equal(result.status, 200);
  assert.equal(staticCalls, 1);
  assert.equal(background, 0);
  assert.equal(env.DB.counts.reads, 0);
  assert.equal(env.DB.counts.writes, 0);
});

test('catalog and health expose unavailable snapshots when D1 readiness reads fail', async () => {
  const key = '0x' + '0a'.repeat(32);
  const signer = privateKeyToAccount(key).address;
  const db = journalDb({ fail: true });
  const env = { WM_MODE: 'tempo-mainnet', WM_BOUNTY_ESCROW_VERSION: '5',
    WM_BOUNTY_ESCROW_ADDRESS: '0x' + '77'.repeat(20),
    WM_ESCROW_SETTLEMENT_SIGNER: signer, WM_SETTLEMENT_PRIVATE_KEY: key,
    WM_RESULT_SIGNING_READY: 'true', DB: db };
  const pending = [];
  const ctx = { waitUntil(value) { pending.push(value); } };
  const rules = await mainnetFetch(new Request('https://foundry.example/api/rules'), env, ctx);
  const catalog = await rules.json();
  assert.equal(rules.status, 200);
  assert.equal(catalog.paymentHealth.state, 'unavailable');
  assert.equal(catalog.paymentHealth.ready, false);
  assert.equal(catalog.settlementCapacity.state, 'unavailable');
  assert.equal(catalog.settlementCapacity.signer.state, 'unavailable');
  assert.match(catalog.settlementCapacity.warning, /unavailable|stale/i);
  assert.equal(catalog.directEscrow.acceptingNewBounties, false);
  assert.ok(catalog.parts.length > 0);
  await Promise.all(pending);
  const health = await (await mainnetFetch(
    new Request('https://foundry.example/api/health'), env, ctx)).json();
  assert.equal(health.ok, false);
  assert.equal(health.paymentHealth.state, 'unavailable');
  assert.equal(health.paymentHealth.ready, false);
  assert.equal(health.settlementCapacity.state, 'unavailable');
  assert.equal(health.paymentsEnabled, false);
  assert.equal(db.counts.writes, 0);
});

test('RPC deadline includes a stalled response body and reports invalid JSON separately', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }));
    const started = Date.now();
    await assert.rejects(rpc({ rpcUrl: 'https://rpc.fixture' }, 'eth_chainId', [], { timeoutMs: 30 }),
      error => error.status === 503 && /timed out/i.test(error.message));
    assert.ok(Date.now() - started < 500);
    globalThis.fetch = async () => new Response('not json');
    await assert.rejects(rpc({ rpcUrl: 'https://rpc.fixture' }, 'eth_chainId', []),
      error => error.status === 502 && /invalid response/i.test(error.message));
  } finally { globalThis.fetch = original; }
});

test('only relevant requests invoke the settlement lease; duplicate triggers obey its expiry', async () => {
  const key = '0x' + '0a'.repeat(32);
  const signer = privateKeyToAccount(key).address;
  let clock = 1_800_000_000_000;
  const previousClock = Date.now;
  Date.now = () => clock;
  const lease = { writes: 0, scans: 0, expiry: 0 };
  const db = { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return null; },
      async all() { lease.scans++; return { results: [] }; },
      async run() {
        if (sql.includes('INSERT INTO payment_kv') && args[0] === 'system:settlement-runner') {
          lease.writes++;
          if (clock < lease.expiry) return { meta: { changes: 0 } };
          lease.expiry = JSON.parse(args[1]).expires;
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      } };
  } };
  const env = { WM_MODE: 'tempo-mainnet', WM_BOUNTY_ESCROW_VERSION: '5',
    WM_BOUNTY_ESCROW_ADDRESS: '0x' + '55'.repeat(20),
    WM_ESCROW_SETTLEMENT_SIGNER: signer, WM_SETTLEMENT_PRIVATE_KEY: key,
    WM_RESULT_SIGNING_READY: 'true', DB: db };
  const pending = [];
  const ctx = { waitUntil(work) { pending.push(work); } };
  try {
    await mainnetFetch(new Request('https://foundry.example/logo.svg'), env, ctx,
      () => new Response('asset'));
    assert.equal(lease.writes, 0);
    const id = '11111111-1111-4111-8111-111111111111';
    await mainnetFetch(new Request('https://foundry.example/api/attempts/' + id), env, ctx);
    await Promise.all(pending.splice(0));
    assert.equal(lease.writes, 1);
    const scansAfterFirst = lease.scans;
    await mainnetFetch(new Request('https://foundry.example/api/attempts/' + id), env, ctx);
    await Promise.all(pending.splice(0));
    assert.equal(lease.writes, 2);
    assert.equal(lease.scans, scansAfterFirst); // duplicate trigger does not scan jobs
    clock += 31_000;
    await runAutomaticSettlement(env, 'scheduled');
    assert.equal(lease.writes, 3);
    assert.ok(lease.scans > scansAfterFirst + 1);
  } finally { Date.now = previousClock; }
});
