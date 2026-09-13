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
const shortAddress = (value) =>
  value && value.length > 10
    ? value.slice(0, 6) + "…" + value.slice(-4)
    : value;
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
    runtime = { mode: "sandbox", paid: false, currency: "sandbox credits" },
    walletBalance = null,
    tempoClient = null;
  const app = $("#app");
  async function configureRuntime(catalog) {
    runtime = {
      mode: catalog.mode,
      paid:
        catalog.mode === "tempo-mainnet" &&
        catalog.directEscrow?.enabled === true,
      currency: catalog.economics.amountUnit || "sandbox credits",
    };
    if (runtime.paid && !tempoClient) {
      const discovery = await fetch("/.well-known/war-machines.json", {
        credentials: "include",
      }).then((response) => response.json());
      tempoClient = await import("./tempo-client.mjs");
      await tempoClient.configure(discovery);
    }
    return runtime;
  }
  async function api(path, method = "GET", body, key) {
    let response;
    try {
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
      response = await fetch("/api" + path, request);
    } catch (e) {
      throw Error(
        e?.message ||
          "Cannot reach the arena server. Your saved build is safe.",
      );
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error(
        "Bounties need the game server. Start play-local.bat or node server.mjs; the static sandbox still works.",
      );
    }
    if (!response.ok) {
      const e = Error(result.error || "Request failed.");
      e.status = response.status;
      throw e;
    }
    return result;
  }
  async function ensurePaidWalletSession() {
    if (!runtime.paid || me) return me;
    await tempoClient.signInWallet();
    await refreshMe();
    if (!me)
      throw Error("Tempo Wallet did not complete the bounty identity check.");
    return me;
  }
  async function mutate(path, body) {
    // A direct payment needs a signed owner identity to bind the paid reveal,
    // refunds and winner payout. Connect it only when the player starts a
    // payment action; saved builds and history remain an optional account view.
    await ensurePaidWalletSession();
    const pending = read("wm-sandbox-outbox", null);
    if (
      pending &&
      (pending.path !== path ||
        JSON.stringify(pending.body) !== JSON.stringify(body))
    )
      throw Error(
        "An earlier request needs recovery. Open the bounty board and choose Recover request.",
      );
    const request = pending || { path, body, key: uid() };
    save("wm-sandbox-outbox", request);
    try {
      let prepared;
      if (request.intentId) {
        prepared = await api(path, "POST", body, request.key);
        if (prepared.final) {
          localStorage.removeItem("wm-sandbox-outbox");
          return prepared.value;
        }
      } else {
        prepared = await api(path, "POST", body, request.key);
        if (!prepared.direct) {
          localStorage.removeItem("wm-sandbox-outbox");
          return prepared;
        }
        request.intentId = prepared.intentId;
        save("wm-sandbox-outbox", request);
      }
      if (!request.transactionHash) {
        request.transactionHash = await tempoClient.executeEscrowPlan(
          prepared.plan,
        );
        save("wm-sandbox-outbox", request);
      }
      const confirmed = await api(
        "/escrow/intents/" + request.intentId + "/confirm",
        "POST",
        { transactionHash: request.transactionHash },
        request.key,
      );
      localStorage.removeItem("wm-sandbox-outbox");
      return confirmed;
    } catch (e) {
      if (!request.intentId && e.status && e.status < 500)
        localStorage.removeItem("wm-sandbox-outbox");
      throw e;
    }
  }
  function leave() {
    generation++;
    clearTimeout(timer);
  }
  function begin() {
    adapter.show();
    current = null;
    return ++generation;
  }
  function schedule(fn, g, delay = 2500) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (g === generation) void fn();
    }, delay);
  }
  function status(s) {
    return `<span class="contract-status ${s}">${esc(s === "busy" ? "IN TRIAL" : s.toUpperCase())}</span>`;
  }
  function header(title, subtitle) {
    const walletTitle =
        runtime.paid && me?.payoutAddress ? me.payoutAddress : "",
      account = me
        ? runtime.paid
          ? `${shortAddress(me.payoutAddress)} · ${walletBalance ? money(walletBalance.balance) + " pathUSD" : "balance unavailable"}`
          : runtime.mode === "tempo-mainnet"
            ? "Payments unavailable"
            : money(me.balance) + " sandbox credits"
        : runtime.mode === "tempo-mainnet"
          ? "Saved builds"
          : "Sign in for bounties",
      season = runtime.paid
        ? "TEMPO MAINNET"
        : runtime.mode === "tempo-mainnet"
          ? "MAINNET SETUP"
          : "SANDBOX SEASON";
    return `<div class="page-heading bounty-heading"><div><span class="eyebrow">FOUNDRY BOUNTIES / ${season}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><button id="contracts-home">All bounties</button>${me ? '<button id="build-vault">Build vault</button>' : ""}<button id="credits-btn" title="${esc(walletTitle)}" aria-label="${esc(walletTitle ? "Connected Tempo Wallet " + walletTitle : account)}">${esc(account)}</button>${runtime.paid && me ? '<button id="disconnect-wallet" class="danger" title="Clear this browser’s Tempo Wallet connection">Disconnect</button>' : ""}</div></div>${read("wm-sandbox-outbox", null) ? '<div class="notice">A request was interrupted. Its idempotency key is saved. <button id="recover-request">Recover request</button></div>' : ""}`;
  }
  function wireHeader() {
    if ($("#contracts-home")) $("#contracts-home").onclick = () => open();
    if ($("#build-vault")) $("#build-vault").onclick = vault;
    if ($("#credits-btn")) $("#credits-btn").onclick = profile;
    if ($("#disconnect-wallet"))
      $("#disconnect-wallet").onclick = (e) =>
        act(e.currentTarget, () => disconnectWallet());
    if ($("#recover-request"))
      $("#recover-request").onclick = () =>
        act($("#recover-request"), async () => {
          const p = read("wm-sandbox-outbox", null),
            r = await mutate(p.path, p.body);
          await refreshMe();
          if (p.path.endsWith("/attempts")) await attempt(r.id);
          else await open(r.id);
        });
  }
  async function act(button, fn) {
    if (button) button.disabled = true;
    try {
      await fn();
    } catch (e) {
      adapter.toast(e.message);
      const node = $("#bounty-error");
      if (node) node.textContent = e.message;
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }
  async function refreshMe() {
    if (token || runtime.paid) {
      try {
        me = await api("/me");
      } catch (e) {
        if (e.status !== 401) throw e;
        me = null;
      }
    }
    walletBalance = null;
    if (runtime.paid && me?.payoutAddress)
      try {
        walletBalance = await api("/me/wallet");
      } catch {
        // The address remains visible if a public RPC is briefly unavailable.
      }
    return me;
  }
  async function disconnectWallet(returnId) {
    await tempoClient.logout();
    me = null;
    walletBalance = null;
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
    `<div class="sealed-defender" role="img" aria-label="Concealed defender: ${scout(b).cost} build credits, ${scout(b).mass} tonnes"><span>◆</span><small>DEFENDER SEALED</small></div>`;
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
    return `<div class="notice fee-disclosure"><strong>${b.platformFeeBps ? money(b.platformFeeBps / 100) + "% platform fee on a win" : "No platform fee · original bounty terms"}</strong><br>Gross reward ${money(b.reward)} − platform fee ${money(b.platformFee)} = <strong>${money(b.payout)} paid to the winner</strong>. Entry costs ${money(b.entry)} separately. Net if you win: ${signed(b.netIfWin)} ${esc(runtime.currency)}. No payout fee on a loss, draw, refund or cancellation.</div>`;
  }
  function card(b) {
    const s = scout(b),
      a = bountyArena(b),
      fee = b.platformFeeBps
        ? `${money(b.payout)} winner payout · ${money(b.platformFeeBps / 100)}% platform fee`
        : `${money(b.payout)} winner payout · legacy terms / no platform fee`;
    return `<article class="contract-card"><div class="contract-card-top">${status(b.status)}<small>${b.listed ? "OPEN BOUNTY" : "UNLISTED LINK"}</small></div><div class="contract-preview">${b.blueprint ? `<canvas data-contract-thumb="${b.id}" width="300" height="260" aria-label="Defender machine"></canvas>` : sealedPreview(b)}<span class="contract-reward"><b>${money(b.reward)}</b><small>GROSS REWARD</small></span></div><div class="contract-content"><h2>${esc(b.title)}</h2><p>${esc(a.name)} · ${s.cost} build credits · ${s.mass} t · ${s.parts} fitted parts + core</p>${terrain(a)}<div class="contract-class">${esc(rulesLabel(bountyRules(b)))}</div><p class="card-fee">${fee}</p><div class="contract-footer"><span><b>${b.entry}</b> entry · ${b.attempts} trials</span><button data-contract="${b.id}">${b.blueprint ? "Inspect bounty" : "Scout bounty"} ↗</button></div></div></article>`;
  }
  async function open(id) {
    const g = begin();
    window.history.replaceState(
      null,
      "",
      "#" + (id ? "bounty=" + id : "bounties"),
    );
    app.innerHTML =
      header(
        "THE BOUNTY BOARD.",
        "Build a counter. Break a machine. Claim the bounty.",
      ) + '<div class="bounty-loading">Connecting to the arena…</div>';
    wireHeader();
    try {
      const catalog = await api("/rules");
      await configureRuntime(catalog);
      currentFeeBps = catalog.economics.platformFee.basisPoints;
      if (catalog.versions.hash !== CLIENT_ENGINE_HASH)
        throw Error(
          "This tab has an older game release. Reload the page before entering or replaying bounties.",
        );
      await refreshMe();
      const data = await api(id ? "/bounties/" + id : "/bounties");
      const saved = me ? await api("/me/bookmarks") : [];
      savedIds = new Set(saved.map((b) => b.id));
      if (!id)
        for (const b of saved)
          if (!data.some((n) => n.id === b.id)) data.push(b);
      if (g !== generation) return;
      if (id) {
        current = data;
        detail(data, g);
        return;
      }
      app.innerHTML =
        header(
          "THE BOUNTY BOARD.",
          "Build a counter. Break a machine. Claim the bounty.",
        ) +
        `<section class="contract-hero"><div><span class="eyebrow">YOUR ENGINEERING. THEIR WEAK POINT.</span><h2>One machine to beat.<br>One challenger at a time.</h2><p>Scout the defender. Refine your build in free practice. The deterministic result is signed by two independent result keys, then the escrow settles the exact on-chain payout.</p><div class="contract-hero-actions"><button class="primary" id="new-contract">＋ Create a bounty</button><button id="my-history">My attempts</button></div></div><div class="credit-summary"><span class="status-stamp">${runtime.paid ? "TEMPO MAINNET · pathUSD" : "SANDBOX CREDITS · NO CASH VALUE"}</span><div><b>${runtime.paid ? (me ? money(me.reserved || 0) : "PAY AS YOU GO") : me ? money(me.balance) : "1,000"}</b><span>${runtime.paid ? (me ? "RESERVED IN BOUNTIES" : "TEMPO WALLET") : me ? "AVAILABLE" : "STARTING CREDITS"}</span></div><p>${runtime.paid ? (me ? "Your wallet approves pathUSD and calls the verified escrow directly." : "Create or enter by confirming the shown pathUSD transaction in Tempo Wallet.") : me ? money(me.reserved) + " reserved in your bounties" : "Create a sandbox profile to enter local trials."}</p><small>Creators choose entry, gross reward and build limits. New bounties: 2.5% platform fee on wins.<br>Read the terms before you enter.</small></div></section><div class="contract-filter"><div class="segmented">${[
          ["open", "Available"],
          ["mine", "My bounties"],
          ["saved", "Saved"],
          ["all", "Closed"],
        ]
          .map(
            ([v, t]) =>
              `<button data-filter="${v}" class="${v === filter ? "active" : ""}">${t}</button>`,
          )
          .join(
            "",
          )}</div><button id="refresh-contracts">⟳ Refresh board</button></div><div class="contract-search"><input id="contract-search" type="search" aria-label="Search bounties" placeholder="Search machines or bounties" value="${esc(searchText)}"><select id="arena-filter" aria-label="Filter bounties by arena"><option value="">All arenas</option>${ARENAS.map((a) => `<option value="${a.id}" ${a.id === arenaFilter ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select><input id="fee-filter" type="number" min="0" step="${runtime.paid ? ".01" : "1"}" aria-label="Maximum entry fee" placeholder="Max entry · any" value="${esc(feeFilter)}"></div><div class="contract-grid" id="contract-grid"></div><div class="notice bounty-footnote">Construction limits are separate from bounty funds. An official attempt locks both builds, the arena, terrain, and rules. A fresh server seed decides the trial. Practice is free and never pays rewards.</div>`;
      const draw = () => {
        const shown = data.filter(
          (b) =>
            (filter === "mine"
              ? b.owner === me?.id
              : filter === "saved"
                ? savedIds.has(b.id)
                : filter === "open"
                  ? ["open", "busy"].includes(b.status)
                  : !["open", "busy"].includes(b.status)) &&
            (!arenaFilter || bountyArena(b).id === arenaFilter) &&
            (feeFilter === "" || b.entry <= +feeFilter) &&
            (!searchText ||
              (b.title + " " + b.ownerName)
                .toLowerCase()
                .includes(searchText.toLowerCase())),
        );
        $("#contract-grid").innerHTML = shown.length
          ? shown.map(card).join("")
          : '<div class="bounty-empty">No bounties here yet. Create one from your workshop build.</div>';
        drawThumbs(shown);
        $$("[data-contract]").forEach(
          (b) => (b.onclick = () => open(b.dataset.contract)),
        );
      };
      draw();
      wireHeader();
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
          }),
      );
      $("#new-contract").onclick = () =>
        runtime.paid || me ? create() : profile();
      $("#my-history").onclick = history;
      $("#refresh-contracts").onclick = () => open();
    } catch (e) {
      if (g !== generation) return;
      app.innerHTML =
        header("BOUNTIES OFFLINE.", esc(e.message)) +
        `<section class="panel bounty-empty"><p>${esc(e.message)}</p><button id="retry-contracts">Try again</button><button id="offline-workshop">Back to workshop</button>${e.status === 401 ? '<button id="reset-profile">Use a different profile key</button>' : ""}</section>`;
      wireHeader();
      $("#retry-contracts").onclick = () => open(id);
      $("#offline-workshop").onclick = adapter.workshop;
      if ($("#reset-profile")) $("#reset-profile").onclick = profile;
    }
  }
  function detail(b, g) {
    const revealed = !!b.blueprint,
      s = scout(b),
      a = bountyArena(b),
      lockedRules = bountyRules(b),
      draft = adapter.getBuild(),
      issues = validate(draft.machine, lockedRules),
      own = b.owner === me?.id,
      m = revealed ? unpackChallenge(b.blueprint, true).machine : null;
    const isExpired = !!b.expires && b.expires <= Date.now(),
      counterStatus = revealed
        ? issues.length
          ? esc(issues[0])
          : stats(draft.machine).cost +
            " build credits · eligible for this bounty"
        : "Pay the entry to reveal the defender, then build and test your counter for free.",
      preview = revealed
        ? '<canvas id="defender-preview" width="650" height="500" aria-label="Defender machine preview"></canvas>'
        : sealedPreview(b),
      defenderCaption = revealed
        ? `<h2>${esc(m.name)}</h2><p>${s.cost} build credits · ${s.mass} t · ${s.parts} fitted parts + core · ${s.height} ${s.height === 1 ? "level" : "levels"}</p><span>${esc(m.tactic)} · targets ${esc(m.target)} · range ${m.range} · front ${["north", "east", "south", "west"][m.front || 0]}</span>`
        : `<h2>Defender sealed</h2><p>${s.cost} build credits · ${s.mass} t · ${s.parts} fitted parts + core · ${s.weapons} weapons · ${s.height} ${s.height === 1 ? "level" : "levels"}</p><span>Exact modules, colors, doctrine, layout, and firing arcs reveal only after a confirmed entry.</span>`,
      defenderActions = revealed
        ? `<button id="inspect-defender" ${!b.compatible ? "disabled" : ""}>◎ Scout in 3D</button><button id="export-defender">↓ Blueprint JSON</button>`
        : '<span class="sealed-note">PAY TO REVEAL · BLUEPRINT HIDDEN</span>',
      entryAction =
        b.status === "open" && !own
          ? `<button id="official-entry" class="primary contract-enter" ${!b.compatible || (!runtime.paid && !me) ? "disabled" : ""}>Pay entry & reveal defender · ${b.entry} ${runtime.currency}</button>`
          : b.status === "busy" && revealed && !own
            ? '<button id="resume-attempt" class="primary contract-enter">Resume paid challenge</button>'
            : "";
    app.innerHTML =
      header(
        revealed ? "ENGINEER THE COUNTER." : "SCOUT THE TARGET.",
        esc(b.title),
      ) +
      `<div class="contract-detail"><section class="panel defender-card"><div class="contract-card-top">${status(b.status)}<small>${b.funded ? "REWARD RESERVED" : "BOUNTY CLOSED"}</small></div>${preview}<div class="defender-caption">${defenderCaption}</div><div class="bounty-actions">${defenderActions}<button id="copy-contract">↗ Copy bounty link</button><button id="save-contract">${savedIds.has(b.id) ? "★ Saved bounty" : "☆ Save bounty"}</button>${navigator.share ? '<button id="native-share-contract">Share…</button>' : ""}</div></section><section class="panel contract-terms"><span class="eyebrow">${esc(b.ownerName)} / BOUNTY TERMS</span><h2>${esc(b.title)}</h2><div class="contract-economy"><div><b>${money(b.reward)}</b><small>GROSS REWARD</small></div><div><b>${money(b.entry)}</b><small>ENTRY COST</small></div><div><b>${signed(b.netIfWin)}</b><small>NET AFTER ALL FEES</small></div></div>${feeNotice(b)}<div class="contract-rule"><strong>${esc(a.name)}</strong><p>${esc(a.desc)}</p>${terrain(a)}</div><div class="contract-rule"><strong>${esc(rulesLabel(lockedRules))}</strong><p>Locked for both machines. Autonomous combat · 100 seconds · one official attempt at a time.</p></div><div class="contract-rule"><strong>Your counter: ${esc(draft.machine.name)}</strong><p>${counterStatus}</p></div>${revealed ? `<div class="bounty-actions"><button id="refit-counter" ${!b.compatible ? "disabled" : ""}>Refit counter</button><button id="free-practice" ${issues.length || !b.compatible ? "disabled" : ""}>Free practice</button></div>` : ""}${entryAction}${!runtime.paid && !me ? '<button id="join-profile">Sign in to enter this sandbox bounty</button>' : ""}<p class="hint">${revealed ? "You hold a paid reveal for this bounty. Free practice never transfers funds." : runtime.paid ? "Any Tempo Wallet can pay this entry. One confirmation atomically approves pathUSD if needed and enters the escrow, then reveals the exact defender and starts your timed counter-build window." : "The entry is sent directly to the verified escrow. After confirmation, you get the exact defender and a timed counter-build window. A loss sends the entry to the creator; a technical refund returns it."} ${own ? "You cannot claim your own reward." : ""}</p><p class="error-message" id="bounty-error">${!b.compatible ? "This engine version is archived. Its receipt remains available, but current-engine practice is unavailable." : ""}</p><p class="contract-expiry">${b.expires ? "Expires " + time(b.expires) : "No deadline · until claimed or closed"} · ${b.attempts} attempts<br>${b.listed ? "Visible on the board" : "Unlisted: anyone with the link can scout and pay the posted entry."}</p>${own && b.status === "open" ? `<button id="cancel-contract">Close bounty · return ${b.reward} ${runtime.currency}</button>` : ""}${me && isExpired && ["open", "busy"].includes(b.status) ? '<button id="expire-contract">Settle expiry onchain</button>' : ""}</section></div><section class="panel contract-history"><h3>Verified attempts</h3>${b.history.length ? b.history.map((a) => (revealed ? `<button data-attempt="${a.id}" class="attempt-row"><span>${a.result ? esc(a.result.outcome.toUpperCase()) : "REFUNDED"}</span><small>${time(a.created)}</small><strong>${a.result?.time ? Number(a.result.time).toFixed(1) + "s" : "Technical refund"} ↗</strong></button>` : `<div class="attempt-row"><span>${a.result ? esc(a.result.outcome.toUpperCase()) : "REFUNDED"}</span><small>${time(a.created)}</small><strong>Defender replay sealed</strong></div>`)).join("") : "<p>No completed official trials yet. Be the first to test this defense.</p>"}</section>`;
    if (revealed) thumb($("#defender-preview"), b.blueprint);
    wireHeader();
    if ($("#refit-counter"))
      $("#refit-counter").onclick = () => adapter.edit(b);
    if ($("#inspect-defender"))
      $("#inspect-defender").onclick = () => adapter.scout(b);
    if ($("#free-practice"))
      $("#free-practice").onclick = () => adapter.practice(b);
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
          const entry = runtime.paid
            ? { maxEntry: b.entry, maxPlatformFeeBps: b.platformFeeBps }
            : {
                blueprint: packChallenge(
                  adapter.getBuild().machine,
                  b.blueprint.a,
                  0,
                  b.blueprint.q,
                ),
                maxEntry: b.entry,
                maxPlatformFeeBps: b.platformFeeBps,
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
          await open(b.id);
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
      `<form id="create-contract" class="contract-create"><section class="panel create-preview"><canvas id="create-preview" width="480" height="420" aria-label="Your defending machine"></canvas><h2>${esc(build.name)}</h2><p id="create-stats"></p><p class="hint">This snapshots your current workshop build, including paint, front, upgrades, height and doctrine.</p><button type="button" id="back-build">Edit in workshop</button></section><section class="panel contract-form"><label class="field"><span>Bounty title</span><input id="contract-title" required maxlength="70" value="${esc("Break " + build.name)}"></label><div class="form-two"><label class="field"><span>Entry · ${runtime.paid ? "pathUSD" : "sandbox credits"}</span><input id="contract-entry" type="number" min="${runtime.paid ? ".01" : "0"}" max="1000000000" step="${runtime.paid ? ".01" : "1"}" value="${runtime.paid ? ".10" : "10"}" required></label><label class="field"><span>Gross reward · ${runtime.paid ? "pathUSD" : "sandbox credits"}</span><input id="contract-reward" type="number" min="${runtime.paid ? ".01" : "0"}" max="1000000000" step="${runtime.paid ? ".01" : "1"}" value="${runtime.paid ? "1.00" : "100"}" required></label></div><div class="notice" id="reserve-note"></div><div class="form-two"><label class="field"><span>Arena & terrain</span><select id="contract-arena">${ARENAS.map((a) => `<option value="${a.id}" ${a.id === draft.arena ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label><label class="field"><span>Construction class</span><select id="contract-class"><option value="standard">Standard · 1200 credits</option><option value="custom">Custom limits</option><option value="unlimited">Unlimited · 243 sockets</option></select></label></div><div id="contract-terrain" class="notice"></div><div class="form-four" id="contract-caps">${[
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
        )}</div><p class="hint">Custom cap 0 = no limit. Unlimited removes all four caps; supports and the 9×9×3 grid still apply.</p><div class="form-two"><label class="field"><span>Duration · hours (0 = no deadline)</span><input id="contract-hours" type="number" min="0" max="8760" step="1" value="24" required></label><label class="field"><span>Sharing</span><select id="contract-listed"><option value="false">Unlisted · share by link</option><option value="true">Listed on bounty board</option></select></label></div><p class="hint">Anyone with an unlisted link can scout this bounty. Any Tempo Wallet can pay its posted entry and attempt it. Terms lock after funding; close an idle bounty to return its unused reward.</p><p id="bounty-error" class="error-message" role="status"></p><button class="primary contract-enter" id="fund-contract" type="submit">Fund & create bounty</button></section></form>`;
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
          `${money(reward)} ${runtime.currency} gross reward. ${available} Platform fee: ${money(currentFeeBps / 100)}% of a winning reward (${money(quote.platformFee)} ${runtime.currency}). Winner receives ${money(quote.payout)} ${runtime.currency}; net after entry: ${signed(quote.netIfWin)}. Fee comes from this reward, with no extra charge to the creator. You choose entry and gross reward; no required ratio.`;
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
  async function attempt(id) {
    const g = begin();
    app.innerHTML =
      header(
        "OFFICIAL TRIAL.",
        "The deterministic arena result is settled by the verified Tempo escrow.",
      ) + '<div class="bounty-loading">Loading attempt…</div>';
    wireHeader();
    async function settle(a) {
      const key = "wm-settlement-" + a.id;
      let pending = read(key, null);
      if (!pending?.transactionHash) {
        const prepared = await api("/attempts/" + a.id + "/settlement-plan");
        pending = {
          transactionHash: await tempoClient.executeEscrowPlan(prepared.plan),
        };
        save(key, pending);
      }
      await api(
        "/attempts/" + a.id + "/settlement-confirm",
        "POST",
        { transactionHash: pending.transactionHash },
        uid(),
      );
      localStorage.removeItem(key);
      await attempt(a.id);
    }
    async function refund(a) {
      const bounty = await mutate("/attempts/" + a.id + "/refund", {});
      await open(bounty.id);
    }
    async function poll() {
      try {
        const a = await api("/attempts/" + id);
        if (g !== generation) return;
        await refreshMe();
        if (a.status === "engineering") {
          const remaining = Math.max(
              0,
              Number(a.build?.deadline || 0) - Date.now(),
            ),
            seconds = Math.ceil(remaining / 1000),
            clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
            defender = a.defender
              ? { id: a.bounty, title: a.bountyTitle, blueprint: a.defender }
              : null;
          if (!defender)
            throw Error(
              "The paid defender reveal is unavailable. Reopen this attempt with the wallet that paid the entry.",
            );
          if (!seconds) {
            const recoverySeconds = Math.max(
                0,
                Math.ceil(
                  (Number(a.build?.settlementDeadline || 0) - Date.now()) /
                    1000,
                ),
              ),
              recoveryClock = `${Math.floor(recoverySeconds / 60)}:${String(recoverySeconds % 60).padStart(2, "0")}`;
            app.innerHTML =
              header(
                "ENGINEERING WINDOW CLOSED.",
                "No counter was deployed before the result-attestation reserve began.",
              ) +
              `<section class="panel trial-wait"><span class="eyebrow">ESCROW TIMEOUT PROTECTION</span><h2>Counter not committed.</h2><p>The direct escrow still protects your entry if no signed result settles. ${recoverySeconds ? `Recovery opens in <strong>${recoveryClock}</strong> when the on-chain attempt deadline passes.` : "The on-chain recovery window is open."}</p><div class="bounty-actions"><button id="refund-attempt" ${recoverySeconds ? "disabled" : ""}>Recover entry onchain</button><button id="pending-contract">View bounty</button></div><p id="bounty-error" class="error-message"></p></section>`;
            wireHeader();
            $("#pending-contract").onclick = () => open(a.bounty);
            if (!recoverySeconds)
              $("#refund-attempt").onclick = (e) =>
                act(e.currentTarget, () => refund(a));
            else schedule(poll, g, 1000);
            return;
          }
          app.innerHTML =
            header(
              "OPPONENT REVEALED.",
              "Build, test, then commit one counter before the engineering clock closes.",
            ) +
            `<section class="panel trial-wait"><span class="eyebrow">PAID ENTRY CONFIRMED · DEFENDER UNSEALED</span><h2>${clock} to deploy.</h2><p><strong>${esc(defender.title)}</strong> is now available for free local practice. The current verified escrow leaves the remaining time for two independent result signatures after you deploy.</p><div class="notice fee-disclosure">Build limit: ${esc(rulesLabel(defender.blueprint.q))} · Arena: ${esc(bountyArena({ blueprint: defender.blueprint }).name)} · Your entry remains in the direct escrow until the signed result settles.</div><div class="bounty-actions"><button id="refit-counter" class="primary">Build counter</button><button id="free-practice">Free practice</button><button id="deploy-counter">Deploy current counter</button><button id="pending-contract">View bounty</button></div><p id="bounty-error" class="error-message"></p></section>`;
          wireHeader();
          $("#refit-counter").onclick = () => adapter.edit(defender);
          $("#free-practice").onclick = () => adapter.practice(defender);
          $("#pending-contract").onclick = () => open(a.bounty);
          $("#deploy-counter").onclick = (e) =>
            act(e.currentTarget, async () => {
              const current = adapter.getBuild(),
                blueprint = packChallenge(
                  current.machine,
                  defender.blueprint.a,
                  0,
                  defender.blueprint.q,
                ),
                deployed = await api(
                  "/attempts/" + a.id + "/deploy",
                  "POST",
                  { blueprint },
                  uid(),
                );
              await attempt(deployed.id);
            });
          schedule(poll, g, 1000);
          return;
        }
        if (["queued", "running"].includes(a.status)) {
          app.innerHTML =
            header(
              "YOUR MACHINE IS COMMITTED.",
              "The entry is recorded once. You can leave and return safely.",
            ) +
            `<section class="panel trial-wait"><div class="trial-spinner" aria-hidden="true">◈</div><span class="eyebrow">${a.status === "queued" ? "QUEUED FOR VERIFICATION" : "SIMULATING"}</span><h2>Engineering meets reality.</h2><p>Both builds are locked. Other challengers wait until this bounty reopens or its reward is claimed.</p><p class="hint">No need to keep this tab open. Find the result under My attempts.</p><button id="pending-contract">View bounty</button></section>`;
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
            ready = a.status === "ready-to-settle";
          app.innerHTML =
            header(
              ready
                ? "RESULT READY TO SETTLE."
                : "RESULT AWAITING ATTESTATION.",
              "The game result is deterministic. The escrow releases funds only after two independent signatures.",
            ) +
            `<section class="panel trial-wait"><span class="eyebrow">${ready ? "TWO SIGNATURES VERIFIED" : "RESULT SIGNING IN PROGRESS"}</span><h2>${r?.outcome === "win" ? "YOU BROKE THE MACHINE." : r?.outcome === "loss" ? "THE DEFENSE HELD." : "DRAW OR TECHNICAL RESULT."}</h2><p>${r?.integrity ? `Your integrity: ${(r.integrity[0] * 100).toFixed(1)}% · Defender: ${(r.integrity[1] * 100).toFixed(1)}%. ` : ""}Result hash: <code>${esc(s?.resultHash || "pending")}</code></p><p class="hint">${expires ? "The result window elapsed. The challenger can recover the entry directly from escrow." : ready ? "Submit the signed settlement transaction. Any wallet can relay it; the contract verifies the two signatures and exact payout." : "The independently held signer keys review and attest the exact result. If this window expires, the challenger can recover the entry onchain."}</p><div class="bounty-actions">${ready ? '<button class="primary" id="settle-attempt">Settle onchain</button>' : ""}${expires ? '<button id="refund-attempt">Recover entry onchain</button>' : ""}<button id="pending-contract">View bounty</button></div><p id="bounty-error" class="error-message"></p></section>`;
          wireHeader();
          $("#pending-contract").onclick = () => open(a.bounty);
          if ($("#settle-attempt"))
            $("#settle-attempt").onclick = (e) =>
              act(e.currentTarget, () => settle(a));
          if ($("#refund-attempt"))
            $("#refund-attempt").onclick = (e) =>
              act(e.currentTarget, () => refund(a));
          if (!ready && !expires) schedule(poll, g, 5000);
          return;
        }
        const r = a.result,
          won = r?.outcome === "win",
          technical = r?.outcome === "technical-refund";
        app.innerHTML =
          header(
            "THE VERDICT.",
            r?.payoutStatus === "settled-onchain"
              ? "The Tempo escrow settled this result onchain."
              : r
                ? "Recorded official result."
                : "Your entry was returned onchain.",
          ) +
          `<section class="panel official-result ${won ? "won" : ""}"><span class="eyebrow">${r?.payoutStatus === "settled-onchain" ? "ESCROW SETTLED" : technical ? "TECHNICAL REFUND" : "ON-CHAIN RESULT"}</span><h2>${won ? "BOUNTY CLAIMED." : technical ? "ENTRY RETURNED." : r?.outcome === "draw" ? "DEFENSE HELD." : r ? "BACK TO THE DRAWING BOARD." : "ENTRY RETURNED."}</h2><div class="contract-economy"><div><b>${r ? (Number(r.net) > 0 ? "+" : "") + r.net : "REFUND"}</b><small>${esc(runtime.currency).toUpperCase()} CHANGE</small></div><div><b>${r?.time ? Number(r.time).toFixed(1) + "s" : "—"}</b><small>TRIAL DURATION</small></div><div><b>${r?.payoutStatus === "settled-onchain" ? "✓" : "—"}</b><small>ESCROW</small></div></div><p>${r?.integrity ? `Your integrity: ${(r.integrity[0] * 100).toFixed(1)}% · Defender: ${(r.integrity[1] * 100).toFixed(1)}%. ${won ? "The payout was sent by the escrow after the 2.5% platform fee." : "The escrow processed this official result."}` : esc(a.error || "No server-side balance was held.")}</p>${r ? `<div class="notice fee-disclosure">Gross reward: ${money(r.grossReward ?? r.reward ?? 0)} · Platform fee: ${money(r.platformFee ?? 0)} (${money((r.platformFeeBps ?? 0) / 100)}% on wins) · Paid to challenger: ${money(r.payout ?? 0)} · Separate entry: ${money(r.entry ?? 0)} ${esc(runtime.currency)}.</div>` : ""}<div class="bounty-actions">${a.replay ? '<button id="verified-replay" class="primary">▶ Watch exact replay</button>' : ""}<button id="result-contract">Back to bounty</button><button id="result-refit">Refit counter</button></div><p class="hint">Attempt ${esc(a.id)} · ${time(a.updated)}<br>The replay reconstructs the committed machine pair, arena, seed and engine release.</p><p id="bounty-error" class="error-message"></p></section>`;
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
            act(e.currentTarget, async () => {
              const catalog = await api("/rules");
              currentFeeBps = catalog.economics.platformFee.basisPoints;
              if (catalog.versions.hash !== CLIENT_ENGINE_HASH)
                throw Error(
                  "Reload this tab to load the current simulation before replaying.",
                );
              if (catalog.versions.hash !== a.replay.versions.hash)
                throw Error(
                  "Replay belongs to an archived engine version; its verified receipt remains available.",
                );
              adapter.replay(a, await api("/bounties/" + a.bounty));
            });
      } catch (e) {
        if (g !== generation) return;
        app.innerHTML =
          header("RESULT PENDING.", esc(e.message)) +
          '<section class="panel bounty-empty"><p>The accepted trial continues in the escrow workflow. Reopen My attempts to retrieve it.</p><button id="retry-attempt">Check again</button></section>';
        wireHeader();
        $("#retry-attempt").onclick = () => attempt(id);
      }
    }
    await poll();
  }
  async function history() {
    if (!me) return profile();
    const g = begin();
    app.innerHTML =
      header("YOUR TRIALS.", "Official attempts persist across reloads.") +
      '<div class="bounty-loading">Loading history…</div>';
    wireHeader();
    try {
      const rows = await api("/me/attempts");
      if (g !== generation) return;
      app.innerHTML =
        header("YOUR TRIALS.", "Official attempts persist across reloads.") +
        `<section class="panel contract-history">${rows.map((a) => `<button data-attempt="${a.id}" class="attempt-row"><span>${esc(a.result?.outcome || a.status)}</span><small>${time(a.created)}</small><strong>${a.result ? (a.result.net > 0 ? "+" : "") + a.result.net + (runtime.paid ? " pathUSD" : " credits") : "View status"} ↗</strong></button>`).join("") || "<p>No official trials yet. Choose an available bounty to start.</p>"}</section>`;
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
        `<section class="panel profile-form"><span class="status-stamp">MAINNET ACTIVATION LOCKED</span><h2>Play locally while payments are configured.</h2><p>The workshop and free practice are available. No wallet charge, reward funding, or bounty entry can occur until the payment backend reports ready.</p><button type="button" class="account-guest-link" id="continue-guest">Continue to guest workshop ↗</button></section>`;
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
          await tempoClient.signInWallet();
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
        `<div class="profile-grid"><section class="panel profile-form"><span class="status-stamp">TEMPO MAINNET · ${esc(runtime.currency)}</span><h2>Saved work</h2><p>Your build vault is private to this Tempo Wallet. It is separate from bounty payments.</p><button class="primary" id="open-vault">Open build vault</button><p class="hint">Local workshop saves continue to work without connecting a wallet.</p></section><section class="panel profile-form"><span class="eyebrow">BOUNTY RECORD</span><h2>Private history</h2><p>Open your verified attempts, paid reveals and on-chain settlement records.</p><button id="open-history">View my attempts</button><p class="hint">Each reward, entry and refund is confirmed by the escrow transaction shown in Tempo Wallet.</p></section></div><section class="panel profile-form"><span class="eyebrow">WALLET SESSION</span><p>Connected as ${esc(wallet)}. Disconnecting only clears this browser session; it never moves funds.</p><button id="tempo-wallet-logout">Disconnect wallet session</button></section>`;
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
        `<form id="join-sandbox" class="panel profile-form"><span class="status-stamp">NO WALLETS · NO CASH VALUE</span><h2>Your bounty account.</h2><p class="sign-in-note">Create, enter and save bounties here. Start with 1,000 sandbox credits. Local blueprint saves and ordinary play always work as a guest.</p><label class="field"><span>Pilot name</span><input id="pilot-name" required maxlength="28" value="Independent engineer"></label><p>Your balance and official trials live on this server. This browser stores your access key. Sandbox profiles are for gameplay testing, not an economy with real value.</p><button class="primary">Create bounty account</button><button type="button" class="account-guest-link" id="continue-guest">Continue to guest workshop ↗</button><p id="bounty-error" class="error-message"></p><details><summary>Restore a saved profile key</summary><input id="restore-token" type="password" aria-label="Profile access key" autocomplete="off"><button type="button" id="restore-profile">Restore profile</button></details></form>`;
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
  async function vault() {
    if (!me) return profile();
    const g = begin();
    app.innerHTML =
      header(
        "YOUR BUILD VAULT.",
        "Keep up to 50 private blueprints with your account. Loading one replaces this device’s workshop draft.",
      ) + '<div class="bounty-loading">Opening build vault…</div>';
    wireHeader();
    try {
      const builds = await api("/me/builds");
      if (g !== generation) return;
      const card = (b) => {
        const machine = unpackChallenge(b.blueprint, true).machine,
          s = stats(machine);
        return `<div class="vault-row"><div><strong>${esc(b.name)}</strong><small>${s.cost} build credits · ${s.parts} fitted parts + core · saved ${time(b.updated)}</small></div><div class="bounty-actions"><button data-load-build="${b.id}">Load</button><button data-export-build="${b.id}">Export</button><button data-delete-build="${b.id}">Delete</button></div></div>`;
      };
      app.innerHTML =
        header(
          "YOUR BUILD VAULT.",
          "Private to your signed-in account. A load updates this device’s workshop draft.",
        ) +
        `<section class="panel profile-form vault-panel"><span class="eyebrow">ACCOUNT BLUEPRINTS</span><h2>${builds.length} / 50 saved</h2><p>Save your current workshop machine, its arena and its construction rules. These builds are not public and do not affect a listed bounty.</p><button class="primary" id="save-account-build" ${builds.length >= 50 ? "disabled" : ""}>Save current workshop build</button><p id="bounty-error" class="error-message"></p><div class="vault-list">${builds.length ? builds.map(card).join("") : '<p class="hint">No account builds yet. Your local blueprint library remains available without signing in.</p>'}</div></section>`;
      wireHeader();
      $("#save-account-build")?.addEventListener("click", (e) =>
        act(e.currentTarget, async () => {
          const draft = adapter.getBuild(),
            blueprint = packChallenge(
              draft.machine,
              draft.arena,
              0,
              draft.rules,
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
  return { open, leave, profile, attempt };
}
