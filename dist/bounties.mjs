import { ARENAS, TERRAIN_INFO, PRESETS, DEFAULT_RULES, normalizeRules, packChallenge, unpackChallenge, clone, stats, validate, rulesLabel } from "./data.mjs";
import { PLATFORM_FEE_BPS, rewardQuote } from "./economy.mjs";
import { CLIENT_ENGINE_HASH } from "./release.mjs";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const signed = (n) => (n > 0 ? "+" : "") + Number(n).toLocaleString();
const money = (n) => Number(n).toLocaleString(), time = (t) => new Date(t).toLocaleString(), uid = () => crypto.randomUUID();
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
function createBountyUI(adapter) {
  let currentFeeBps = PLATFORM_FEE_BPS;
  let token = read("wm-demo-token", null), me = null, generation = 0, timer = 0, current = null, filter = "open", savedIds = /* @__PURE__ */ new Set(), searchText = "", arenaFilter = "", feeFilter = "", runtime = { mode: "demo", paid: false, currency: "demo credits" }, tempoClient = null;
  const app = $("#app");
  async function configureRuntime(catalog) {
    runtime = { mode: catalog.mode, paid: catalog.mode !== "demo", currency: catalog.economics.amountUnit || "demo credits" };
    if (runtime.paid && !tempoClient) {
      const discovery = await fetch("/.well-known/war-machines.json", { credentials: "include" }).then((r) => r.json());
      tempoClient = await import("./tempo-client.mjs");
      await tempoClient.configure(discovery);
    }
    return runtime;
  }
  async function api(path, method = "GET", body, key) {
    let response;
    try {
      const request = { method, credentials: "include", headers: { ...token ? { Authorization: "Bearer " + token } : {}, ...body ? { "Content-Type": "application/json" } : {}, ...key ? { "Idempotency-Key": key } : {} }, ...body ? { body: JSON.stringify(body) } : {} };
      const economic = path === "/bounties" || /\/bounties\/[a-f0-9-]{36}\/attempts$/.test(path);
      response = runtime.paid && method === "POST" && economic ? await tempoClient.paidFetch("/api" + path, request) : await fetch("/api" + path, request);
    } catch (e) {
      throw Error(e?.message || "Cannot reach the arena server. Your saved build is safe.");
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error("Bounties need the game server. Start play-local.bat or node server.mjs; the static sandbox still works.");
    }
    if (!response.ok) {
      const e = Error(result.error || "Request failed.");
      e.status = response.status;
      throw e;
    }
    return result;
  }
  async function mutate(path, body) {
    const pending = read("wm-demo-outbox", null);
    if (pending && (pending.path !== path || JSON.stringify(pending.body) !== JSON.stringify(body))) throw Error("An earlier request needs recovery. Open the bounty board and choose Recover request.");
    const request = pending || { path, body, key: uid() };
    save("wm-demo-outbox", request);
    try {
      const result = await api(path, "POST", body, request.key);
      localStorage.removeItem("wm-demo-outbox");
      return result;
    } catch (e) {
      if (e.status && e.status < 500) localStorage.removeItem("wm-demo-outbox");
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
    const account = me ? runtime.paid ? "Account" : money(me.balance) + " demo credits" : "Sign in for bounties";
    return `<div class="page-heading bounty-heading"><div><span class="eyebrow">FOUNDRY CONTRACTS / ${runtime.paid ? "TEMPO MAINNET" : "DEMO SEASON 02"}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><button id="contracts-home">All contracts</button><button id="credits-btn">${account}</button></div></div>${read("wm-demo-outbox", null) ? '<div class="notice">A request was interrupted. Its idempotency key is saved. <button id="recover-request">Recover request</button></div>' : ""}`;
  }
  function wireHeader() {
    if ($("#contracts-home")) $("#contracts-home").onclick = () => open();
    if ($("#credits-btn")) $("#credits-btn").onclick = profile;
    if ($("#recover-request")) $("#recover-request").onclick = () => act($("#recover-request"), async () => {
      const p = read("wm-demo-outbox", null), r = await mutate(p.path, p.body);
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
    return me;
  }
  function thumb(canvas, packed) {
    adapter.thumbnail(canvas, unpackChallenge(packed, true).machine);
  }
  function drawThumbs(data) {
    $$("[data-contract-thumb]").forEach((c) => {
      const b = data.find((b2) => b2.id === c.dataset.contractThumb);
      if (b) thumb(c, b.blueprint);
    });
  }
  function terrain(arena) {
    const types = [...new Set(arena.terrain.map((t) => t.type))];
    return `<div class="terrain-tags">${arena.climate ? `<span class="terrain-tag climate" title="${esc(arena.desc)}">${esc(arena.climate.name)}</span>` : ""}${types.map((t) => `<span class="terrain-tag ${t}" title="${esc(TERRAIN_INFO[t]?.effect || "")}">${esc(TERRAIN_INFO[t]?.name || t)}</span>`).join("")}</div>`;
  }
  function feeNotice(b) {
    return `<div class="notice fee-disclosure"><strong>${b.platformFeeBps ? money(b.platformFeeBps / 100) + "% platform fee on a win" : "No platform fee \xB7 original contract terms"}</strong><br>Gross reward ${money(b.reward)} \u2212 platform fee ${money(b.platformFee)} = <strong>${money(b.payout)} paid to the winner</strong>. Entry costs ${money(b.entry)} separately. Net if you win: ${signed(b.netIfWin)} ${esc(runtime.currency)}. No payout fee on a loss, draw, refund or cancellation.</div>`;
  }
  function card(b) {
    const m = unpackChallenge(b.blueprint, true).machine, s = stats(m), a = ARENAS.find((a2) => a2.id === b.blueprint.a), fee = b.platformFeeBps ? `${money(b.payout)} winner payout \xB7 ${money(b.platformFeeBps / 100)}% platform fee` : `${money(b.payout)} winner payout \xB7 legacy terms / no platform fee`;
    return `<article class="contract-card"><div class="contract-card-top">${status(b.status)}<small>${b.listed ? "BOARD CONTRACT" : "UNLISTED LINK"}</small></div><div class="contract-preview"><canvas data-contract-thumb="${b.id}" width="300" height="260" aria-label="${esc(m.name)} machine"></canvas><span class="contract-reward"><b>${money(b.reward)}</b><small>GROSS REWARD</small></span></div><div class="contract-content"><h2>${esc(b.title)}</h2><p>${esc(a.name)} \xB7 ${s.cost} build credits \xB7 ${s.parts} fitted parts + core</p>${terrain(a)}<div class="contract-class">${esc(rulesLabel(b.blueprint.q))}</div><p class="card-fee">${fee}</p><div class="contract-footer"><span><b>${b.entry}</b> entry \xB7 ${b.attempts} trials</span><button data-contract="${b.id}">Inspect contract \u2197</button></div></div></article>`;
  }
  async function open(id) {
    const g = begin();
    window.history.replaceState(null, "", "#" + (id ? "bounty=" + id : "bounties"));
    app.innerHTML = header("THE CONTRACT BOARD.", "Build a counter. Break a machine. Claim the contract.") + '<div class="bounty-loading">Connecting to the arena\u2026</div>';
    wireHeader();
    try {
      const catalog = await api("/rules");
      await configureRuntime(catalog);
      currentFeeBps = catalog.economics.platformFee.basisPoints;
      if (catalog.versions.hash !== CLIENT_ENGINE_HASH) throw Error("This tab has an older game release. Reload the page before entering or replaying contracts.");
      await refreshMe();
      const data = await api(id ? "/bounties/" + id : "/bounties");
      const saved = me ? await api("/me/bookmarks") : [];
      savedIds = new Set(saved.map((b) => b.id));
      if (!id) {
        for (const b of saved) if (!data.some((n) => n.id === b.id)) data.push(b);
      }
      if (g !== generation) return;
      if (id) {
        current = data;
        detail(data, g);
        return;
      }
      app.innerHTML = header("THE CONTRACT BOARD.", "Build a counter. Break a machine. Claim the contract.") + `<section class="contract-hero"><div><span class="eyebrow">YOUR ENGINEERING. THEIR WEAK POINT.</span><h2>One machine to beat.<br>One challenger at a time.</h2><p>Scout the defender. Refine your build in free practice. The server runs your official attempt and settles the reward after the disclosed platform fee.</p><div class="contract-hero-actions"><button class="primary" id="new-contract">\uFF0B Create a bounty</button><button id="my-history">My attempts</button></div></div><div class="credit-summary"><span class="demo-stamp">${runtime.paid ? "TEMPO MAINNET \xB7 REAL USDC.e" : "DEMO CREDITS \xB7 NO CASH VALUE"}</span><div><b>${runtime.paid ? runtime.currency : me ? money(me.balance) : "1,000"}</b><span>${runtime.paid ? "WALLET PAYMENTS" : me ? "AVAILABLE" : "STARTING CREDITS"}</span></div><p>${runtime.paid ? "Each economic action has a separate wallet confirmation." : me ? money(me.reserved) + " reserved in your contracts" : "Create a free profile to enter trials."}</p><small>Creators choose entry, gross reward and build limits. New contracts: 2.5% platform fee on wins.<br>Read the terms before you enter.</small></div></section><div class="contract-filter"><div class="segmented">${[["open", "Available"], ["mine", "My contracts"], ["saved", "Saved"], ["all", "Closed"]].map(([v, t]) => `<button data-filter="${v}" class="${v === filter ? "active" : ""}">${t}</button>`).join("")}</div><button id="refresh-contracts">\u27F3 Refresh board</button></div><div class="contract-search"><input id="contract-search" type="search" aria-label="Search contracts" placeholder="Search machines or contracts" value="${esc(searchText)}"><select id="arena-filter" aria-label="Filter contracts by arena"><option value="">All arenas</option>${ARENAS.map((a) => `<option value="${a.id}" ${a.id === arenaFilter ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select><input id="fee-filter" type="number" min="0" aria-label="Maximum entry fee" placeholder="Max entry \xB7 any" value="${esc(feeFilter)}"></div><div class="contract-grid" id="contract-grid"></div><div class="notice bounty-footnote">Construction limits are separate from payment amounts. An official attempt locks both builds, the arena, terrain, and rules. A fresh server seed decides the trial. Practice is free and never pays rewards.</div>`;
      const draw = () => {
        const shown = data.filter((b) => (filter === "mine" ? b.owner === me?.id : filter === "saved" ? savedIds.has(b.id) : filter === "open" ? ["open", "busy"].includes(b.status) : !["open", "busy"].includes(b.status)) && (!arenaFilter || b.blueprint.a === arenaFilter) && (feeFilter === "" || b.entry <= +feeFilter) && (!searchText || (b.title + " " + b.blueprint.n + " " + b.ownerName).toLowerCase().includes(searchText.toLowerCase())));
        $("#contract-grid").innerHTML = shown.length ? shown.map(card).join("") : '<div class="bounty-empty">No contracts here yet. Create one from your workshop build.</div>';
        drawThumbs(shown);
        $$("[data-contract]").forEach((b) => b.onclick = () => open(b.dataset.contract));
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
      $$("[data-filter]").forEach((b) => b.onclick = () => {
        filter = b.dataset.filter;
        $$("[data-filter]").forEach((t) => t.classList.toggle("active", t === b));
        draw();
      });
      $("#new-contract").onclick = () => me ? create() : profile();
      $("#my-history").onclick = history;
      $("#refresh-contracts").onclick = () => open();
    } catch (e) {
      if (g !== generation) return;
      app.innerHTML = header("CONTRACTS OFFLINE.", esc(e.message)) + `<section class="panel bounty-empty"><p>${esc(e.message)}</p><button id="retry-contracts">Try again</button><button id="offline-workshop">Back to workshop</button>${e.status === 401 ? '<button id="reset-profile">Use a different profile key</button>' : ""}</section>`;
      wireHeader();
      $("#retry-contracts").onclick = () => open(id);
      $("#offline-workshop").onclick = adapter.workshop;
      if ($("#reset-profile")) $("#reset-profile").onclick = profile;
    }
  }
  function detail(b, g) {
    const m = unpackChallenge(b.blueprint, true).machine, s = stats(m), a = ARENAS.find((a2) => a2.id === b.blueprint.a), draft = adapter.getBuild(), issues = validate(draft.machine, b.blueprint.q), own = b.owner === me?.id;
    app.innerHTML = header("FIND THE WEAK POINT.", esc(b.title)) + `<div class="contract-detail"><section class="panel defender-card"><div class="contract-card-top">${status(b.status)}<small>${b.funded ? "REWARD RESERVED" : "CONTRACT CLOSED"}</small></div><canvas id="defender-preview" width="650" height="500" aria-label="Defender machine preview"></canvas><div class="defender-caption"><h2>${esc(m.name)}</h2><p>${s.cost} build credits \xB7 ${s.mass} t \xB7 ${s.parts} fitted parts + core \xB7 ${s.height} ${s.height === 1 ? "level" : "levels"}</p><span>${esc(m.tactic)} \xB7 targets ${esc(m.target)} \xB7 range ${m.range} \xB7 front ${["north", "east", "south", "west"][m.front || 0]}</span></div><div class="bounty-actions"><button id="inspect-defender" ${!b.compatible ? "disabled" : ""}>\u25CE Scout in 3D</button><button id="copy-contract">\u2197 Copy challenge link</button><button id="save-contract">${savedIds.has(b.id) ? "\u2605 Saved bounty" : "\u2606 Save bounty"}</button><button id="export-defender">\u2193 Blueprint JSON</button>${navigator.share ? '<button id="native-share-contract">Share\u2026</button>' : ""}</div></section><section class="panel contract-terms"><span class="eyebrow">${esc(b.ownerName)} / CONTRACT TERMS</span><h2>${esc(b.title)}</h2><div class="contract-economy"><div><b>${money(b.reward)}</b><small>GROSS REWARD</small></div><div><b>${money(b.entry)}</b><small>ENTRY COST</small></div><div><b>${signed(b.netIfWin)}</b><small>NET AFTER ALL FEES</small></div></div>${feeNotice(b)}<div class="contract-rule"><strong>${esc(a.name)}</strong><p>${esc(a.desc)}</p>${terrain(a)}</div><div class="contract-rule"><strong>${esc(rulesLabel(b.blueprint.q))}</strong><p>Locked for both machines. Autonomous combat \xB7 100 seconds \xB7 one official attempt at a time.</p></div><div class="contract-rule"><strong>Your counter: ${esc(draft.machine.name)}</strong><p>${issues.length ? esc(issues[0]) : stats(draft.machine).cost + " build credits \xB7 eligible for this contract"}</p></div><div class="bounty-actions"><button id="refit-counter" ${!b.compatible ? "disabled" : ""}>Refit counter</button><button id="free-practice" ${issues.length || !b.compatible ? "disabled" : ""}>Free practice</button></div><button id="official-entry" class="primary contract-enter" ${!me || own || b.status !== "open" || issues.length || !b.compatible ? "disabled" : ""}>${b.status === "busy" ? "Arena occupied \xB7 refreshes automatically" : own ? "Your contract \xB7 practice available" : b.status !== "open" ? "Contract " + b.status : "Enter official trial \xB7 " + b.entry + " demo credits"}</button>${!me ? '<button id="join-profile">Sign in to enter this bounty</button>' : ""}<p class="hint">Only a win claims the reward. A loss or draw spends ${b.entry} credits and reopens the contract. Technical failure refunds entry. ${own ? "You cannot claim your own reward." : ""}</p><p class="error-message" id="bounty-error">${!b.compatible ? "This engine version is archived. Its receipt and blueprint remain viewable; current-engine practice is unavailable. Unused idle reserves are returned automatically." : ""}</p><p class="contract-expiry">${b.expires ? "Expires " + time(b.expires) : "No deadline \xB7 until claimed or closed"} \xB7 ${b.attempts} attempts<br>${b.listed ? "Visible on the board" : "Unlisted: anyone with the link can view it."}</p>${own && ["open", "busy"].includes(b.status) ? `<button id="cancel-contract" ${b.status === "busy" ? "disabled" : ""}>Close contract \xB7 return ${b.reward} reserved credits</button>` : ""}</section></div><section class="panel contract-history"><h3>Verified attempts</h3>${b.history.length ? b.history.map((a2) => `<button data-attempt="${a2.id}" class="attempt-row"><span>${a2.result ? esc(a2.result.outcome.toUpperCase()) : "REFUNDED"}</span><small>${time(a2.created)}</small><strong>${a2.result ? Number(a2.result.time).toFixed(1) + "s" : "Technical failure"} \u2197</strong></button>`).join("") : "<p>No completed official trials yet. Be the first to test this defense.</p>"}</section>`;
    if (runtime.paid && $("#official-entry")) $("#official-entry").textContent = $("#official-entry").textContent.replace("demo credits", runtime.currency);
    thumb($("#defender-preview"), b.blueprint);
    wireHeader();
    $("#refit-counter").onclick = () => adapter.edit(b);
    $("#inspect-defender").onclick = () => adapter.scout(b);
    $("#free-practice").onclick = () => adapter.practice(b);
    $("#save-contract").onclick = (e) => {
      if (!me) {
        void profile();
        return;
      }
      void act(e.currentTarget, async () => {
        await api("/me/bookmarks/" + b.id, savedIds.has(b.id) ? "DELETE" : "PUT");
        await open(b.id);
      });
    };
    $("#copy-contract").onclick = () => copy(location.origin + location.pathname + "#bounty=" + b.id);
    $("#export-defender").onclick = () => download(b.blueprint, m.name + "-defender.json");
    if ($("#native-share-contract")) $("#native-share-contract").onclick = () => navigator.share({ title: b.title, text: "Can you beat this War Machines contract?", url: location.origin + location.pathname + "#bounty=" + b.id }).catch((e) => {
      if (e.name !== "AbortError") adapter.toast("Use Copy challenge link to share.");
    });
    $("#official-entry").onclick = (e) => act(e.currentTarget, async () => {
      const packed = packChallenge(adapter.getBuild().machine, b.blueprint.a, 0, b.blueprint.q);
      const result = await mutate("/bounties/" + b.id + "/attempts", { blueprint: packed, maxEntry: b.entry, maxPlatformFeeBps: b.platformFeeBps });
      await refreshMe();
      await attempt(result.id);
    });
    if ($("#join-profile")) $("#join-profile").onclick = profile;
    if ($("#cancel-contract")) $("#cancel-contract").onclick = (e) => act(e.currentTarget, async () => {
      await api("/bounties/" + b.id + "/cancel", "POST", {});
      await open(b.id);
    });
    $$("[data-attempt]").forEach((t) => t.onclick = () => attempt(t.dataset.attempt));
    if (b.status === "busy") schedule(async () => {
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
    if (!me) return profile();
    const g = begin(), draft = adapter.getBuild();
    let build = clone(draft.machine), customCaps = { ...draft.rules };
    app.innerHTML = header("SET THE CHALLENGE.", "Fund a reward. Share your machine. See who can break it.") + `<form id="create-contract" class="contract-create"><section class="panel create-preview"><canvas id="create-preview" width="480" height="420" aria-label="Your defending machine"></canvas><h2>${esc(build.name)}</h2><p id="create-stats"></p><p class="hint">This snapshots your current workshop build, including paint, front, upgrades, height and doctrine.</p><button type="button" id="back-build">Edit in workshop</button></section><section class="panel contract-form"><label class="field"><span>Contract title</span><input id="contract-title" required maxlength="70" value="${esc("Break " + build.name)}"></label><div class="form-two"><label class="field"><span>Entry \xB7 demo credits</span><input id="contract-entry" type="number" min="0" max="1000000000" step="1" value="10" required></label><label class="field"><span>Gross reward \xB7 demo credits</span><input id="contract-reward" type="number" min="0" max="1000000000" step="1" value="100" required></label></div><div class="notice" id="reserve-note"></div><div class="form-two"><label class="field"><span>Arena & terrain</span><select id="contract-arena">${ARENAS.map((a) => `<option value="${a.id}" ${a.id === draft.arena ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label><label class="field"><span>Construction class</span><select id="contract-class"><option value="standard">Standard \xB7 1200 credits</option><option value="custom">Custom limits</option><option value="unlimited">Unlimited \xB7 243 sockets</option></select></label></div><div id="contract-terrain" class="notice"></div><div class="form-four" id="contract-caps">${[["credits", "Construction credits", 1200, 1e6], ["parts", "Part count", 32, 243], ["mass", "Mass (tonnes)", 360, 1e5], ["weapons", "Weapon count", 8, 243]].map(([k, n, v, max]) => `<label class="field"><span>${n}</span><input data-cap="${k}" type="number" step="1" min="0" max="${max}" value="${draft.rules[k] ?? 0}" required></label>`).join("")}</div><p class="hint">Custom cap 0 = no limit. Unlimited removes all four caps; supports and the 9\xD79\xD73 grid still apply.</p><div class="form-two"><label class="field"><span>Duration \xB7 hours (0 = no deadline)</span><input id="contract-hours" type="number" min="0" max="8760" step="1" value="24" required></label><label class="field"><span>Sharing</span><select id="contract-listed"><option value="false">Unlisted \xB7 share by link</option><option value="true">Listed on contract board</option></select></label></div><p class="hint">Unlisted links are viewable by anyone who receives them. Terms cannot change after funding. Close an idle contract to recover its unused reward.</p><p id="bounty-error" class="error-message" role="status"></p><button class="primary contract-enter" id="fund-contract" type="submit">Fund & create contract</button></section></form>`;
    $("#contract-entry").previousElementSibling.textContent = `Entry \xB7 ${runtime.currency}`;
    $("#contract-reward").previousElementSibling.textContent = `Gross reward \xB7 ${runtime.currency}`;
    wireHeader();
    adapter.thumbnail($("#create-preview"), build);
    $("#contract-class").value = ["standard", "unlimited"].includes(draft.rules.mode) ? draft.rules.mode : "custom";
    const rules = () => {
      const mode = $("#contract-class").value;
      return normalizeRules(mode === "standard" ? DEFAULT_RULES : { mode, combat: "auto", ...Object.fromEntries($$("[data-cap]").map((e) => [e.dataset.cap, +e.value || null])) });
    };
    const update = () => {
      try {
        const r = rules(), issues = validate(build, r), entry = +$("#contract-entry").value, reward = +$("#contract-reward").value, a = ARENAS.find((a2) => a2.id === $("#contract-arena").value);
        $$("[data-cap]").forEach((e) => {
          e.disabled = r.mode !== "custom";
          if (e.disabled) e.value = r[e.dataset.cap] ?? 0;
        });
        $("#create-stats").textContent = stats(build).cost + " build credits \xB7 " + stats(build).parts + " parts \xB7 " + stats(build).mass + " t";
        const quote = rewardQuote(reward, entry, currentFeeBps);
        $("#reserve-note").textContent = runtime.paid ? `${money(reward)} ${runtime.currency} transfers to escrow after a separate wallet confirmation. Platform fee: ${money(currentFeeBps / 100)}% of a winning reward (${money(quote.platformFee)} ${runtime.currency}). Winner receives ${money(quote.payout)}; network fees are separate.` : `${money(reward)} credits reserved now; ${money(me.balance - reward)} available afterward. Platform fee: ${money(currentFeeBps / 100)}% of a winning reward (${money(quote.platformFee)} credits). Winner receives ${money(quote.payout)}; net after entry: ${signed(quote.netIfWin)}. Fee comes from this reward, with no extra charge to the creator. You choose entry and gross reward; no required ratio.`;
        $("#contract-terrain").innerHTML = esc(a.desc) + terrain(a);
        if (!runtime.paid && reward > me.balance) issues.push("Not enough available demo credits to fund this reward.");
        $("#bounty-error").textContent = issues.join(" ");
        $("#fund-contract").disabled = !!issues.length;
      } catch (e) {
        $("#bounty-error").textContent = e.message;
        $("#fund-contract").disabled = true;
      }
    };
    $("#create-contract").oninput = (e) => {
      if (e.target.dataset.cap) customCaps[e.target.dataset.cap] = +e.target.value || null;
      if (e.target.id !== "contract-class") update();
    };
    $("#create-contract").onchange = (e) => {
      if (e.target.id === "contract-class") $$("[data-cap]").forEach((input) => input.value = customCaps[input.dataset.cap] ?? 0);
      update();
    };
    update();
    $("#back-build").onclick = adapter.workshop;
    $("#create-contract").onsubmit = (e) => {
      e.preventDefault();
      void act($("#fund-contract"), async () => {
        const body = { maxPlatformFeeBps: currentFeeBps, title: $("#contract-title").value, blueprint: packChallenge(build, $("#contract-arena").value, 0, rules()), entry: +$("#contract-entry").value, reward: +$("#contract-reward").value, hours: +$("#contract-hours").value, listed: $("#contract-listed").value === "true" }, b = await mutate("/bounties", body);
        if (g === generation) await open(b.id);
      });
    };
  }
  async function attempt(id) {
    const g = begin();
    app.innerHTML = header("OFFICIAL TRIAL.", "The arena server verifies this result.") + '<div class="bounty-loading">Loading attempt\u2026</div>';
    wireHeader();
    async function poll() {
      try {
        const a = await api("/attempts/" + id);
        if (g !== generation) return;
        await refreshMe();
        if (["queued", "running"].includes(a.status)) {
          app.innerHTML = header("YOUR MACHINE IS COMMITTED.", "The entry is recorded once. You can leave and return safely.") + `<section class="panel trial-wait"><div class="trial-spinner" aria-hidden="true">\u25C8</div><span class="eyebrow">${a.status === "queued" ? "QUEUED FOR VERIFICATION" : "SIMULATING ON THE SERVER"}</span><h2>Engineering meets reality.</h2><p>Both builds are locked. Other challengers wait until this contract reopens or its reward is claimed.</p><p class="hint">No need to keep this tab open. Find the result under My attempts.</p><button id="pending-contract">View contract</button></section>`;
          wireHeader();
          $("#pending-contract").onclick = () => open(a.bounty);
          schedule(poll, g, 1e3);
          return;
        }
        const r = a.result, won = r?.outcome === "win";
        app.innerHTML = header("THE VERDICT.", r ? "Verified by the arena server." : "Your entry has been returned.") + `<section class="panel official-result ${won ? "won" : ""}"><span class="eyebrow">${r ? "SERVER VERIFIED \xB7 " + esc(r.reason) : "TECHNICAL REFUND"}</span><h2>${won ? "CONTRACT CLAIMED." : r?.outcome === "draw" ? "DEFENSE HELD." : r ? "BACK TO THE DRAWING BOARD." : "CREDITS RETURNED."}</h2><div class="contract-economy"><div><b>${r ? (r.net > 0 ? "+" : "") + r.net : "REFUND"}</b><small>DEMO CREDIT CHANGE</small></div><div><b>${r ? r.time.toFixed(1) + "s" : "\u2014"}</b><small>TRIAL DURATION</small></div><div><b>${me ? money(me.balance) : "\u2014"}</b><small>YOUR BALANCE</small></div></div><p>${r ? `Your integrity: ${(r.integrity[0] * 100).toFixed(1)}% \xB7 Defender: ${(r.integrity[1] * 100).toFixed(1)}%. ${won ? "Your payout after the platform fee is in your balance." : "A loss or draw does not claim the reward. Check the contract for its current availability."}` : esc(a.error)}</p>${r ? `<div class="notice fee-disclosure">Gross reward: ${money(r.grossReward ?? r.reward)} \xB7 Platform fee: ${money(r.platformFee ?? 0)} (${money((r.platformFeeBps ?? 0) / 100)}% on wins) \xB7 Paid to you: ${money(r.payout ?? r.reward)} \xB7 Separate entry: ${money(r.entry)} demo credits.</div>` : ""}<div class="bounty-actions">${r ? '<button id="verified-replay" class="primary">\u25B6 Watch exact replay</button>' : ""}<button id="result-contract">Back to contract</button><button id="result-refit">Refit counter</button></div><p class="hint">Attempt ${esc(a.id)} \xB7 ${time(a.updated)}<br>The replay is a local reconstruction. This receipt is the server\u2019s stored result.</p><p id="bounty-error" class="error-message"></p></section>`;
        if (runtime.paid) {
          const states = (a.settlement || []).map((s) => `${s.kind}: ${s.status}`).join(" \xB7 ") || "no outgoing transfer";
          const economy = $$(".contract-economy > div");
          economy[0].querySelector("small").textContent = `CONTRACT NET \xB7 ${runtime.currency}`;
          economy[2].querySelector("b").textContent = "ON-CHAIN";
          economy[2].querySelector("small").textContent = "PAYOUT STATUS";
          const summary = $(".official-result > p");
          if (summary) summary.textContent = `${summary.textContent.replace("Your payout after the platform fee is in your balance.", "The battle result is final; cash receipt depends on the on-chain state.")} Settlement: ${states}.`;
          const disclosure = $(".official-result .fee-disclosure");
          if (disclosure) disclosure.textContent = disclosure.textContent.replace("demo credits", runtime.currency);
        }
        wireHeader();
        $("#result-contract").onclick = () => open(a.bounty);
        $("#result-refit").onclick = (e) => act(e.currentTarget, async () => {
          const b = await api("/bounties/" + a.bounty);
          if (!b.compatible) throw Error("This contract uses an archived engine. Export its blueprint to adapt it in the workshop.");
          adapter.edit(b);
        });
        if ($("#verified-replay")) $("#verified-replay").onclick = (e) => act(e.currentTarget, async () => {
          const catalog = await api("/rules");
          currentFeeBps = catalog.economics.platformFee.basisPoints;
          if (catalog.versions.hash !== CLIENT_ENGINE_HASH) throw Error("Reload this tab to load the current simulation before replaying.");
          if (catalog.versions.hash !== a.replay.versions.hash) throw Error("Replay belongs to an archived engine version; its verified receipt remains available.");
          adapter.replay(a, await api("/bounties/" + a.bounty));
        });
      } catch (e) {
        if (g !== generation) return;
        app.innerHTML = header("RESULT PENDING.", esc(e.message)) + '<section class="panel bounty-empty"><p>The accepted trial continues on the server. Reopen My attempts to retrieve it.</p><button id="retry-attempt">Check again</button></section>';
        wireHeader();
        $("#retry-attempt").onclick = () => attempt(id);
      }
    }
    await poll();
  }
  async function history() {
    if (!me) return profile();
    const g = begin();
    app.innerHTML = header("YOUR TRIALS.", "Official attempts persist across reloads.") + '<div class="bounty-loading">Loading history\u2026</div>';
    wireHeader();
    try {
      const rows = await api("/me/attempts");
      if (g !== generation) return;
      app.innerHTML = header("YOUR TRIALS.", "Official attempts persist across reloads.") + `<section class="panel contract-history">${rows.map((a) => `<button data-attempt="${a.id}" class="attempt-row"><span>${esc(a.result?.outcome || a.status)}</span><small>${time(a.created)}</small><strong>${a.result ? (a.result.net > 0 ? "+" : "") + a.result.net + " credits" : "View status"} \u2197</strong></button>`).join("") || "<p>No official trials yet. Choose an available contract to start.</p>"}</section>`;
      wireHeader();
      $$("[data-attempt]").forEach((b) => b.onclick = () => attempt(b.dataset.attempt));
    } catch (e) {
      adapter.toast(e.message);
    }
  }
  async function profile() {
    const returnId = location.hash.startsWith("#bounty=") ? location.hash.slice(8) : void 0;
    const g = begin();
    try {
      await configureRuntime(await api("/rules"));
      await refreshMe();
    } catch (e) {
      adapter.toast(e.message);
    }
    if (runtime.paid && !me) {
      app.innerHTML = header("YOUR TEMPO PROFILE.", "Verified identity for mainnet contracts. A signature never authorizes payment.") + `<section class="panel profile-form"><span class="demo-stamp">TEMPO MAINNET \xB7 REAL USDC.e</span><h2>Verify your account.</h2><p class="sign-in-note">Connect a Tempo-compatible wallet or use a passkey already linked to one. Funding and entry payments are separate, itemized wallet confirmations.</p><button class="primary" id="tempo-wallet-login">Connect wallet & sign in</button><button id="tempo-passkey-login">Sign in with passkey</button><button type="button" class="account-guest-link" id="continue-guest">Continue as guest \u2197</button><p id="bounty-error" class="error-message"></p></section>`;
      wireHeader();
      $("#continue-guest").onclick = adapter.workshop;
      $("#tempo-wallet-login").onclick = (e) => act(e.currentTarget, async () => {
        await tempoClient.signInWallet();
        await refreshMe();
        await open(returnId);
      });
      $("#tempo-passkey-login").onclick = (e) => act(e.currentTarget, async () => {
        await tempoClient.signInPasskey();
        await refreshMe();
        await open(returnId);
      });
      return;
    }
    if (runtime.paid && me) {
      const agents = await api("/agents");
      if (g !== generation) return;
      const wallet = me.identities.find((i) => i.scheme === "tempo")?.address;
      app.innerHTML = header("MAINNET BOUNDARIES.", "Identity, payout destination, and delegated spending authority.") + `<div class="profile-grid"><form id="mainnet-settings" class="panel profile-form"><span class="demo-stamp">TEMPO MAINNET \xB7 REAL USDC.e</span><h2>${esc(me.name)}</h2><p>${wallet ? `Verified payout wallet: <code>${esc(wallet)}</code>` : "Passkey session active. Link a Tempo wallet before funding or receiving rewards."}</p><p>Every charge requires its own wallet confirmation. Platform fees apply only to winning rewards; network fees are separate.</p><label class="field"><span>Pilot name</span><input id="pilot-name" required maxlength="28" value="${esc(me.name)}"></label><button class="primary">Save profile</button><button type="button" id="register-passkey">Register recovery passkey</button><button type="button" id="mainnet-logout">Sign out</button><p id="bounty-error" class="error-message"></p></form><section class="panel profile-form"><span class="eyebrow">RESTRICTED AGENT KEY</span><h2>Explicit authority only.</h2><label class="field"><span>Agent name</span><input id="agent-name" maxlength="28" value="My engineer"></label><div class="form-two"><label class="field"><span>Per-entry cap \xB7 ${esc(runtime.currency)}</span><input id="agent-entry-cap" type="number" min="0" step="1" required value="0"></label><label class="field"><span>Total spend cap \xB7 ${esc(runtime.currency)}</span><input id="agent-spend-cap" type="number" min="0" step="1" required value="0"></label></div><label class="field"><span>Reward-funding cap \xB7 ${esc(runtime.currency)}</span><input id="agent-reward-cap" type="number" min="0" step="1" required value="0"></label><label><input id="agent-enter" type="checkbox"> Enter contracts</label><label><input id="agent-create" type="checkbox"> Create/fund contracts</label><label><input id="agent-bookmark" type="checkbox" checked> Save bookmarks</label><button id="new-agent-key">Create bounded agent key</button><div id="new-key-result"></div>${agents.map((a) => `<div class="agent-row"><span>${esc(a.name)} <small>${a.revoked ? "REVOKED" : "ACTIVE"}</small></span>${!a.revoked ? `<button data-revoke="${a.id}">Revoke</button>` : ""}</div>`).join("")}</section></div>`;
      wireHeader();
      if (!wallet) {
        $("#register-passkey").disabled = true;
        $("#register-passkey").textContent = "Sign out, connect a wallet, then add recovery";
      }
      $("#mainnet-settings").onsubmit = (e) => {
        e.preventDefault();
        void act($("#mainnet-settings .primary"), async () => {
          me = await api("/me", "PATCH", { name: $("#pilot-name").value });
          adapter.toast("Profile saved.");
        });
      };
      $("#register-passkey").onclick = (e) => act(e.currentTarget, async () => {
        const result = await tempoClient.registerPasskey(me.name);
        adapter.toast(result.linkedToTempo ? "Recovery passkey linked." : "Passkey registered.");
        await refreshMe();
      });
      $("#mainnet-logout").onclick = (e) => act(e.currentTarget, async () => {
        await tempoClient.logout();
        me = null;
        await profile();
      });
      $("#new-agent-key").onclick = (e) => act(e.currentTarget, async () => {
        const scopes = ["read", ...$("#agent-bookmark").checked ? ["bookmark"] : [], ...$("#agent-enter").checked ? ["enter"] : [], ...$("#agent-create").checked ? ["create"] : []], result = await api("/agents", "POST", { name: $("#agent-name").value, scopes, contracts: null, expires: Date.now() + 30 * 864e5, entryCap: +$("#agent-entry-cap").value, spendCap: +$("#agent-spend-cap").value, rewardCap: +$("#agent-reward-cap").value });
        $("#new-key-result").innerHTML = '<p class="notice">Copy this private key now; it is shown once.</p><input id="agent-key-value" readonly aria-label="New private agent key"><button id="copy-agent-key">Copy agent key</button>';
        $("#agent-key-value").value = result.token;
        $("#copy-agent-key").onclick = () => copy(result.token);
      });
      $$("[data-revoke]").forEach((b) => b.onclick = () => act(b, async () => {
        await api("/agents/" + b.dataset.revoke, "DELETE");
        await profile();
      }));
      return;
    }
    if (!token) {
      app.innerHTML = header("YOUR DEMO PROFILE.", "Sign in for bounties. Building, local saves and free play need no login.") + `<form id="join-demo" class="panel profile-form"><span class="demo-stamp">NO WALLETS \xB7 NO CASH VALUE</span><h2>Your bounty account.</h2><p class="sign-in-note">Create, enter and save bounties here. Start with 1,000 demo credits. Local blueprint saves and ordinary play always work as a guest.</p><label class="field"><span>Pilot name</span><input id="pilot-name" required maxlength="28" value="Independent engineer"></label><p>Your balance and official trials live on this server. This browser stores your access key. Demo profiles are for gameplay testing, not an economy with real value.</p><button class="primary">Create bounty account</button><button type="button" class="account-guest-link" id="continue-guest">Continue to guest workshop \u2197</button><p id="bounty-error" class="error-message"></p><details><summary>Restore a saved profile key</summary><input id="restore-token" type="password" aria-label="Profile access key" autocomplete="off"><button type="button" id="restore-profile">Restore profile</button></details></form>`;
      wireHeader();
      $("#continue-guest").onclick = adapter.workshop;
      $("#join-demo").onsubmit = (e) => {
        e.preventDefault();
        void act($("#join-demo button"), async () => {
          const result = await api("/session", "POST", { name: $("#pilot-name").value });
          token = result.token;
          save("wm-demo-token", token);
          me = result.me;
          await open(returnId);
        });
      };
      $("#restore-profile").onclick = () => restore($("#restore-token").value);
      return;
    }
    try {
      await refreshMe();
      const [ledger, agents] = await Promise.all([api("/me/ledger"), api("/agents")]);
      if (g !== generation) return;
      app.innerHTML = header("SET YOUR BOUNDARIES.", "Control what you and your external agents can spend.") + `<div class="profile-grid"><form id="credit-settings" class="panel profile-form"><span class="demo-stamp">DEMO CREDITS \xB7 NO CASH VALUE</span><h2>${money(me.balance)} available</h2><p>${money(me.reserved)} reserved \xB7 ${me.spentToday} entry credits spent today</p><label class="field"><span>Pilot name</span><input id="pilot-name" required maxlength="28" value="${esc(me.name)}"></label><div class="form-two"><label class="field"><span>Maximum per entry</span><input id="entry-cap" type="number" min="0" max="1000000000" placeholder="Unlimited" value="${me.entryCap ?? ""}"></label><label class="field"><span>Daily entry budget (UTC)</span><input id="daily-cap" type="number" min="0" max="1000000000" placeholder="Unlimited" value="${me.dailyCap ?? ""}"></label></div><p class="hint">Caps apply to you and all your agent keys together. Leave blank for no personal cap. Zero allows free entries only. Reward funding is separate and limited by your available balance.</p><button class="primary">Save spending limits</button><p id="bounty-error" class="error-message"></p><details><summary>Back up or restore this profile</summary><p>Keep the owner key private. Anyone with it controls this demo account.</p><button type="button" id="backup-key">Copy owner access key</button><input id="restore-token" type="password" autocomplete="off" aria-label="Profile key to restore"><button type="button" id="restore-profile">Restore another profile</button></details></form><section class="panel profile-form"><span class="eyebrow">BRING YOUR OWN AGENT</span><h2>Your agent. Its own compute.</h2><p>Agents read terrain and the catalog, validate builds, practice, create/save/cancel bounties, and submit trials through the API. This game does not host an AI model.</p><label class="field"><span>Agent key name</span><input id="agent-name" maxlength="28" value="My engineer"></label><button id="new-agent-key">Create restricted agent key</button><div id="new-key-result"></div><p class="hint">Agent keys share your balance and entry caps. They can fund, save and cancel your bounties, but cannot change spending caps or create other keys. Revoke at any time.</p>${agents.map((a) => `<div class="agent-row"><span>${esc(a.name)} <small>${a.revoked ? "REVOKED" : "ACTIVE"}</small></span>${!a.revoked ? `<button data-revoke="${a.id}">Revoke</button>` : ""}</div>`).join("")}<a class="api-link" href="/api/rules" target="_blank" rel="noopener">Read the machine catalog & API rules \u2197</a><p class="hint">The repository includes docs/AGENT-API.md and a dependency-free example client.</p></section></div><section class="panel contract-history"><h3>Credit ledger</h3>${ledger.map((l) => `<div class="attempt-row"><span>${esc(l.kind)}</span><small>${time(l.created)}</small><strong class="${l.amount > 0 ? "credit-gain" : ""}">${signed(l.amount)}</strong></div>`).join("")}</section>`;
      wireHeader();
      $("#credit-settings").onsubmit = (e) => {
        e.preventDefault();
        void act($("#credit-settings .primary"), async () => {
          me = await api("/me", "PATCH", { name: $("#pilot-name").value, entryCap: $("#entry-cap").value === "" ? null : +$("#entry-cap").value, dailyCap: $("#daily-cap").value === "" ? null : +$("#daily-cap").value });
          adapter.toast("Spending limits saved.");
        });
      };
      $("#backup-key").onclick = () => copy(token);
      $("#restore-profile").onclick = () => restore($("#restore-token").value);
      $("#new-agent-key").onclick = (e) => act(e.currentTarget, async () => {
        const result = await api("/agents", "POST", { name: $("#agent-name").value });
        $("#new-key-result").innerHTML = '<p class="notice">Copy this private key now; it is shown once.</p><input id="agent-key-value" readonly aria-label="New private agent key"><button id="copy-agent-key">Copy agent key</button>';
        $("#agent-key-value").value = result.token;
        $("#copy-agent-key").onclick = () => copy(result.token);
        e.target.disabled = true;
      });
      $$("[data-revoke]").forEach((b) => b.onclick = () => act(b, async () => {
        await api("/agents/" + b.dataset.revoke, "DELETE");
        await profile();
      }));
    } catch (e) {
      if (g !== generation) return;
      app.innerHTML = header("RESTORE YOUR PROFILE.", esc(e.message)) + '<section class="panel profile-form"><input id="restore-token" type="password" aria-label="Saved owner key"><button id="restore-profile">Restore profile</button><button id="fresh-profile">Create a new demo profile</button><p>Without a saved key, an old demo balance cannot be recovered. Your workshop build is stored separately.</p></section>';
      wireHeader();
      $("#restore-profile").onclick = () => restore($("#restore-token").value);
      $("#fresh-profile").onclick = () => {
        token = null;
        me = null;
        localStorage.removeItem("wm-demo-token");
        localStorage.removeItem("wm-demo-outbox");
        void profile();
      };
    }
  }
  async function restore(value) {
    const old = token;
    token = value.trim();
    try {
      await refreshMe();
      save("wm-demo-token", token);
      localStorage.removeItem("wm-demo-outbox");
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
      adapter.modal("Copy this text", `<textarea class="share-code" readonly>${esc(value)}</textarea><p>Select the text and copy it.</p>`);
    }
  }
  function download(value, name) {
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  return { open, leave, profile, attempt };
}
export {
  createBountyUI
};
