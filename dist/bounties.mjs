import {
  paymentPanel,
  paymentBreakdown,
  paymentIsRefunded,
  paymentIsV6,
  paymentStatus,
  transactionLink,
} from "./payment-status.mjs";
import {
  ARENAS,
  TERRAIN_INFO,
  PRESETS,
  DEFAULT_RULES,
  normalizeRules,
  packChallenge,
  unpackChallenge,
  clone,
  stats,
  validate,
  rulesLabel,
} from "./data.mjs";
import { PLATFORM_FEE_BPS, rewardQuote } from "./economy.mjs";
import { CLIENT_ENGINE_HASH } from "./release.mjs";

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const signed = (n) => (n > 0 ? "+" : "") + Number(n).toLocaleString();
const money = (n) =>
    Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }),
  time = (t) => new Date(t).toLocaleString(),
  uid = () => crypto.randomUUID();
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const OUTBOX_KEY = "wm-sandbox-outbox";
const OUTBOX_VERSION = 3;
const GUIDE_DISMISSED_KEY = "wm-bounty-guide-dismissed";
const validHash = (value) =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const officialReplayPlayed = new Set();
export function boardScopeForFilter(filter, paid, authenticated) {
  if (!paid || !authenticated) return "public";
  return { mine: "mine", saved: "saved", completed: "history" }[filter] || "public";
}
export function settlementCapacityDescription(capacity) {
  if (!capacity || capacity.ready || capacity.fresh !== true) return "";
  const role = (name, value) => `${name}: ${value?.state || "unavailable"}${value?.balanceUnits != null ? ` (${money(Number(value.balanceUnits) / 1e6)} pathUSD)` : ""}`;
  return `${capacity.warning || "Settlement fee funding has not been verified."} ${role("Signer", capacity.signer)}; ${role("relayer", capacity.relayer)}. Checked: ${capacity.checkedAt ? time(capacity.checkedAt) : "never"}; ${capacity.fresh ? "fresh" : "stale or unavailable"}. Browsing and recovery remain available.`;
}
function clearOutbox() {
  localStorage.removeItem(OUTBOX_KEY);
}
function pendingOutbox() {
  const value = read(OUTBOX_KEY, null);
  const valid =
    value &&
    value.version === OUTBOX_VERSION &&
    typeof value.path === "string" &&
    /^\/bounties(?:\/|$)/.test(value.path) &&
    value.body &&
    typeof value.body === "object" &&
    !Array.isArray(value.body) &&
    typeof value.key === "string" &&
    (!value.intentId || typeof value.intentId === "string") &&
    (!value.transactionHash || validHash(value.transactionHash));
  if (!valid && value) clearOutbox();
  return valid ? value : null;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shortAddress = (value) =>
  value && value.length > 10
    ? value.slice(0, 6) + "…" + value.slice(-4)
    : value;
const attemptIdentity = (attempt) => {
  const name = attempt.participantName || "Anonymous engineer";
  const machine = attempt.machineName || "Friendly challenger";
  const address =
    attempt.addressVisible && attempt.participantAddress
      ? ` · ${shortAddress(attempt.participantAddress)}`
      : "";
  return `<span class="attempt-identity"><strong>${esc(name)}</strong><small>${esc(machine)}${esc(address)}</small></span>`;
};
export function createBountyUI(adapter) {
  let currentFeeBps = PLATFORM_FEE_BPS;
  let token = read("wm-sandbox-token", null),
    me = null,
    generation = 0,
    timer = 0,
    current = null,
    filter = "open",
    savedIds = new Set(),
    searchText = "",
    arenaFilter = "",
    feeFilter = "",
    runtime = { mode: null, paid: null, currency: null },
    walletBalance = null,
    tempoClient = null,
    accountUpdate = null,
    routeAbort = null;
  let guideDismissed = read(GUIDE_DISMISSED_KEY, true) === true;
  // GET state is deliberately scoped. A revealed bounty or account response
  // must never be reused after sign-out or by another wallet.
  const getCache = new Map();
  const getInFlight = new Map();
  const publicCachePrefix = "wm-public-cache-v2:";
  const cacheScope = (path = "") => token
    ? `account:${token}`
    : /^\/bounties(?:[/?]|$)/.test(path) || path === "/me/bookmarks"
      ? `account:${me?.payoutAddress || "unresolved-wallet"}`
    : runtime.paid
      ? `account:${me?.payoutAddress || "pending-wallet"}`
      : "public";
  function readPublicCache(path, ttl, scope) {
    if (scope !== "public") return null;
    if (!ttl) return null;
    try {
      const raw = sessionStorage.getItem(publicCachePrefix + path);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || typeof cached.time !== "number") return null;
      if (Date.now() - cached.time >= ttl) return null;
      return cached;
    } catch {
      return null;
    }
  }
  function writePublicCache(path, value, scope, nextCursor = null) {
    if (scope !== "public") return;
    try {
      sessionStorage.setItem(
        publicCachePrefix + path,
        JSON.stringify({ time: Date.now(), value, nextCursor }),
      );
    } catch {
      // Private browsing and embedded webviews may deny sessionStorage.
    }
  }
  const cacheTtl = (path) =>
    path === "/rules"
      ? 15_000
      : /^\/bounties(?:\?|$)/.test(path)
        ? 60_000
        : path === "/me" || path === "/me/wallet"
          ? 5_000
          : path === "/me/bookmarks"
            ? 15_000
        : /^\/bounties\//.test(path)
          ? 15_000
          : 0;
  const invalidateMutationCache = () => {
    getCache.clear();
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(publicCachePrefix)) sessionStorage.removeItem(key);
    }
  };
  const invalidateBoardCache = () => {
    for (const key of getCache.keys()) {
      if (key.endsWith(":/bounties") || key.includes(":/bounties?") || key.includes(":/bounties/"))
        getCache.delete(key);
    }
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(publicCachePrefix + "/bounties"))
        sessionStorage.removeItem(key);
    }
  };
  const app = $("#app");
  async function ensureTempoClient() {
    if (tempoClient) return tempoClient;
    const response = await fetch("/.well-known/war-machines.json", {
      credentials: "include",
    });
    if (!response.ok) throw Error("Tempo payment discovery is unavailable.");
    const discovery = await response.json();
    tempoClient = await import("./tempo-client.mjs");
    await tempoClient.configure(discovery);
    return tempoClient;
  }
  async function configureRuntime(catalog) {
    runtime = {
      mode: catalog.mode,
      escrowVersion: String(catalog.directEscrow?.version || ""),
      paid:
        catalog.mode === "tempo-mainnet" &&
        catalog.directEscrow?.enabled === true,
      acceptingNewBounties:
        catalog.mode !== "tempo-mainnet" ||
        catalog.directEscrow?.acceptingNewBounties === true,
      paymentHealth: catalog.paymentHealth || {
        state: "unknown",
        checkedAt: null,
        fresh: false,
        reason: "Payment readiness has not yet been verified.",
      },
      settlementCapacity: catalog.settlementCapacity || null,
      settlementReason:
        catalog.paymentHealth?.reason ||
        catalog.directEscrow?.settlement?.reason ||
        catalog.activation?.reason ||
        null,
      currency: catalog.economics.amountUnit || "sandbox credits",
    };
    return runtime;
  }
  function applyPaymentHealth(health) {
    if (!health) return;
    runtime.paymentHealth = health.paymentHealth || runtime.paymentHealth;
    runtime.settlementCapacity = health.settlementCapacity || runtime.settlementCapacity;
    if (runtime.mode === "tempo-mainnet") {
      runtime.acceptingNewBounties = health.paymentsEnabled === true;
      runtime.settlementReason = runtime.paymentHealth?.reason || null;
    }
  }
  async function refreshPaymentReadiness() {
    if (!runtime.paid || runtime.paymentHealth?.fresh === true) return runtime.acceptingNewBounties;
    const health = await api("/health");
    applyPaymentHealth(health);
    return runtime.acceptingNewBounties;
  }
  function requestError(error) {
    if (error?.name === "AbortError")
      return Error(
        "The arena server took too long to finish responding. Try again. Your saved build is safe.",
      );
    return error instanceof Error
      ? error
      : Error("Cannot reach the arena server. Your saved build is safe.");
  }
  function subscribe(flight, signal) {
    return new Promise((resolve, reject) => {
      const subscriber = {};
      const cleanup = () => {
        flight.subscribers.delete(subscriber);
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        if (!flight.subscribers.size) flight.controller.abort();
        const error = Error("Request cancelled because this screen changed.");
        error.name = "AbortError";
        reject(error);
      };
      if (signal?.aborted) return abort();
      flight.subscribers.add(subscriber);
      signal?.addEventListener("abort", abort, { once: true });
      flight.promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }
  function sharedGet(path, request, key, ttl, signal) {
    let flight = getInFlight.get(key);
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, subscribers: new Set(), promise: null };
      flight.promise = (async () => {
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
          // Keep the deadline armed through response body consumption: fetch()
          // resolving only says headers arrived, not that JSON is usable.
          const response = await fetch("/api" + path, { ...request, signal: controller.signal });
          let result;
          try {
            result = await response.json();
          } catch {
            throw Error("Bounties need a complete server response. Try again; the static workshop still works.");
          }
          if (!response.ok) {
            const error = Error(result.error || "Request failed.");
            error.status = response.status;
            throw error;
          }
          const nextCursor = response.headers?.get("x-next-cursor") || null;
          getCache.set(key, { time: Date.now(), value: result, nextCursor });
          writePublicCache(path, result, key.slice(0, key.indexOf(":")), nextCursor);
          return result;
        } finally {
          clearTimeout(timeout);
          getInFlight.delete(key);
        }
      })();
      getInFlight.set(key, flight);
    }
    return subscribe(flight, signal);
  }
  async function api(path, method = "GET", body, key, { signal } = {}) {
    const ttl = !body && method === "GET" ? cacheTtl(path) : 0;
    const scope = cacheScope(path);
    const scopedKey = `${scope}:${path}`;
    if (ttl) {
      const cached = getCache.get(scopedKey);
      if (cached && Date.now() - cached.time < ttl) return cached.value;
      const stored = readPublicCache(path, ttl, scope);
      if (stored !== null) {
        getCache.set(scopedKey, stored);
        return stored.value;
      }
    }
    const request = {
      method,
      credentials: "include",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    try {
      if (ttl) return await sharedGet(path, request, scopedKey, ttl, signal || routeAbort?.signal);
      const controller = new AbortController();
      const routeSignal = method === "GET" ? signal || routeAbort?.signal : null;
      const cancelForRoute = () => controller.abort();
      if (routeSignal?.aborted) controller.abort();
      else routeSignal?.addEventListener("abort", cancelForRoute, { once: true });
      const timeout = setTimeout(() => controller.abort(), method === "GET" ? 8_000 : 45_000);
      try {
        const response = await fetch("/api" + path, { ...request, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) {
          const error = Error(result.error || "Request failed.");
          error.status = response.status;
          throw error;
        }
        // Mutations change board, detail and account state. Do not retain a
        // generic GET response across them.
        if (method !== "GET") invalidateMutationCache();
        return result;
      } finally {
        clearTimeout(timeout);
        routeSignal?.removeEventListener("abort", cancelForRoute);
      }
    } catch (e) {
      throw requestError(e);
    }
  }
  async function boardPage(scope, cursor = null) {
    const path = scope === "public" && !cursor
      ? "/bounties"
      : `/bounties?scope=${encodeURIComponent(scope)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const requestScope = cacheScope(path);
    const items = await api(path);
    return { items: Array.isArray(items) ? items : [],
      nextCursor: getCache.get(`${requestScope}:${path}`)?.nextCursor || null };
  }
  async function ensurePaidWalletSession() {
    if (!runtime.paid || me) return me;
    await (await ensureTempoClient()).signInWallet();
    await refreshMe();
    if (!me)
      throw Error("Tempo Wallet did not complete the bounty identity check.");
    return me;
  }
  function retryableConfirmation(error) {
    return (
      (error?.status === 409 &&
        /not confirmed yet|awaiting finality|awaiting canonical finality/i.test(
          error.message,
        )) ||
      (error?.status === 503 && /Tempo RPC/i.test(error.message))
    );
  }
  function friendlyPaymentError(error) {
    const message = String(error?.message || "Request failed.");
    if (retryableConfirmation(error))
      return "Payment submitted, but Tempo is still confirming it. This request is saved; choose Recover request after a moment. Do not pay again.";
    if (
      error?.status === 402 &&
      /proof|credential|already used|already consumed/i.test(message)
    )
      return "The payment credential was already used or is still being reconciled. Check the saved request or My runs; do not submit another payment.";
    if (
      error?.status === 409 &&
      /already deployed|different committed counter/i.test(message)
    )
      return "This machine submission was already accepted. Reopening the official attempt; do not submit it again.";
    if (error?.status === 503 && /Tempo RPC/i.test(message))
      return "Tempo is temporarily unavailable. Your request is saved; choose Recover request later instead of paying again.";
    return message;
  }
  async function confirmDirectIntent(request) {
    let lastError;
    // Tempo returns a transaction hash before the receipt reaches finality.
    // Give the chain a short, automatic confirmation window before exposing
    // the durable Recover action.
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        return await api(
          "/escrow/intents/" + request.intentId + "/confirm",
          "POST",
          { transactionHash: request.transactionHash },
          request.key,
        );
      } catch (error) {
        lastError = error;
        if (!retryableConfirmation(error) || attempt === 29) throw error;
        await wait(1000);
      }
    }
    throw lastError;
  }
  async function mutate(path, body) {
    // A direct payment needs a signed owner identity to bind the paid reveal,
    // refunds and winner payout. Connect it only when the player starts a
    // payment action; saved builds and history remain an optional account view.
    await ensurePaidWalletSession();
    const pending = pendingOutbox();
    if (
      pending &&
      (pending.path !== path ||
        JSON.stringify(pending.body) !== JSON.stringify(body))
    ) {
      if (pending.transactionHash)
        throw Error(
          "A wallet transaction is already saved for a different request. Recover that payment before starting another one.",
        );
      // No transaction hash means the wallet has not been charged. A new
      // amount or bounty action can safely replace the abandoned intent.
      clearOutbox();
    }
    const request = pending || {
      version: OUTBOX_VERSION,
      path,
      body,
      key: uid(),
    };
    save(OUTBOX_KEY, request);
    try {
      let prepared;
      if (request.intentId && request.transactionHash) {
        const confirmed = await confirmDirectIntent(request);
        clearOutbox();
        invalidateBoardCache();
        return confirmed;
      }
      if (request.intentId) {
        prepared = await api(path, "POST", body, request.key);
        if (prepared.final) {
          clearOutbox();
          invalidateBoardCache();
          return prepared.value;
        }
      } else {
        prepared = await api(path, "POST", body, request.key);
        if (!prepared.direct) {
          clearOutbox();
          return prepared;
        }
        request.intentId = prepared.intentId;
        save(OUTBOX_KEY, request);
      }
      // The server may have already bound a submitted wallet hash before an
      // earlier confirmation was interrupted. Always recover that exact hash;
      // never ask Tempo Wallet to fund the same request a second time.
      if (!request.transactionHash && prepared.transactionHash) {
        request.transactionHash = prepared.transactionHash;
        save(OUTBOX_KEY, request);
      }
      if (!request.transactionHash) {
        request.transactionHash = await (await ensureTempoClient()).executeEscrowPlan(
          prepared.plan,
        );
        save(OUTBOX_KEY, request);
      }
      const confirmed = await confirmDirectIntent(request);
      clearOutbox();
      invalidateBoardCache();
      return confirmed;
    } catch (e) {
      // Keep payment-sensitive conflicts recoverable. Clearing a saved key on
      // a 402/409/429 can turn a retry-safe request into an accidental second
      // wallet payment.
      if (
        !request.intentId &&
        e.status &&
        e.status < 500 &&
        ![402, 409, 429].includes(e.status)
      )
        clearOutbox();
      throw e;
    }
  }
  function leave() {
    generation++;
    clearTimeout(timer);
    routeAbort?.abort();
    routeAbort = null;
  }
  function begin() {
    // A route owns its subscriptions, not the underlying shared request. The
    // last departing subscriber aborts the network work; otherwise another
    // screen can continue using the same GET without a duplicate request.
    routeAbort?.abort();
    routeAbort = new AbortController();
    clearTimeout(timer);
    adapter.show();
    current = null;
    accountUpdate = null;
    return ++generation;
  }
  function schedule(fn, g, delay = 2500) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (g === generation) void fn();
    }, delay);
  }
  function status(s) {
    const label =
      {
        busy: "IN PROGRESS",
        completed: "COMPLETED",
        claimed: "REWARD PAID",
        cancelled: "CLOSED",
        expired: "EXPIRED",
      }[s] || s.toUpperCase();
    return `<span class="contract-status ${s}">${esc(label)}</span>`;
  }
  const paymentUnit = () => (runtime.paid ? "pathUSD" : runtime.currency);
  const constructionUnit = () =>
    runtime.paid ? "construction credits" : "build credits";
  const bountyExpired = (b) =>
    !!b.expires && Number(b.expires) <= Date.now() && b.status === "open";
  const bountyEscrowVersion = (b) =>
    Number(b?.escrowVersion ?? b?.payment?.escrowVersion ?? b?.protocolVersion ?? 0);
  const isLegacyV5 = (b) =>
    runtime.escrowVersion === "6" &&
    (b?.legacy === true || Number(b?.legacy) === 5 || bountyEscrowVersion(b) === 5);
  const bountyCardState = (b) => {
    if (bountyExpired(b)) return "expired";
    return b.status;
  };
  const bountyAvailabilityLabel = (b, complete) => {
    if (isLegacyV5(b)) return "LEGACY V5 · READ ONLY";
    if (complete) return "RESULT · 10 MINUTES";
    if (bountyExpired(b)) return "ENTRY CLOSED · EXPIRED";
    if (b.status === "busy")
      return b.activeResult || b.result || b.settlement
        ? "RESULT PENDING · SETTLEMENT"
        : "IN PROGRESS · ENTRY CLOSED";
    return b.listed ? "AVAILABLE CHALLENGE" : "LINK ONLY";
  };
  const hasPendingBountyResult = (b) =>
    !!(
      b.activeResult ||
      b.result ||
      b.settlement ||
      b.payment?.state === "awaiting-signatures" ||
      b.payment?.state === "ready-to-settle"
    );
  function header(title, subtitle) {
    const walletTitle =
        runtime.paid && me?.payoutAddress ? me.payoutAddress : "",
      account = runtime.mode === null
        ? "Checking wallet…"
        : me
        ? runtime.paid
          ? `${shortAddress(me.payoutAddress)} · ${walletBalance ? money(walletBalance.balance) + " pathUSD" : "balance unavailable"}`
          : runtime.mode === "tempo-mainnet"
            ? "Payments unavailable"
            : money(me.balance) + " sandbox credits"
        : runtime.mode === "tempo-mainnet"
          ? "Saved builds"
          : "Sign in for bounties",
      season = runtime.mode === null
        ? "CHECKING ENVIRONMENT"
        : runtime.paid
        ? "TEMPO MAINNET"
        : runtime.mode === "tempo-mainnet"
          ? "MAINNET SETUP"
          : "SANDBOX SEASON";
    const pending = pendingOutbox();
    const capacity = runtime.settlementCapacity;
    const capacityNotice = runtime.paid && capacity && capacity.fresh === true && !capacity.ready
      ? `<div class="notice settlement-capacity-warning" role="alert"><strong>Settlement capacity warning</strong><p>${esc(settlementCapacityDescription(capacity))}</p></div>`
      : "";
    return `<div class="page-heading bounty-heading"><div><span class="eyebrow">WAR MACHINES BOUNTIES / ${season}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><button id="contracts-home">All bounties</button>${me ? '<button id="build-vault">Build vault</button>' : ""}<button id="credits-btn" title="${esc(walletTitle)}" aria-label="${esc(walletTitle ? "Connected Tempo Wallet " + walletTitle : account)}">${esc(account)}</button>${runtime.paid && me ? '<button id="swap-pathusd" title="Swap a supported Tempo stablecoin into pathUSD">Swap to pathUSD</button><button id="disconnect-wallet" class="danger" title="Clear this browser’s Tempo Wallet connection">Disconnect</button>' : ""}</div></div>${capacityNotice}${pending ? `<div class="notice" role="status" aria-live="polite"><strong>Payment request saved.</strong> ${pending.transactionHash ? "The same transaction will be confirmed; no new wallet payment will be sent." : "No wallet charge has been recorded yet; recover with the saved idempotency key or discard this request."} <button id="recover-request">Recover request</button><button id="discard-request">Discard request</button></div>` : ""}`;
  }
  function wireHeader() {
    if ($("#contracts-home")) $("#contracts-home").onclick = () => open();
    if ($("#build-vault")) $("#build-vault").onclick = vault;
    if ($("#credits-btn")) $("#credits-btn").onclick = profile;
    if ($("#disconnect-wallet"))
      $("#disconnect-wallet").onclick = (e) =>
        act(e.currentTarget, () => disconnectWallet());
    if ($("#swap-pathusd"))
      $("#swap-pathusd").onclick = (e) =>
        act(e.currentTarget, async () => {
          const result = await (await ensureTempoClient()).swapToPathUsd();
          await refreshMe();
          adapter.toast(`Swap submitted · ${shortAddress(result.hash)}. pathUSD balance refreshed.`);
        });
    if ($("#recover-request"))
      $("#recover-request").onclick = () =>
        act($("#recover-request"), async () => {
          const p = pendingOutbox();
          if (!p)
            throw Error("That interrupted request is no longer available.");
          const r = await mutate(p.path, p.body);
          await refreshMe();
          if (p.path.endsWith("/attempts")) await attempt(r.id);
          else await open(r.id);
        });
    if ($("#discard-request"))
      $("#discard-request").onclick = () => {
        clearOutbox();
        adapter.toast(
          "Interrupted request discarded. No wallet transaction was sent.",
        );
        void open();
      };
  }
  async function act(button, fn) {
    if (button) button.disabled = true;
    try {
      await fn();
    } catch (e) {
      const message = friendlyPaymentError(e);
      adapter.toast(message);
      const node = $("#bounty-error");
      if (node) node.textContent = message;
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }
  async function refreshMe({ skipWallet = false } = {}) {
    const priorAccount = me?.payoutAddress || null;
    if (token || runtime.paid) {
      try {
        me = await api("/me");
      } catch (e) {
        if (e.status !== 401) throw e;
        me = null;
      }
    }
    if (priorAccount !== (me?.payoutAddress || null)) {
      // Cookie-backed wallet sessions can change without a page reload.
      // Private GET state belongs to the prior account and is discarded.
      getCache.clear();
      walletBalance = null;
    }
    walletBalance = null;
    if (runtime.paid && me?.payoutAddress) {
      const address = me.payoutAddress,
        loadWallet = async () => {
          try {
            const balance = await api("/me/wallet");
            if (me?.payoutAddress === address) {
              walletBalance = balance;
              accountUpdate?.();
            }
          } catch {
            // The address remains visible if a public RPC is briefly unavailable.
          }
        };
      if (skipWallet) void loadWallet();
      else await loadWallet();
    }
    return me;
  }
  async function disconnectWallet(returnId) {
    await (await ensureTempoClient()).logout();
    me = null;
    walletBalance = null;
    invalidateMutationCache();
    await open(returnId);
  }
  function thumb(canvas, packed) {
    adapter.thumbnail(canvas, unpackChallenge(packed, true).machine);
  }
  function scout(b) {
    if (b.scout) return b.scout;
    const challenge = unpackChallenge(b.blueprint, true),
      s = stats(challenge.machine);
    return {
      cost: s.cost,
      mass: s.mass,
      parts: s.parts,
      weapons: s.weapons,
      height: s.height,
      arena: challenge.arena,
      rules: challenge.rules,
    };
  }
  const bountyArena = (b) =>
    ARENAS.find((arena) => arena.id === (b.blueprint?.a || scout(b).arena));
  const bountyRules = (b) => b.blueprint?.q || scout(b).rules;
  const sealedPreview = (b) =>
    `<div class="sealed-defender" role="img" aria-label="Hidden opponent: ${scout(b).cost} build credits, ${scout(b).mass} tonnes"><span>◆</span><small>OPPONENT HIDDEN</small></div>`;
  function drawThumbs(data) {
    $$("[data-contract-thumb]").forEach((c) => {
      const b = data.find((b) => b.id === c.dataset.contractThumb);
      if (b?.blueprint) thumb(c, b.blueprint);
    });
  }
  function terrain(arena) {
    const types = [...new Set(arena.terrain.map((t) => t.type))];
    return `<div class="terrain-tags">${arena.climate ? `<span class="terrain-tag climate" title="${esc(arena.desc)}">${esc(arena.climate.name)}</span>` : ""}${types.map((t) => `<span class="terrain-tag ${t}" title="${esc(TERRAIN_INFO[t]?.effect || "")}">${esc(TERRAIN_INFO[t]?.name || t)}</span>`).join("")}</div>`;
  }
  function feeNotice(b) {
    return `<div class="notice fee-disclosure"><strong>${b.platformFeeBps ? money(b.platformFeeBps / 100) + "% platform fee on a win" : "No platform fee · original bounty terms"}</strong><br>Gross reward ${money(b.reward)} ${paymentUnit()} − platform fee ${money(b.platformFee)} ${paymentUnit()} = <strong>${money(b.payout)} ${paymentUnit()} paid to the winner</strong>. Entry costs ${money(b.entry)} ${paymentUnit()} separately. On a loss, draw, or missed build deadline, that entry is paid to the <strong>bounty creator</strong>. Net before network/swap fees if you win: ${signed(b.netIfWin)} ${paymentUnit()}. Wallet network fees and any input-token swap costs are separate estimates.<br><span class="fee-disclosure-subnote">Entry payment reveals the opponent only. Machine submission happens later and does not charge a second entry.</span></div>`;
  }
  function card(b) {
    const s = scout(b),
      a = bountyArena(b),
      legacyV5 = isLegacyV5(b),
      complete = ["completed", "claimed"].includes(b.status),
      cardState = bountyCardState(b),
      fee = b.platformFeeBps
        ? `${money(b.payout)} ${paymentUnit()} winner payout · ${money(b.platformFeeBps / 100)}% platform fee`
        : `${money(b.payout)} ${paymentUnit()} winner payout · legacy terms / no platform fee`;
    return `<article class="contract-card"><div class="contract-card-top">${status(cardState)}<small>${bountyAvailabilityLabel(b, complete)}</small></div><div class="contract-preview">${b.blueprint ? `<canvas data-contract-thumb="${b.id}" width="300" height="260" aria-label="Opponent machine"></canvas>` : sealedPreview(b)}<span class="contract-reward"><b>${money(b.reward)}</b><small>GROSS REWARD · ${esc(paymentUnit())}</small></span></div><div class="contract-content"><h2>${esc(b.title)}</h2><p>${esc(a.name)} · ${s.cost} ${constructionUnit()} · ${s.mass} t · ${s.parts} fitted parts</p>${terrain(a)}<div class="contract-class">${esc(rulesLabel(bountyRules(b)))}</div><p class="card-fee">${fee}</p><div class="contract-footer"><span><b>${b.entry} ${paymentUnit()}</b> ${legacyV5 ? "historical entry" : "entry"} · ${b.attempts} runs</span><button data-contract="${b.id}">${complete ? "Watch result" : "View challenge"} ↗</button></div></div></article>`;
  }
  function refreshHeaderAccount() {
    const node = $(".bounty-heading"),
      title = node?.querySelector("h1")?.textContent,
      subtitle = node?.querySelector("p")?.textContent;
    if (!node || !title || !subtitle) return;
    const shell = document.createElement("div");
    shell.innerHTML = header(title, subtitle);
    node.replaceWith(shell.firstElementChild);
    wireHeader();
  }
  async function open(id, { restore = false } = {}) {
    if (!restore && adapter.navigate) {
      adapter.navigate({ name: id ? "bounty" : "bounties", value: id || undefined });
      return;
    }
    const g = begin();
    app.innerHTML =
      header(
        "CHOOSE A CHALLENGE.",
        "Review the rules, then create or join a challenge.",
      ) +
      '<div class="bounty-loading" role="status" aria-live="polite"><span class="loading-mark" aria-hidden="true"></span><strong>Loading bounties</strong><span>Fetching live challenges and payment status…</span><div class="bounty-loading-grid" aria-hidden="true"><i></i><i></i><i></i></div></div>';
    wireHeader();
    try {
      // Start the public board request immediately and overlap it with the
      // rules/config request. The board does not need wallet state to load.
      const boardRequestScope = cacheScope("/bounties");
      const dataRequest = api(id ? "/bounties/" + id : "/bounties");
      const catalogRequest = api("/rules");
      const data = await dataRequest;
      if (g !== generation) return;
      // Configuration/readiness can be stale or checking without making the
      // public board unusable. Paint useful challenge identities immediately;
      // the later render supplies verified payment controls and economics.
      if (id) {
        app.innerHTML =
          header("CHALLENGE LOADED.", "Loading current rules and payment controls…") +
          `<section class="panel bounty-empty"><h2>${esc(data.title || "Challenge")}</h2><p>${esc(data.ownerName || "Arena engineer")} · ${esc(data.status || "available")}</p><p>Challenge details are ready. Payment eligibility is being verified separately.</p></section>`;
      } else {
        const publicRows = Array.isArray(data) ? data : [];
        app.innerHTML =
          header("CHOOSE A CHALLENGE.", "Browsing live challenges while payment readiness refreshes.") +
          `<section class="bounty-board-main" aria-live="polite"><p class="notice">Payment controls are loading. You can browse challenges now.</p><div class="contract-grid">${publicRows.map((b) => `<article class="contract-card"><div class="contract-content"><h2>${esc(b.title)}</h2><p>${esc(b.ownerName || "Arena engineer")} · ${esc(String(b.status || "open").toUpperCase())}</p><button data-preview-contract="${esc(b.id)}">View challenge ↗</button></div></article>`).join("") || '<div class="bounty-empty">No challenges are listed right now.</div>'}</div></section>`;
        $$('[data-preview-contract]').forEach((button) => {
          button.onclick = () => open(button.dataset.previewContract);
        });
      }
      wireHeader();
      const catalog = await catalogRequest;
      await configureRuntime(catalog);
      currentFeeBps = catalog.economics.platformFee.basisPoints;
      if (catalog.versions.hash !== CLIENT_ENGINE_HASH)
        throw Error(
          "This tab has an older game release. Reload the page before entering or replaying bounties.",
        );
      // Account hydration is deliberately non-blocking. Wallet balance RPCs
      // can take tens of seconds while the public board is ready in a moment.
      const meRequest = refreshMe({ skipWallet: true }).catch(() => null);
      if (g !== generation) return;
      if (id) {
        current = data;
        detail(data, g);
        accountUpdate = () => {
          if (g === generation) refreshHeaderAccount();
        };
        void meRequest.then(async () => {
          const saved = me ? await api("/me/bookmarks").catch(() => []) : [];
          savedIds = new Set(saved.map((b) => b.id));
          if (g === generation) {
            current = data;
            detail(data, g);
          }
        });
        return;
      }
const paymentPaused = runtime.paid && runtime.paymentHealth?.fresh === true && !runtime.acceptingNewBounties;
const guide = `<section class="contract-hero" id="challenge-guide" ${guideDismissed ? "hidden" : ""}><div class="challenge-hero-copy"><div class="guide-heading"><div><span class="eyebrow">${runtime.paid ? "HOW PAID CHALLENGES WORK" : "HOW LOCAL CHALLENGES WORK"}</span><h2>How to enter and play.</h2></div><button id="close-challenge-guide" class="guide-close" type="button" aria-label="Hide challenge guide">Hide</button></div><ol class="challenge-steps"><li><b>1. Read the challenge</b><span>Check the arena, build limits, reward and entry cost.</span></li><li><b>2. Pay the entry</b><span>Tempo Wallet reveals the opponent and starts your build timer.</span></li><li><b>3. Build and submit</b><span>Stay within the locked limits, then submit before the timer ends.</span></li><li><b>4. Watch the result</b><span>Both machines fight automatically. The escrow pays the winner.</span></li></ol><div class="contract-hero-actions"><button class="primary" id="new-contract" ${paymentPaused ? "disabled" : ""}>${paymentPaused ? "New paid challenges paused" : "+ Create a challenge"}</button><button id="my-history">My runs</button></div>${paymentPaused ? '<p class="notice bounty-footnote">' + esc(runtime.settlementReason) + '</p>' : ''}</div><aside class="credit-summary"><span class="status-stamp">${runtime.paid ? "TEMPO MAINNET / pathUSD" : "LOCAL MODE / NO CASH VALUE"}</span><h3>${runtime.paid ? "Payment details" : "Practice mode"}</h3><div class="credit-balance"><b>${runtime.paid ? (me ? money(me.reserved || 0) : "CONNECT WALLET") : me ? money(me.balance) : "1,000"}</b><span>${runtime.paid ? (me ? "RESERVED FOR CHALLENGES" : "REQUIRED TO PAY") : me ? "AVAILABLE CREDITS" : "STARTING CREDITS"}</span></div><p>${runtime.paid ? (me ? "Connected wallet: confirm the entry or reward transaction shown by Tempo Wallet." : "Connect Tempo Wallet before creating or entering a paid challenge.") : me ? money(me.reserved) + " reserved in your challenges" : "Create a local profile to practice without money."}</p><div class="credit-rules"><p><b>Creator</b><span>Sets the entry, reward, arena, and build limits.</span></p><p><b>Player</b><span>Pays the entry, then sees the full opponent and starts the build timer.</span></p><p><b>Fee</b><span>2.5% of a winning reward. The remaining 97.5% goes to the winner.</span></p></div></aside></section><button id="show-challenge-guide" class="guide-reopen" type="button" ${guideDismissed ? "" : "hidden"}>Show how it works</button>`;
      app.innerHTML =
        header(
          "CHOOSE A CHALLENGE.",
          "Review the rules, then create or join a challenge.",
        ) +
        `<div class="bounty-board-layout"><aside class="bounty-guide-side">${guide}</aside><section class="bounty-board-main"><div class="contract-filter"><div class="segmented">${[
          ["open", "Available"],
          ["mine", "My bounties"],
          ["saved", "Saved"],
          ["completed", "History"],
        ]
          .map(
            ([v, t]) =>
              `<button data-filter="${v}" class="${v === filter ? "active" : ""}">${t}</button>`,
          )
          .join(
            "",
          )}</div><button id="refresh-contracts">⟳ Refresh board</button></div><div class="contract-search"><input id="contract-search" type="search" aria-label="Search bounties" placeholder="Search machines or bounties" value="${esc(searchText)}"><select id="arena-filter" aria-label="Filter bounties by arena"><option value="">All arenas</option>${ARENAS.map((a) => `<option value="${a.id}" ${a.id === arenaFilter ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select><input id="fee-filter" type="number" min="0" step="${runtime.paid ? ".01" : "1"}" aria-label="Maximum entry fee" placeholder="Max entry · any" value="${esc(feeFilter)}"></div><div class="contract-grid" id="contract-grid"></div><button id="load-more-contracts" type="button" hidden>Load more challenges</button><div class="notice bounty-footnote">${runtime.paid ? "Construction limits are separate from the reward. A paid run locks both machines, the arena, terrain and rules. A fresh seed decides the match." : "Construction limits are separate from the reward. A paid run locks both machines, the arena, terrain and rules. A fresh seed decides the match. Local simulation never pays rewards."}</div></section></div>`;
      if (runtime.paid) {
        const feeInput = $("#fee-filter");
        if (feeInput) feeInput.step = "0.01";
      }
      // Board actions remain available when the optional guide is collapsed.
      const boardActions = document.createElement("div");
      boardActions.className = "bounty-board-actions";
      boardActions.append($("#new-contract"), $("#my-history"), $("#show-challenge-guide"));
      $(".bounty-board-layout").before(boardActions);
      const guidePanel = $("#challenge-guide"),
        closeGuide = $("#close-challenge-guide"),
        showGuide = $("#show-challenge-guide");
      if (closeGuide)
        closeGuide.onclick = () => {
          guideDismissed = true;
          save(GUIDE_DISMISSED_KEY, true);
          guidePanel.hidden = true;
          showGuide.hidden = false;
        };
      if (showGuide)
        showGuide.onclick = () => {
          guideDismissed = false;
          save(GUIDE_DISMISSED_KEY, false);
          guidePanel.hidden = false;
          showGuide.hidden = true;
        };
      const scopeRows = new Map([["public", data]]),
        scopeCursors = new Map([["public", getCache.get(`${boardRequestScope}:/bounties`)?.nextCursor || null]]),
        scopeLoading = new Set();
      const activeScope = () => boardScopeForFilter(filter, runtime.paid, !!me);
      const loadScope = async (scope, more = false) => {
        if (scopeLoading.has(scope) || (more && !scopeCursors.get(scope))) return;
        scopeLoading.add(scope);
        draw();
        try {
          const page = await boardPage(scope, more ? scopeCursors.get(scope) : null);
          if (g !== generation) return;
          const previous = more ? scopeRows.get(scope) || [] : [];
          const known = new Set(previous.map((row) => row.id));
          scopeRows.set(scope, [...previous, ...page.items.filter((row) => !known.has(row.id))]);
          scopeCursors.set(scope, page.nextCursor);
          if (scope === "saved") for (const row of page.items) savedIds.add(row.id);
        } catch (error) {
          if (g === generation) adapter.toast(error.message || "Board page could not load.");
        } finally {
          scopeLoading.delete(scope);
          if (g === generation) draw();
        }
      };
      const draw = () => {
        const scope = activeScope();
        const rows = scopeRows.get(scope) || [];
        const shown = rows.filter(
          (b) =>
            (filter === "mine"
              ? b.owner === me?.id
              : filter === "saved"
                ? savedIds.has(b.id)
              : filter === "open"
                  ? !isLegacyV5(b) && ["open", "busy"].includes(b.status) && !bountyExpired(b)
                  : !["open", "busy"].includes(b.status) || bountyExpired(b) || isLegacyV5(b)) &&
            (!arenaFilter || bountyArena(b).id === arenaFilter) &&
            (feeFilter === "" || b.entry <= +feeFilter) &&
            (!searchText ||
              (b.title + " " + b.ownerName)
                .toLowerCase()
                .includes(searchText.toLowerCase())),
        ).sort((a, b) => {
          const stamp = (item) => {
            const value = item.created || item.updated || 0;
            return typeof value === "number" ? value : Date.parse(value) || 0;
          };
          return stamp(b) - stamp(a);
        });
        $("#contract-grid").innerHTML = shown.length
          ? shown.map(card).join("")
          : `<div class="bounty-empty">${scopeLoading.has(scope) ? "Loading challenges…" : runtime.paid && !me && filter !== "open" ? "Connect a wallet to view your private challenges." : "No bounties in this view."}</div>`;
        const next = $("#load-more-contracts");
        next.hidden = !scopeCursors.get(scope);
        next.disabled = scopeLoading.has(scope);
        drawThumbs(shown);
        $$("[data-contract]").forEach(
          (b) => (b.onclick = () => open(b.dataset.contract)),
        );
      };
      draw();
      wireHeader();
      accountUpdate = () => {
        if (g === generation) refreshHeaderAccount();
      };
      // Add account-owned and saved state after the first board paint. This
      // keeps the board usable while auth/bookmark storage catches up.
      void meRequest.then(async () => {
        const saved = me ? await api("/me/bookmarks").catch(() => []) : [];
        savedIds = new Set(saved.map((b) => b.id));
        if (g !== generation) return;
        refreshHeaderAccount();
        draw();
        const scope = activeScope();
        if (scope !== "public" && !scopeRows.has(scope)) void loadScope(scope);
      });
      $("#contract-search").oninput = (e) => {
        searchText = e.target.value;
        draw();
      };
      $("#arena-filter").onchange = (e) => {
        arenaFilter = e.target.value;
        draw();
      };
      $("#fee-filter").oninput = (e) => {
        feeFilter = e.target.value;
        draw();
      };
      $$("[data-filter]").forEach(
        (b) =>
          (b.onclick = () => {
            filter = b.dataset.filter;
            $$("[data-filter]").forEach((t) =>
              t.classList.toggle("active", t === b),
            );
            draw();
            const scope = activeScope();
            if (scope !== "public" && !scopeRows.has(scope)) void loadScope(scope);
          }),
      );
      $("#load-more-contracts").onclick = () => void loadScope(activeScope(), true);
      $("#new-contract").onclick = () =>
        runtime.paid || me ? create() : profile();
      $("#my-history").onclick = history;
      $("#refresh-contracts").onclick = () => open();
    } catch (e) {
      if (g !== generation) return;
      const missing = id && e.status === 404;
      const message = missing
        ? "This challenge is no longer in the app database. Older escrow records were removed during the V6 cleanup; this did not change any on-chain escrow."
        : e.message;
      app.innerHTML =
        header(missing ? "CHALLENGE NOT FOUND." : "BOUNTIES UNAVAILABLE.", esc(message)) +
        `<section class="panel bounty-empty"><p>${esc(message)}</p><button id="retry-contracts">Try again</button><button id="offline-workshop">Back to workshop</button>${e.status === 401 ? '<button id="reset-profile">Use a different profile key</button>' : ""}</section>`;
      wireHeader();
      $("#retry-contracts").onclick = () => open(id);
      $("#offline-workshop").onclick = adapter.workshop;
      if ($("#reset-profile")) $("#reset-profile").onclick = profile;
    }
  }
  function detail(b, g) {
    const paymentPaused = runtime.paid && runtime.paymentHealth?.fresh === true && !runtime.acceptingNewBounties;
    const revealed = !!b.blueprint,
      s = scout(b),
      a = bountyArena(b),
      legacyV5 = isLegacyV5(b),
      lockedRules = bountyRules(b),
      draft = adapter.getBuild(),
      issues = validate(draft.machine, lockedRules),
      own = b.owner === me?.id,
      m = revealed ? unpackChallenge(b.blueprint, true).machine : null;
    const deadlinePassed = !!b.expires && Number(b.expires) <= Date.now(),
      isExpired = deadlinePassed && b.status === "open",
      canEnter = !legacyV5 && b.status === "open" && !isExpired && !own,
      counterStatus = revealed
        ? issues.length
          ? esc(issues[0])
          : stats(draft.machine).cost +
            " build credits · eligible for this bounty"
        : legacyV5
          ? "Legacy V5 challenge is read-only while V6 is active."
          : "Pay the entry to reveal the opponent, then build and submit your machine before the deadline.",
      preview = revealed
        ? '<canvas id="defender-preview" width="650" height="500" aria-label="Opponent machine preview"></canvas>'
        : sealedPreview(b),
      defenderCaption = revealed
        ? `<h2>${esc(m.name)}</h2><p>${s.cost} build credits · ${s.mass} t · ${s.parts} fitted parts · ${s.height} ${s.height === 1 ? "level" : "levels"}</p><span>${esc(m.tactic)} · targets ${esc(m.target)} · range ${m.range} · front ${["north", "east", "south", "west"][m.front || 0]}</span>`
        : `<h2>Opponent hidden</h2><p>${s.cost} build credits · ${s.mass} t · ${s.parts} fitted parts · ${s.weapons} weapons · ${s.height} ${s.height === 1 ? "level" : "levels"}</p><span>${legacyV5 ? "Legacy V5 challenge is read-only while V6 is active." : "The full layout, colors and movement settings appear after payment is confirmed."}</span>`,
      defenderActions = revealed
        ? `<button id="inspect-defender" ${!b.compatible ? "disabled" : ""}>◎ View machine in 3D</button><button id="export-defender">↓ Blueprint JSON</button>`
        : legacyV5
          ? '<span class="sealed-note">LEGACY V5 · HISTORICAL CHALLENGE</span>'
          : '<span class="sealed-note">PAY TO REVEAL · MACHINE HIDDEN</span>',
      legacyNotice = legacyV5
        ? '<div class="notice fee-disclosure legacy-bounty-notice"><strong>LEGACY V5 · READ ONLY</strong><br>Existing V5 challenge; new entries are closed while V6 is active.</div>'
        : "",
      entryAction =
        canEnter
          ? `<button id="official-entry" class="primary contract-enter" ${!b.compatible || (!runtime.paid && !me) || paymentPaused ? "disabled" : ""}>${paymentPaused ? "Paid entries paused" : `Pay ${b.entry} ${paymentUnit()} · Reveal opponent`}</button>`
          : legacyV5
            ? legacyNotice
          : isExpired && b.status === "open"
            ? '<div class="notice fee-disclosure"><strong>Entry closed.</strong> This bounty has expired and cannot accept a new payment.</div>'
          : b.status === "busy" && revealed && !own
            ? '<button id="resume-attempt" class="primary contract-enter">Resume paid challenge</button>'
          : "",
      busyExpiryNotice =
        !legacyV5 && deadlinePassed && b.status === "busy"
          ? '<div class="notice fee-disclosure"><strong>Active paid attempt.</strong> The bounty deadline passed, but this paid run must finish or be finalized before the reward can be closed.</div>'
          : "",
      participantPrompt =
        canEnter
          ? `<div class="participant-prompt"><div class="participant-prompt-heading"><strong>Add your name</strong><span>Optional</span></div><p>Add an optional name for the results board. Leave it blank to appear as Anonymous engineer.</p><label class="field"><span>Your name or machine name</span><input id="participant-name" maxlength="28" placeholder="e.g. Nova or ByteForge" autocomplete="nickname"></label>${runtime.paid ? '<label class="identity-check"><input id="participant-show-address" type="checkbox"><span>Show my shortened wallet address on this attempt</span></label><p class="hint">Your wallet still authorizes the payment. The address stays hidden unless you opt in.</p>' : '<p class="hint">This name appears on the local attempt board. Your profile remains private.</p>'}</div>`
          : "";
    const completionNotice =
        b.status === "completed"
          ? `<div class="notice fee-disclosure"><strong>Completed.</strong> The defense held, so the reward remains available for the creator to return. This replay and result stay on the board for 10 minutes.</div>`
          : b.status === "claimed"
            ? `<div class="notice fee-disclosure"><strong>Reward paid.</strong> Your machine won and the escrow sent the payout. This replay and result stay on the board for 10 minutes.</div>`
            : "",
      returnAction =
        !legacyV5 && own && ["open", "completed"].includes(b.status)
          ? `<button id="cancel-contract">${b.status === "completed" ? "Return unclaimed reward" : "Delete bounty"} · return ${b.reward} ${runtime.currency}</button>`
          : "";
    app.innerHTML =
      header(
        revealed ? "BUILD YOUR MACHINE." : "VIEW THE CHALLENGE.",
        esc(b.title),
      ) +
      `<div class="contract-detail"><section class="panel defender-card"><div class="contract-card-top">${status(bountyCardState(b))}<small>${bountyAvailabilityLabel(b, ["completed", "claimed"].includes(b.status))}</small></div>${preview}<div class="defender-caption">${defenderCaption}</div><div class="bounty-actions">${defenderActions}<button id="copy-contract">↗ Copy challenge link</button><button id="save-contract">${savedIds.has(b.id) ? "★ Saved challenge" : "☆ Save challenge"}</button>${navigator.share ? '<button id="native-share-contract">Share…</button>' : ""}</div></section><section class="panel contract-terms"><span class="eyebrow">${esc(b.ownerName)} / CHALLENGE TERMS</span><h2>${esc(b.title)}</h2><div class="contract-economy"><div><b>${money(b.reward)}</b><small>GROSS REWARD · ${esc(paymentUnit())}</small></div><div><b>${money(b.entry)}</b><small>ENTRY COST · ${esc(paymentUnit())}</small></div><div><b>${signed(b.netIfWin)}</b><small>NET BEFORE NETWORK/SWAP FEES · ${esc(paymentUnit())}</small></div></div>${feeNotice(b)}${completionNotice}<div class="contract-rule"><strong>${esc(a.name)}</strong><p>${esc(a.desc)}</p>${terrain(a)}</div><div class="contract-rule"><strong>${esc(rulesLabel(lockedRules))}</strong><p>Both machines use the same locked rules and fight automatically for up to 100 seconds.</p></div><div class="contract-rule"><strong>Your machine: ${esc(draft.machine.name)}</strong><p>${counterStatus}</p></div>${revealed ? `<div class="bounty-actions"><button id="refit-counter" ${!b.compatible ? "disabled" : ""}>Edit your machine</button>${runtime.paid ? "" : '<button id="local-simulation">Local simulation</button>'}</div>` : ""}${entryAction}${busyExpiryNotice}${!runtime.paid && !me ? '<button id="join-profile">Sign in to enter this sandbox challenge</button>' : ""}<p class="hint">${legacyV5 ? "Existing V5 challenge; new entries are closed while V6 is active." : revealed ? runtime.paid ? "Your entry is active. Submit a valid machine before the timer ends." : "This local challenge can be tested without transferring funds." : paymentPaused ? runtime.settlementReason : runtime.paid ? `Pay the entry in Tempo Wallet. Once it confirms, the full opponent appears and the build timer starts. The entry is ${b.entry} ${paymentUnit()}; construction limits use ${constructionUnit()}.` : "Your entry uses sandbox credits. Construction credits are separate from any live pathUSD payment."} ${own ? "You cannot claim your own reward." : ""}</p><p class="error-message" id="bounty-error">${!b.compatible ? "This challenge uses an older engine version. Its result remains available, but you cannot submit a new machine." : ""}</p><p class="contract-expiry">${legacyV5 ? "Read-only historical challenge" : b.expires ? (deadlinePassed && b.status === "busy" ? "Bounty deadline passed · active attempt continues" : isExpired ? "Expired " : "Expires ") + time(b.expires) : "No deadline · until claimed or closed"} · ${b.attempts} runs<br>${b.listed ? "Visible on the board" : legacyV5 ? "Unlisted: anyone with the link can view." : "Unlisted: anyone with the link can view and pay the posted entry."}</p>${returnAction}${!legacyV5 && me && isExpired && b.status === "open" ? '<button id="expire-contract">Settle expiry onchain</button>' : ""}</section></div><section class="panel contract-history"><h3>Past results</h3>${b.history.length ? b.history.map((a) => (revealed ? `<button data-attempt="${a.id}" class="attempt-row"><span>${a.result ? esc(a.result.outcome.toUpperCase()) : a.status === "technical-retry" ? "TECHNICAL RECOVERY" : "RESULT PENDING"}</span><small>${time(a.created)}</small><strong>${a.result?.time ? Number(a.result.time).toFixed(1) + "s" : a.status === "technical-retry" ? "Sponsored retry available" : "Settlement pending"} ↗</strong></button>` : `<div class="attempt-row"><span>${a.result ? esc(a.result.outcome.toUpperCase()) : a.status === "technical-retry" ? "TECHNICAL RECOVERY" : "RESULT PENDING"}</span><small>${time(a.created)}</small><strong>Opponent replay sealed</strong></div>`)).join("") : hasPendingBountyResult(b) ? "<p>Result recorded. Settlement confirmation is still pending.</p>" : b.status === "busy" ? "<p>An attempt is in progress. Its signed result will appear here after settlement verification.</p>" : "<p>No results yet. Be the first to try.</p>"}</section>`;
    if (participantPrompt) {
      const template = document.createElement("template");
      template.innerHTML = participantPrompt;
      $("#official-entry")?.before(template.content.firstElementChild);
    }
    $$(".contract-history .attempt-row").forEach((row, index) => {
      const attempt = b.history[index];
      const first = row.querySelector("span");
      if (!attempt || !first) return;
      first.innerHTML = `${attemptIdentity(attempt)}<small class="attempt-outcome">${esc(attempt.result ? attempt.result.outcome.toUpperCase() : "REFUNDED")}</small>`;
    });
    if (revealed) thumb($("#defender-preview"), b.blueprint);
    wireHeader();
    if ($("#refit-counter"))
      $("#refit-counter").onclick = () => adapter.edit(b);
    if ($("#inspect-defender"))
      $("#inspect-defender").onclick = () => adapter.scout(b);
    if ($("#local-simulation"))
      $("#local-simulation").onclick = () => adapter.practice(b);
    $("#save-contract").onclick = (e) => {
      if (!me) {
        void profile();
        return;
      }
      void act(e.currentTarget, async () => {
        await api(
          "/me/bookmarks/" + b.id,
          savedIds.has(b.id) ? "DELETE" : "PUT",
        );
        await open(b.id);
      });
    };
    $("#copy-contract").onclick = () =>
      copy(location.origin + location.pathname + "#bounty=" + b.id);
    if ($("#export-defender"))
      $("#export-defender").onclick = () =>
        download(b.blueprint, m.name + "-defender.json");
    if ($("#native-share-contract"))
      $("#native-share-contract").onclick = () =>
        navigator
          .share({
            title: b.title,
            text: "Can you beat this War Machines bounty?",
            url: location.origin + location.pathname + "#bounty=" + b.id,
          })
          .catch((e) => {
            if (e.name !== "AbortError")
              adapter.toast("Use Copy bounty link to share.");
          });
    if ($("#official-entry"))
      $("#official-entry").onclick = (e) =>
        act(e.currentTarget, async () => {
          if (runtime.paid && !runtime.acceptingNewBounties) {
            await refreshPaymentReadiness();
            if (!runtime.acceptingNewBounties)
              throw Error(runtime.settlementReason || "Paid entries are paused.");
          }
          const participantName = $("#participant-name")?.value.trim() || "",
            showAddress = !!$("#participant-show-address")?.checked;
          const entry = runtime.paid
            ? {
                maxEntry: b.entry,
                maxPlatformFeeBps: b.platformFeeBps,
                participantName,
                showAddress,
              }
            : {
                blueprint: packChallenge(
                  adapter.getBuild().machine,
                  b.blueprint.a,
                  0,
                  b.blueprint.q,
                  adapter.getBuild().objective || "reactor",
                ),
                maxEntry: b.entry,
                maxPlatformFeeBps: b.platformFeeBps,
                participantName,
                showAddress,
              };
          const result = await mutate("/bounties/" + b.id + "/attempts", entry);
          await refreshMe();
          await attempt(result.id);
        });
    if ($("#resume-attempt"))
      $("#resume-attempt").onclick = () => attempt(b.activeAttempt);
    if ($("#join-profile")) $("#join-profile").onclick = profile;
    if ($("#cancel-contract"))
      $("#cancel-contract").onclick = (e) =>
        act(e.currentTarget, async () => {
          await mutate("/bounties/" + b.id + "/cancel", {});
          adapter.toast(
            "Bounty deleted. The unused reward returned to your wallet.",
          );
          await open();
        });
    if ($("#expire-contract"))
      $("#expire-contract").onclick = (e) =>
        act(e.currentTarget, async () => {
          await mutate("/bounties/" + b.id + "/expire", {});
          await open(b.id);
        });
    $$("[data-attempt]").forEach(
      (t) => (t.onclick = () => attempt(t.dataset.attempt)),
    );
    if (b.status === "busy")
      schedule(async () => {
        try {
          const fresh = await api("/bounties/" + b.id);
          if (g === generation) {
            current = fresh;
            await refreshMe();
            detail(fresh, g);
          }
        } catch (e) {
          adapter.toast(e.message);
        }
      }, g);
  }
  async function create() {
    if (runtime.paid && !runtime.acceptingNewBounties) {
      await refreshPaymentReadiness();
      if (!runtime.acceptingNewBounties)
        throw Error(runtime.settlementReason || "New paid bounties are paused.");
    }
    if (!me && !runtime.paid) return profile();
    const g = begin(),
      draft = adapter.getBuild();
    let build = clone(draft.machine),
      customCaps = { ...draft.rules };
    app.innerHTML =
      header(
        "SET THE CHALLENGE.",
        "Fund a reward. Share your machine. See who can break it.",
      ) +
      `<form id="create-contract" class="contract-create"><section class="panel create-preview"><canvas id="create-preview" width="480" height="420" aria-label="Your machine"></canvas><h2>${esc(build.name)}</h2><p id="create-stats"></p><p class="hint">This saves your current machine, including its paint, front, upgrades, height and behavior.</p><button type="button" id="back-build">Edit in workshop</button></section><section class="panel contract-form"><label class="field"><span>Challenge title</span><input id="contract-title" required maxlength="70" value="${esc("Challenge " + build.name)}"></label><div class="form-two"><label class="field"><span>Entry · ${runtime.paid ? "pathUSD" : "sandbox credits"}</span><input id="contract-entry" type="number" min="${runtime.paid ? ".01" : "0"}" max="1000000000" step="${runtime.paid ? ".01" : "1"}" value="${runtime.paid ? ".10" : "10"}" required></label><label class="field"><span>Gross reward · ${runtime.paid ? "pathUSD" : "sandbox credits"}</span><input id="contract-reward" type="number" min="${runtime.paid ? ".01" : "0"}" max="1000000000" step="${runtime.paid ? ".01" : "1"}" value="${runtime.paid ? "1.00" : "100"}" required></label></div><div class="notice" id="reserve-note"></div><div class="form-two"><label class="field"><span>Arena & terrain</span><select id="contract-arena">${ARENAS.map((a) => `<option value="${a.id}" ${a.id === draft.arena ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label><label class="field"><span>Construction class</span><select id="contract-class"><option value="standard">Standard · 1200 credits</option><option value="custom">Custom limits</option><option value="unlimited">Unlimited · 243 sockets</option></select></label></div><div id="contract-terrain" class="notice"></div><div class="form-four" id="contract-caps">${[
        ["credits", "Construction credits", 1200, 1000000],
        ["parts", "Part count", 32, 243],
        ["mass", "Mass (tonnes)", 360, 100000],
        ["weapons", "Weapon count", 8, 243],
      ]
        .map(
          ([k, n, v, max]) =>
            `<label class="field"><span>${n}</span><input data-cap="${k}" type="number" step="1" min="0" max="${max}" value="${draft.rules[k] ?? 0}" required></label>`,
        )
        .join(
          "",
        )}</div><p class="hint">Custom cap 0 = no limit. Unlimited removes all four caps. Supports and the 9×9×3 grid still apply.</p><div class="form-two"><label class="field"><span>Duration · hours (0 = no deadline)</span><input id="contract-hours" type="number" min="0" max="8760" step="1" value="24" required></label><label class="field"><span>Sharing</span><select id="contract-listed"><option value="true">Listed on bounty board</option><option value="false">Unlisted · share by link</option></select></label></div><p class="hint">New bounties appear on the board by default. Choose unlisted when you want access by link only. Anyone with an unlisted link can view this challenge. Any Tempo Wallet can pay the posted entry and try the challenge. Terms lock after funding. Close an idle bounty to return its unused reward.</p><p id="bounty-error" class="error-message" role="status"></p><button class="primary contract-enter" id="fund-contract" type="submit">Fund & create challenge</button></section></form>`;
    if (runtime.paid) {
      const entryInput = $("#contract-entry"),
        rewardInput = $("#contract-reward");
      if (entryInput) {
        entryInput.min = "0.01";
        entryInput.step = "0.01";
        entryInput.value = "0.01";
      }
      if (rewardInput) {
        rewardInput.min = "0.01";
        rewardInput.step = "0.01";
      }
    }
    wireHeader();
    adapter.thumbnail($("#create-preview"), build);
    $("#contract-class").value = ["standard", "unlimited"].includes(
      draft.rules.mode,
    )
      ? draft.rules.mode
      : "custom";
    const rules = () => {
      const mode = $("#contract-class").value;
      return normalizeRules(
        mode === "standard"
          ? DEFAULT_RULES
          : {
              mode,
              combat: "auto",
              ...Object.fromEntries(
                $$("[data-cap]").map((e) => [e.dataset.cap, +e.value || null]),
              ),
            },
      );
    };
    const update = () => {
      try {
        const r = rules(),
          issues = validate(build, r),
          entryText = $("#contract-entry").value,
          rewardText = $("#contract-reward").value,
          entry = +entryText,
          reward = +rewardText,
          a = ARENAS.find((a) => a.id === $("#contract-arena").value);
        if (
          runtime.paid &&
          (!/^\d+(?:\.\d+)?$/.test(entryText) ||
            !/^\d+(?:\.\d+)?$/.test(rewardText))
        )
          issues.push(
            "Enter entry and reward as decimals such as 0.10 or 1.00 pathUSD. Do not use commas, scientific notation, or currency symbols.",
          );
        else if (runtime.paid && (!(entry >= 0.01) || !(reward >= 0.01)))
          issues.push(
            "Mainnet bounties use a minimum of 0.01 pathUSD for entry and reward.",
          );
        $$("[data-cap]").forEach((e) => {
          e.disabled = r.mode !== "custom";
          if (e.disabled) e.value = r[e.dataset.cap] ?? 0;
        });
        $("#create-stats").textContent =
          stats(build).cost +
          " build credits · " +
          stats(build).parts +
          " parts · " +
          stats(build).mass +
          " t";
        const quote = rewardQuote(reward, entry, currentFeeBps),
          available = runtime.paid
            ? "One Tempo Wallet confirmation atomically approves pathUSD and funds the exact gross reward."
            : `${money(me.balance - reward)} sandbox credits available afterward.`;
        $("#reserve-note").textContent =
          `${money(reward)} ${paymentUnit()} gross reward. ${available} Platform fee: ${money(currentFeeBps / 100)}% of a winning reward (${money(quote.platformFee)} ${paymentUnit()}). Winner receives ${money(quote.payout)} ${paymentUnit()}; net before network/swap fees after entry: ${signed(quote.netIfWin)} ${paymentUnit()}. Wallet network fees and any input-token swap costs are separate. Construction credits only set the machine budget.`;
        $("#contract-terrain").innerHTML = esc(a.desc) + terrain(a);
        if (!runtime.paid && reward > me.balance)
          issues.push(
            "Not enough available sandbox credits to fund this reward.",
          );
        $("#bounty-error").textContent = issues.join(" ");
        $("#fund-contract").disabled = !!issues.length;
      } catch (e) {
        $("#bounty-error").textContent = e.message;
        $("#fund-contract").disabled = true;
      }
    };
    $("#create-contract").oninput = (e) => {
      if (e.target.dataset.cap)
        customCaps[e.target.dataset.cap] = +e.target.value || null;
      if (e.target.id !== "contract-class") update();
    };
    $("#create-contract").onchange = (e) => {
      if (e.target.id === "contract-class")
        $$("[data-cap]").forEach(
          (input) => (input.value = customCaps[input.dataset.cap] ?? 0),
        );
      update();
    };
    update();
    $("#back-build").onclick = adapter.workshop;
    $("#create-contract").onsubmit = (e) => {
      e.preventDefault();
      void act($("#fund-contract"), async () => {
        const body = {
            maxPlatformFeeBps: currentFeeBps,
            title: $("#contract-title").value,
            blueprint: packChallenge(
              build,
              $("#contract-arena").value,
              0,
              rules(),
              draft.objective || "reactor",
            ),
            entry: runtime.paid
              ? $("#contract-entry").value
              : +$("#contract-entry").value,
            reward: runtime.paid
              ? $("#contract-reward").value
              : +$("#contract-reward").value,
            hours: +$("#contract-hours").value,
            listed: $("#contract-listed").value === "true",
          },
          b = await mutate("/bounties", body);
        if (g === generation) await open(b.id);
      });
    };
  }
  async function deployCounter(id, savedBlueprint) {
    const a = await api("/attempts/" + id);
    if (a.status !== "engineering") {
      await attempt(a.id);
      return;
    }
    if (!a.defender)
      throw Error(
        "The opponent reveal is unavailable. Reopen this challenge with the wallet that paid the entry.",
      );
    const source = savedBlueprint
        ? unpackChallenge(savedBlueprint, true)
        : adapter.getBuild(),
      blueprint = packChallenge(source.machine, a.defender.a, 0, a.defender.q, source.objective || a.defender.objective || "reactor");
    let deployed;
    try {
      deployed = await api(
        "/attempts/" + a.id + "/deploy",
        "POST",
        { blueprint },
        uid(),
      );
    } catch (error) {
      if (
        error.status === 409 &&
        /already deployed|different committed counter/i.test(error.message)
      ) {
        await attempt(a.id);
        return;
      }
      throw error;
    }
    await attempt(deployed.id);
  }
  async function attempt(id) {
    const g = begin();
    let polling = false,
      nextAccountRefresh = 0,
      lastAccountState = "";
    app.innerHTML =
      header(
        "PAID RESULT.",
        "The deterministic arena result is settled by the verified Tempo escrow.",
      ) + '<div class="bounty-loading">Loading attempt…</div>';
    wireHeader();
    async function watchOfficialReplay(a) {
      const catalog = await api("/rules");
      currentFeeBps = catalog.economics.platformFee.basisPoints;
      if (catalog.versions.hash !== CLIENT_ENGINE_HASH)
        throw Error(
          "Reload this tab to load the current simulation before replaying.",
        );
      if (catalog.versions.hash !== a.replay?.versions?.hash)
        throw Error(
          "This replay belongs to an archived engine version; its receipt remains available.",
        );
      adapter.replay(a, await api("/bounties/" + a.bounty));
    }
    async function autoplayOfficialReplay(a) {
      if (!a.replay || !["win", "loss", "draw"].includes(a.result?.outcome))
        return false;
      if (officialReplayPlayed.has(a.id)) return false;
      const replayKey =
        "wm-watched-official-replay-" +
        a.id +
        ":" +
        (a.escrowSettlement?.resultHash ||
          a.result?.settlement?.resultHash ||
          "result");
      try {
        if (sessionStorage.getItem(replayKey) === "1") return false;
        sessionStorage.setItem(replayKey, "1");
      } catch {
        // Private browsing may deny session storage. The replay can still run.
      }
      try {
        officialReplayPlayed.add(a.id);
        await watchOfficialReplay(a);
        return true;
      } catch (error) {
        officialReplayPlayed.delete(a.id);
        try {
          sessionStorage.removeItem(replayKey);
        } catch {}
        adapter.toast(error.message || "The replay is unavailable.");
        return false;
      }
    }
    async function claimTechnicalRetry(a) {
      const retried = await api(
        "/attempts/" + a.id + "/retry",
        "POST",
        {
          participantName: a.participantName || null,
          showAddress: a.addressVisible === true,
        },
        uid(),
      );
      await attempt(retried.id);
    }
    function refreshAttemptAccount(a) {
      // Result rendering owns the fast path. Account/balance polling has a
      // separate cadence and is only accelerated for a payment transition.
      const state = `${a.status}:${a.payment?.state || ""}:${a.result?.payoutStatus || ""}`;
      const now = Date.now();
      if (state === lastAccountState && now < nextAccountRefresh) return;
      lastAccountState = state;
      nextAccountRefresh = now + 30_000;
      void refreshMe({ skipWallet: true }).catch(() => {});
    }
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const a = await api("/attempts/" + id);
        if (g !== generation) return;
        refreshAttemptAccount(a);
        if (a.status === "engineering") {
          const remaining = Math.max(
              0,
              Number(a.build?.deadline || 0) - Date.now(),
            ),
            seconds = Math.ceil(remaining / 1000),
            clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
            defender = a.defender
              ? {
                  id: a.bounty,
                  title: a.bountyTitle,
                  blueprint: a.defender,
                  attemptId: a.id,
                  buildDeadline: Number(a.build?.deadline || 0),
                  escrowAttemptDeadline: Number(a.escrowAttemptDeadline || 0),
                }
              : null;
          if (!defender)
            throw Error(
              "The opponent reveal is unavailable. Reopen this challenge with the wallet that paid the entry.",
            );
          if (!seconds) {
            app.innerHTML =
              header(
                "BUILD WINDOW CLOSED.",
                "No machine was submitted before the deadline.",
              ) +
              paymentPanel(a) +
              '<button id="pending-contract">View challenge</button>';
            wireHeader();
            $("#pending-contract").onclick = () => open(a.bounty);
            schedule(poll, g, 5000);
            return;
          }
          app.innerHTML =
            header(
              "OPPONENT READY.",
              "Build and test your machine, then submit it before the timer ends.",
            ) +
            `<section class="panel trial-wait"><span class="eyebrow">ENTRY CONFIRMED · OPPONENT REVEALED</span><h2>${clock} to submit.</h2><p><strong>${esc(defender.title)}</strong> is now available for your timed build. The verified escrow keeps enough time to record the result after you submit.</p><div class="notice fee-disclosure"><strong>No second payment is required.</strong><br>Build limit: ${esc(rulesLabel(defender.blueprint.q))} · Arena: ${esc(bountyArena({ blueprint: defender.blueprint }).name)} · Your entry remains in the direct escrow until the signed result settles.</div><div class="bounty-actions"><button id="refit-counter" class="primary">Build your machine</button><button id="select-counter">Use a saved build</button><button id="deploy-counter">Submit current machine</button><button id="pending-contract">View challenge</button></div><p id="bounty-error" class="error-message"></p></section>`;
          wireHeader();
          $("#refit-counter").onclick = () => adapter.edit(defender);
          $("#select-counter").onclick = () => vault(a.id);
          $("#pending-contract").onclick = () => open(a.bounty);
          $("#deploy-counter").onclick = (e) =>
            act(e.currentTarget, () => deployCounter(a.id));
          schedule(poll, g, 1000);
          return;
        }
        if (["queued", "running"].includes(a.status)) {
          if (a.replay && !officialReplayPlayed.has(a.id)) {
            officialReplayPlayed.add(a.id);
            try {
              await watchOfficialReplay(a);
            } catch (error) {
              officialReplayPlayed.delete(a.id);
              throw error;
            }
            return;
          }
          app.innerHTML =
            header(
              "RESULT IN PROGRESS.",
              "The official battle is complete or being finalized. Settlement will open here automatically.",
            ) +
            `<section class="panel trial-wait compact-result"><div class="trial-spinner" aria-hidden="true">◈</div><span class="eyebrow">${a.status === "queued" ? "QUEUED FOR SETTLEMENT" : "FINALIZING RESULT"}</span><h2>Preparing your result.</h2><p>Do not pay again. This page will switch to the result as soon as the escrow record is ready.</p><button id="pending-contract">View challenge</button></section>`;
          wireHeader();
          $("#pending-contract").onclick = () => open(a.bounty);
          schedule(poll, g, 1000);
          return;
        }
        if (["awaiting-signatures", "ready-to-settle"].includes(a.status)) {
          const r = a.result,
            s = a.escrowSettlement,
            expires = s?.validUntil
              ? Number(s.validUntil) * 1000 <= Date.now()
              : false,
            ready = a.status === "ready-to-settle",
            timeoutFinalizerReady =
              Number(a.escrowAttemptDeadline || 0) <= Date.now();
          if (await autoplayOfficialReplay(a)) return;
          app.innerHTML =
            header(
              ready ? "SETTLEMENT PENDING." : "RESULT.",
              ready
                ? "The signed result is recorded; the Tempo escrow is finalizing payment automatically."
                : "Your settlement continues automatically.",
            ) +
            paymentPanel(a) +
            `<section class="panel trial-wait ${ready ? "settlement-wait" : ""}"><span class="eyebrow">${ready ? "RESULT SIGNED · SETTLEMENT PENDING" : "RESULT RECORDED"}</span><h2>` +
            esc(r?.outcome?.toUpperCase() || "RESULT RECORDED") +
            `</h2><p>${ready ? "The official result is recorded and waiting for the escrow to finalize the payout. Do not pay again or resubmit a machine." : "The official result is recorded; settlement continues automatically."}</p><div class="bounty-actions">` +
            (a.replay
              ? '<button id="watch-official-replay">Watch exact battle</button>'
              : "") +
            '<button id="pending-contract">View challenge</button></div></section>';
          wireHeader();
          $("#pending-contract").onclick = () => open(a.bounty);
          if ($("#watch-official-replay"))
            $("#watch-official-replay").onclick = (e) =>
              act(e.currentTarget, () => watchOfficialReplay(a));
          schedule(poll, g, a.payment?.state === "timeout" ? 15000 : 2500);
          return;
        }
        if (await autoplayOfficialReplay(a)) return;
        const r = a.result,
          won = r?.outcome === "win",
          refunded = paymentIsRefunded(a),
          technical =
            r?.outcome === "technical-refund" ||
            r?.outcome === "technical-failure" ||
            r?.payoutStatus === "technical-retry" ||
            a.status === "technical-retry" ||
            a.status === "technical-refund" ||
            a.payment?.technicalFailure === true,
          infrastructure = technical,
          reopened = !!r && !won && !technical && !infrastructure && !refunded;
        app.innerHTML =
          header(
            "THE VERDICT.",
            r?.payoutStatus === "settled-onchain"
              ? "The Tempo escrow settled this result onchain."
              : r
                ? refunded
                  ? "The V6 escrow finalized the entry refund."
                  : technical
                  ? "The result needs technical recovery before another sponsored retry."
                  : "Recorded paid result."
                : "Payment status is still being reconciled.",
          ) +
          paymentPanel(a) +
          `<section class="panel official-result ${won ? "won" : ""}"><span class="eyebrow">${refunded ? "ENTRY REFUNDED" : r?.payoutStatus === "settled-onchain" ? "ESCROW SETTLED" : infrastructure ? "TECHNICAL RECOVERY" : "ON-CHAIN RESULT"}</span><h2>${won ? "REWARD PAID." : refunded ? "ENTRY REFUNDED." : infrastructure ? paymentIsV6(a) ? "V6 REFUND PENDING." : a.payment?.retryAvailable ? "SPONSORED RETRY AVAILABLE." : "RECOVERY IN PROGRESS." : reopened ? "OPPONENT SURVIVED — CHALLENGE OPEN." : "RESULT RECORDED."}</h2><div class="contract-economy"><div><b>${refunded ? "0" : technical ? "Pending" : r ? (Number(r.net) > 0 ? "+" : "") + r.net : "—"}</b><small>WALLET CASH DELTA · BEFORE FEES</small></div><div><b>${r?.time ? Number(r.time).toFixed(1) + "s" : "—"}</b><small>TRIAL DURATION</small></div><div><b>${refunded || r?.payoutStatus === "settled-onchain" ? "✓" : "—"}</b><small>ESCROW FINALITY</small></div></div><p>${refunded ? "The V6 escrow verified and finalized the entry refund. The returned entry is shown separately from network or swap fees." : infrastructure ? paymentIsV6(a) ? "The V6 technical refund is not finalized yet. Do not pay again; this path does not offer a sponsored retry." : "The signed result missed the settlement window. Your original entry was not returned by this technical recovery path; the bounty reopened for one sponsored retry. Do not pay the entry again." : r?.integrity ? `Your machine: ${(r.integrity[0] * 100).toFixed(1)}% · Opponent: ${(r.integrity[1] * 100).toFixed(1)}%. ${won ? "The payout was sent by the escrow after the 2.5% platform fee." : reopened ? "Your entry was paid to the creator. The reward stays funded and the challenge is open for another player." : "The escrow processed this result."}` : esc(a.error || "Payment status is still being reconciled.")}</p>${r ? paymentBreakdown(a, paymentUnit()) : ""}<div class="bounty-actions">${!refunded && !paymentIsV6(a) && a.payment?.retryAvailable ? '<button id="retry-free" class="primary">Start sponsored retry</button>' : ""}${a.replay ? '<button id="verified-replay" class="primary">▶ Watch exact replay</button>' : ""}<button id="result-contract">${reopened ? "View reopened bounty" : "Back to challenge"}</button><button id="result-refit">Edit your machine</button></div><p class="hint">Attempt ${esc(a.id)} · ${time(a.updated)}<br>The replay reconstructs the committed machine pair, arena, terrain, seed and engine release. Network fees and swap costs are separate from the wallet cash delta.</p><p id="bounty-error" class="error-message"></p></section>`;
        const identityNotice = document.createElement("div");
        identityNotice.className = "result-identity";
        identityNotice.innerHTML = `This run appears as ${attemptIdentity(a)}`;
        $(".official-result .hint")?.before(identityNotice);
        wireHeader();
        $("#result-contract").onclick = () => open(a.bounty);
        $("#result-refit").onclick = (e) =>
          act(e.currentTarget, async () => {
            const b = await api("/bounties/" + a.bounty);
            if (!b.compatible)
              throw Error(
                "This bounty uses an archived engine. Export its blueprint to adapt it in the workshop.",
              );
            adapter.edit(b);
          });
        if ($("#verified-replay"))
          $("#verified-replay").onclick = (e) =>
            act(e.currentTarget, () => watchOfficialReplay(a));
        if ($("#retry-free"))
          $("#retry-free").onclick = (e) =>
            act(e.currentTarget, () => claimTechnicalRetry(a));
      } catch (e) {
        if (g !== generation) return;
        app.innerHTML =
          header("RESULT PENDING.", friendlyPaymentError(e)) +
          '<section class="panel bounty-empty"><p>This run is still processing. Open My runs to check again.</p><button id="retry-attempt">Check again</button></section>';
        wireHeader();
        $("#retry-attempt").onclick = () => attempt(id);
        schedule(poll, g, 5000);
      } finally {
        polling = false;
      }
    }
    await poll();
  }
  async function history() {
    if (!me) return profile();
    const g = begin();
    app.innerHTML =
      header("YOUR TRIALS.", "Paid runs persist across reloads.") +
      '<div class="bounty-loading">Loading history…</div>';
    wireHeader();
    try {
      const rows = await api("/me/attempts");
      if (g !== generation) return;
      app.innerHTML =
        header("YOUR TRIALS.", "Paid runs persist across reloads.") +
        `<section class="panel contract-history">${rows.map((a) => `<button data-attempt="${a.id}" class="attempt-row"><span>${esc(runtime.paid ? paymentStatus(a).label : a.result?.outcome || a.status)}</span><small>${time(a.created)}</small><strong>${a.result?.net !== undefined ? esc(a.result.net) + (runtime.paid ? " pathUSD" : " credits") : "View status"} ↗</strong></button>${runtime.paid ? transactionLink(a.payment?.transactionHash, "Settlement transaction") : ""}`).join("") || "<p>No paid runs yet. Choose an available challenge to start.</p>"}</section>`;
      $$(".contract-history .attempt-row").forEach((row, index) => {
        const attempt = rows[index],
          first = row.querySelector("span");
        if (!attempt || !first) return;
        first.innerHTML = `${attemptIdentity(attempt)}<small class="attempt-outcome">${esc(runtime.paid ? paymentStatus(attempt).label : attempt.result?.outcome || attempt.status)}</small>`;
      });
      wireHeader();
      $$("[data-attempt]").forEach(
        (b) => (b.onclick = () => attempt(b.dataset.attempt)),
      );
    } catch (e) {
      adapter.toast(e.message);
    }
  }
  async function profile() {
    const returnId = location.hash.startsWith("#bounty=")
      ? location.hash.slice(8)
      : undefined;
    const g = begin();
    let configured;
    try {
      configured = await configureRuntime(await api("/rules"));
      await refreshMe();
    } catch (e) {
      adapter.toast(e.message);
    }
    if (runtime.mode === "tempo-mainnet" && !runtime.paid) {
      app.innerHTML =
        header(
          "TEMPO PAYMENTS ARE NOT LIVE.",
          "This site cannot accept a bounty payment until escrow configuration is complete.",
        ) +
        `<section class="panel profile-form"><span class="status-stamp">MAINNET ACTIVATION LOCKED</span><h2>Play locally while payments are configured.</h2><p>The workshop and local simulation are available. No wallet charge, reward funding, or bounty entry can occur until the payment backend reports ready.</p><button type="button" class="account-guest-link" id="continue-guest">Continue to guest workshop ↗</button></section>`;
      wireHeader();
      $("#continue-guest").onclick = adapter.workshop;
      return;
    }
    if (runtime.paid && !me) {
      app.innerHTML =
        header(
          "SAVED BUILDS & PRIVATE HISTORY.",
          "Creating or entering a bounty connects Tempo Wallet when you pay. This optional account view is for saved work and private history.",
        ) +
        `<section class="panel profile-form"><span class="status-stamp">TEMPO MAINNET · ${esc(runtime.currency)}</span><h2>Open your saved work.</h2><p class="sign-in-note">A wallet signature proves identity only. A bounty payment always shows its own pathUSD amount and recipient in Tempo Wallet before anything is sent.</p><button class="primary" id="tempo-wallet-login">Connect Tempo wallet for saves</button><button type="button" class="account-guest-link" id="continue-guest">Continue as guest ↗</button><p id="bounty-error" class="error-message"></p></section>`;
      wireHeader();
      $("#continue-guest").onclick = adapter.workshop;
      $("#tempo-wallet-login").onclick = (e) =>
        act(e.currentTarget, async () => {
          await (await ensureTempoClient()).signInWallet();
          await refreshMe();
          await profile();
        });
      return;
    }
    if (runtime.paid) {
      const wallet = me.payoutAddress || "your Tempo Wallet";
      app.innerHTML =
        header(
          "SAVED BUILDS & PRIVATE HISTORY.",
          "Private saves and completed trial history for " + wallet + ".",
        ) +
        `<div class="profile-grid"><section class="panel profile-form"><span class="status-stamp">TEMPO MAINNET · ${esc(runtime.currency)}</span><h2>Saved work</h2><p>Your build vault is private to this Tempo Wallet. It is separate from bounty payments.</p><button class="primary" id="open-vault">Open build vault</button><p class="hint">Local workshop saves continue to work without connecting a wallet.</p></section><section class="panel profile-form"><span class="eyebrow">BOUNTY RECORD</span><h2>Private history</h2><p>Open your verified runs and on-chain settlement records.</p><button id="open-history">View my runs</button><p class="hint">Each reward, entry and refund is confirmed by the escrow transaction shown in Tempo Wallet.</p></section></div><section class="panel profile-form"><span class="eyebrow">WALLET SESSION</span><p>Connected as ${esc(wallet)}. Disconnecting only clears this browser session; it never moves funds.</p><button id="tempo-wallet-logout">Disconnect wallet session</button></section>`;
      wireHeader();
      $("#open-vault").onclick = vault;
      $("#open-history").onclick = history;
      $("#tempo-wallet-logout").onclick = (e) =>
        act(e.currentTarget, async () => {
          await disconnectWallet(returnId);
        });
      return;
    }
    if (!token && !runtime.paid) {
      app.innerHTML =
        header(
          "YOUR SANDBOX PROFILE.",
          "Sign in for bounties. Building, local saves and free play need no login.",
        ) +
        `<form id="join-sandbox" class="panel profile-form"><span class="status-stamp">NO WALLETS · NO CASH VALUE</span><h2>Your bounty account.</h2><p class="sign-in-note">Create, enter and save bounties here. Start with 1,000 practice credits. Local blueprint saves and ordinary play always work as a guest.</p><label class="field"><span>Pilot name</span><input id="pilot-name" required maxlength="28" value="Independent engineer"></label><p>Your balance and paid challenge history lives on this server. This browser stores your access key. Practice profiles are for local testing and have no cash value.</p><button class="primary">Create bounty account</button><button type="button" class="account-guest-link" id="continue-guest">Continue to guest workshop ↗</button><p id="bounty-error" class="error-message"></p><details><summary>Restore a saved profile key</summary><input id="restore-token" type="password" aria-label="Profile access key" autocomplete="off"><button type="button" id="restore-profile">Restore profile</button></details></form>`;
      wireHeader();
      $("#continue-guest").onclick = adapter.workshop;
      $("#join-sandbox").onsubmit = (e) => {
        e.preventDefault();
        void act($("#join-sandbox button"), async () => {
          const result = await api("/session", "POST", {
            name: $("#pilot-name").value,
          });
          token = result.token;
          save("wm-sandbox-token", token);
          me = result.me;
          await open(returnId);
        });
      };
      $("#restore-profile").onclick = () => restore($("#restore-token").value);
      return;
    }
    try {
      await refreshMe();
      const [ledger, agents] = await Promise.all([
        api("/me/ledger"),
        api("/agents"),
      ]);
      if (g !== generation) return;
      app.innerHTML =
        header(
          "SET YOUR BOUNDARIES.",
          "Control what you and your external agents can spend.",
        ) +
        `<div class="profile-grid"><form id="credit-settings" class="panel profile-form"><span class="status-stamp">SANDBOX CREDITS · NO CASH VALUE</span><h2>${money(me.balance)} available</h2><p>${money(me.reserved)} reserved · ${me.spentToday} entry credits spent today</p><label class="field"><span>Pilot name</span><input id="pilot-name" required maxlength="28" value="${esc(me.name)}"></label><div class="form-two"><label class="field"><span>Maximum per entry</span><input id="entry-cap" type="number" min="0" max="1000000000" placeholder="Unlimited" value="${me.entryCap ?? ""}"></label><label class="field"><span>Daily entry budget (UTC)</span><input id="daily-cap" type="number" min="0" max="1000000000" placeholder="Unlimited" value="${me.dailyCap ?? ""}"></label></div><p class="hint">Caps apply to you and all your agent keys together. Leave blank for no personal cap. Zero allows free entries only. Reward funding is separate and limited by your available balance.</p><button class="primary">Save spending limits</button><p id="bounty-error" class="error-message"></p><details><summary>Back up or restore this profile</summary><p>Keep the owner key private. Anyone with it controls this sandbox account.</p><button type="button" id="backup-key">Copy owner access key</button><input id="restore-token" type="password" autocomplete="off" aria-label="Profile key to restore"><button type="button" id="restore-profile">Restore another profile</button></details></form><section class="panel profile-form"><span class="eyebrow">BRING YOUR OWN AGENT</span><h2>Your agent. Its own compute.</h2><p>Agents read terrain and the catalog, validate builds, practice, create/save/cancel bounties, and submit trials through the API. This game does not host an AI model.</p><label class="field"><span>Agent key name</span><input id="agent-name" maxlength="28" value="My engineer"></label><button id="new-agent-key">Create restricted agent key</button><div id="new-key-result"></div><p class="hint">Agent keys share your balance and entry caps. They can fund, save and cancel your bounties, but cannot change spending caps or create other keys. Revoke at any time.</p>${agents.map((a) => `<div class="agent-row"><span>${esc(a.name)} <small>${a.revoked ? "REVOKED" : "ACTIVE"}</small></span>${!a.revoked ? `<button data-revoke="${a.id}">Revoke</button>` : ""}</div>`).join("")}<a class="api-link" href="/api/rules" target="_blank" rel="noopener">Read the machine catalog & API rules ↗</a><p class="hint">The repository includes docs/AGENT-API.md and a dependency-free example client.</p></section></div><section class="panel contract-history"><h3>Credit ledger</h3>${ledger.map((l) => `<div class="attempt-row"><span>${esc(l.kind)}</span><small>${time(l.created)}</small><strong class="${l.amount > 0 ? "credit-gain" : ""}">${signed(l.amount)}</strong></div>`).join("")}</section>`;
      wireHeader();
      $("#credit-settings").onsubmit = (e) => {
        e.preventDefault();
        void act($("#credit-settings .primary"), async () => {
          me = await api("/me", "PATCH", {
            name: $("#pilot-name").value,
            entryCap:
              $("#entry-cap").value === "" ? null : +$("#entry-cap").value,
            dailyCap:
              $("#daily-cap").value === "" ? null : +$("#daily-cap").value,
          });
          adapter.toast("Spending limits saved.");
        });
      };
      $("#backup-key").onclick = () => copy(token);
      $("#restore-profile").onclick = () => restore($("#restore-token").value);
      $("#new-agent-key").onclick = (e) =>
        act(e.currentTarget, async () => {
          const result = await api("/agents", "POST", {
            name: $("#agent-name").value,
          });
          $("#new-key-result").innerHTML =
            '<p class="notice">Copy this private key now; it is shown once.</p><input id="agent-key-value" readonly aria-label="New private agent key"><button id="copy-agent-key">Copy agent key</button>';
          $("#agent-key-value").value = result.token;
          $("#copy-agent-key").onclick = () => copy(result.token);
          e.target.disabled = true;
        });
      $$("[data-revoke]").forEach(
        (b) =>
          (b.onclick = () =>
            act(b, async () => {
              await api("/agents/" + b.dataset.revoke, "DELETE");
              await profile();
            })),
      );
    } catch (e) {
      if (g !== generation) return;
      app.innerHTML =
        header("RESTORE YOUR PROFILE.", esc(e.message)) +
        '<section class="panel profile-form"><input id="restore-token" type="password" aria-label="Saved owner key"><button id="restore-profile">Restore profile</button><button id="fresh-profile">Create a new sandbox profile</button><p>Without a saved key, an old sandbox balance cannot be recovered. Your workshop build is stored separately.</p></section>';
      wireHeader();
      $("#restore-profile").onclick = () => restore($("#restore-token").value);
      $("#fresh-profile").onclick = () => {
        token = null;
        me = null;
        localStorage.removeItem("wm-sandbox-token");
        localStorage.removeItem("wm-sandbox-outbox");
        void profile();
      };
    }
  }
  async function vault(attemptId) {
    if (!me) return profile();
    const g = begin();
    app.innerHTML =
      header(
        "YOUR BUILD VAULT.",
        attemptId
          ? "Choose a saved machine and submit it to your active bounty."
          : "Keep up to 50 private blueprints with your account. Loading one replaces this device’s workshop draft.",
      ) + '<div class="bounty-loading">Opening build vault…</div>';
    wireHeader();
    try {
      const builds = await api("/me/builds");
      if (g !== generation) return;
      const card = (b) => {
        const challenge = unpackChallenge(b.blueprint, true),
          machine = challenge.machine,
          s = stats(machine),
          arena = ARENAS.find((item) => item.id === challenge.arena);
        return `<article class="vault-row"><div class="vault-preview"><canvas data-vault-thumb="${esc(b.id)}" width="400" height="300" aria-label="${esc(machine.name)} 3D build preview"></canvas><span>3D BUILD</span></div><div class="vault-info"><div><strong>${esc(b.name)}</strong><small>Saved ${time(b.updated)} · ${esc(arena?.name || "Arena unknown")}</small></div><dl class="vault-stats"><div><dt>BUILD CREDITS</dt><dd>${s.cost.toLocaleString()}</dd></div><div><dt>MASS</dt><dd>${s.mass} t</dd></div><div><dt>FITTED PARTS</dt><dd>${s.parts}</dd></div><div><dt>WEAPONS</dt><dd>${s.weapons}</dd></div></dl><p class="vault-rules">${esc(rulesLabel(challenge.rules))}</p></div><div class="bounty-actions vault-actions">${attemptId ? `<button class="primary" data-deploy-build="${esc(b.id)}">Use and submit</button>` : ""}<button data-load-build="${esc(b.id)}">Load</button><button data-export-build="${esc(b.id)}">Export</button><button data-delete-build="${esc(b.id)}">Delete</button></div></article>`;
      };
      app.innerHTML =
        header(
          "YOUR BUILD VAULT.",
          attemptId
            ? "Choose a private saved blueprint to submit as your machine."
            : "Private to your signed-in account. A load updates this device’s workshop draft.",
        ) +
        `<section class="panel profile-form vault-panel"><span class="eyebrow">ACCOUNT BLUEPRINTS</span><h2>${builds.length} / 50 saved</h2><p>${attemptId ? "Use and submit checks the bounty’s locked limits and commits this saved machine. Deployment cannot be changed afterward." : "Save your current workshop machine, its arena and its construction rules. These builds are not public and do not affect a listed bounty."}</p><button class="primary" id="save-account-build" ${builds.length >= 50 ? "disabled" : ""}>Save current workshop build</button><p id="bounty-error" class="error-message"></p><div class="vault-list">${builds.length ? builds.map(card).join("") : '<p class="hint">No account builds yet. Your local blueprint library remains available without signing in.</p>'}</div></section>`;
      wireHeader();
      const vaultThumbs = $$('[data-vault-thumb]');
      let nextVaultThumb = 0;
      const drawVaultThumbs = () => {
        if (g !== generation) return;
        const deadline = performance.now() + 6;
        while (
          nextVaultThumb < vaultThumbs.length &&
          performance.now() < deadline
        ) {
          const canvas = vaultThumbs[nextVaultThumb++],
            build = builds.find((row) => row.id === canvas.dataset.vaultThumb);
          if (build) thumb(canvas, build.blueprint);
        }
        if (nextVaultThumb < vaultThumbs.length)
          requestAnimationFrame(drawVaultThumbs);
      };
      requestAnimationFrame(drawVaultThumbs);
      $("#save-account-build")?.addEventListener("click", (e) =>
        act(e.currentTarget, async () => {
          const draft = adapter.getBuild(),
            blueprint = packChallenge(
              draft.machine,
              draft.arena,
              0,
              draft.rules,
              draft.objective || "reactor",
            );
          await api(
            "/me/builds",
            "POST",
            { name: draft.machine.name, blueprint },
            uid(),
          );
          adapter.toast("Build saved to your account vault.");
          await vault();
        }),
      );
      $$("[data-export-build]").forEach(
        (button) =>
          (button.onclick = () => {
            const build = builds.find(
              (row) => row.id === button.dataset.exportBuild,
            );
            if (build)
              download(build.blueprint, build.name + ".war-machine.json");
          }),
      );
      $$("[data-delete-build]").forEach(
        (button) =>
          (button.onclick = () =>
            act(button, async () => {
              await api("/me/builds/" + button.dataset.deleteBuild, "DELETE");
              adapter.toast("Build removed from your account vault.");
              await vault();
            })),
      );
      $$("[data-deploy-build]").forEach(
        (button) =>
          (button.onclick = () => {
            const build = builds.find(
              (row) => row.id === button.dataset.deployBuild,
            );
            if (build)
              void act(button, () => deployCounter(attemptId, build.blueprint));
          }),
      );
      $$("[data-load-build]").forEach(
        (button) =>
          (button.onclick = () => {
            const build = builds.find(
              (row) => row.id === button.dataset.loadBuild,
            );
            if (!build) return;
            try {
              localStorage.setItem(
                "wm-machine-v3",
                JSON.stringify(build.blueprint),
              );
              location.hash = "#workshop";
              location.reload();
            } catch {
              adapter.toast(
                "Could not store that build on this device. Export it instead.",
              );
            }
          }),
      );
    } catch (e) {
      if (g !== generation) return;
      app.innerHTML =
        header("BUILD VAULT UNAVAILABLE.", esc(e.message)) +
        '<section class="panel bounty-empty"><p>' +
        esc(e.message) +
        '</p><button id="vault-retry">Try again</button></section>';
      wireHeader();
      $("#vault-retry").onclick = vault;
    }
  }
  async function restore(value) {
    const old = token;
    token = value.trim();
    try {
      await refreshMe();
      save("wm-sandbox-token", token);
      localStorage.removeItem("wm-sandbox-outbox");
      await open();
    } catch (e) {
      token = old;
      adapter.toast(e.message);
    }
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      adapter.toast("Copied.");
    } catch {
      adapter.modal(
        "Copy this text",
        `<textarea class="share-code" readonly>${esc(value)}</textarea><p>Select the text and copy it.</p>`,
      );
    }
  }
  function download(value, name) {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      );
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { open, leave, profile, attempt, deploy: deployCounter };
}
