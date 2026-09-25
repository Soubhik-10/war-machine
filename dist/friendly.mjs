import { ARENAS, packChallenge, stats, unpackChallenge, validate } from "./data.mjs";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

export function createFriendlyChallengesUI(adapter) {
  const app = $("#app");
  let generation = 0;
  let ticker = 0;
  let refreshTimer = 0;
  let clientId;

  function localClientId() {
    if (clientId) return clientId;
    try {
      clientId = localStorage.getItem("wm-friendly-client-id");
      if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) {
        clientId = crypto.randomUUID();
        localStorage.setItem("wm-friendly-client-id", clientId);
      }
    } catch {
      clientId = crypto.randomUUID();
    }
    return clientId;
  }

  function stop() {
    generation += 1;
    clearInterval(ticker);
    clearTimeout(refreshTimer);
    ticker = 0;
    refreshTimer = 0;
    return generation;
  }

  async function request(path, options) {
    const result = await fetch(path, {
      credentials: "same-origin",
      headers: { accept: "application/json", ...(options?.body ? { "content-type": "application/json" } : {}) },
      ...options,
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) throw Error(payload.error || "Friendly challenges are temporarily unavailable.");
    return payload;
  }

  function countdown(expires) {
    const seconds = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
    if (!seconds) return "EXPIRED";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(rest).padStart(2, "0")}s left`;
  }

  function challengeCard(challenge) {
    const machine = unpackChallenge(challenge.blueprint, true).machine;
    const machineStats = stats(machine);
    const arena = ARENAS.find((item) => item.id === challenge.blueprint.a);
    return `<article class="contract-card friendly-card" data-friendly-card="${esc(challenge.id)}">
      <div class="contract-card-top"><span class="friendly-live"><i></i> OPEN TO CHALLENGE</span><time class="friendly-countdown" data-expiry="${challenge.expires}" role="timer">${countdown(challenge.expires)}</time></div>
      <div class="contract-preview"><canvas data-friendly-thumb="${esc(challenge.id)}" width="300" height="260" aria-label="${esc(challenge.challengerName)}’s machine in 3D"></canvas><span class="friendly-machine-tag">${esc(machine.name)}</span></div>
      <div class="contract-content"><span class="eyebrow">CHALLENGER · ${esc(challenge.challengerName)}</span><h2>${esc(challenge.title)}</h2>
      <p>${esc(arena?.name || challenge.blueprint.a)} · ${machineStats.cost} build credits · ${machineStats.mass} t · ${machineStats.parts} fitted parts</p>
      <div class="friendly-card-meta"><span>${machineStats.height} ${machineStats.height === 1 ? "level" : "levels"}</span><span>${machineStats.weapons} ${machineStats.weapons === 1 ? "weapon" : "weapons"}</span><span>Free · no entry</span></div>
      <div class="contract-footer"><small>No separate build deadline while listed</small><div class="friendly-card-actions"><button data-copy-friendly="${esc(challenge.id)}">Copy invite</button><button class="primary" data-practice-friendly="${esc(challenge.id)}">Challenge this build ↗</button></div></div></div>
    </article>`;
  }

  function drawThumbs(rows) {
    for (const canvas of app.querySelectorAll("[data-friendly-thumb]")) {
      const challenge = rows.find((item) => item.id === canvas.dataset.friendlyThumb);
      if (challenge) adapter.thumbnail(canvas, unpackChallenge(challenge.blueprint, true).machine);
    }
  }

  function bindCards(rows) {
    drawThumbs(rows);
    app.querySelectorAll("[data-practice-friendly]").forEach((button) => {
      button.onclick = () => {
        const item = rows.find((row) => row.id === button.dataset.practiceFriendly);
        if (item) adapter.practice({ ...item, id: item.id, friendly: true });
      };
    });
    app.querySelectorAll("[data-copy-friendly]").forEach((button) => {
      button.onclick = async () => {
        const link = `${location.origin}${location.pathname}#friendly=${encodeURIComponent(button.dataset.copyFriendly)}`;
        try {
          await navigator.clipboard.writeText(link);
          adapter.toast("Invite link copied.");
        } catch {
          adapter.modal("Copy friendly invite", `<label class="field"><span>Invite link</span><textarea class="share-code" readonly>${esc(link)}</textarea></label><p>Select and copy the link to send it to a friend.</p>`);
        }
      };
    });
    app.querySelectorAll(".friendly-countdown").forEach((node) => {
      node.textContent = countdown(Number(node.dataset.expiry));
    });
  }

  function tickCountdowns() {
    app.querySelectorAll(".friendly-countdown").forEach((node) => {
      node.textContent = countdown(Number(node.dataset.expiry));
    });
  }

  function openCreateDialog() {
    const build = adapter.getBuild();
    const issues = validate(build.machine, build.rules);
    if (issues.length) {
      adapter.toast(`Finish the machine first: ${issues[0]}`);
      return;
    }
    const name = build.machine.name || "Independent engineer";
    adapter.modal(
      "Post a friendly challenge",
      `<p>Your current machine will be shown publicly in 3D for 24 hours. Anyone can challenge it for free; the listing has no build countdown. Matches use the normal arena rules.</p>
       <label class="field"><span>Challenger name</span><input id="friendly-name" maxlength="28" value="${esc(name)}" autocomplete="nickname" required></label>
       <label class="field"><span>Challenge title</span><input id="friendly-title" maxlength="70" value="${esc(name)} · friendly challenge" required></label>
       <p id="friendly-create-error" class="error-message" role="alert"></p>
       <div class="modal-footer"><button data-close>Cancel</button><button class="primary" id="friendly-publish">Post for 24 hours</button></div>`,
      () => {
        const button = $("#friendly-publish");
        button.onclick = async () => {
          const challengerName = $("#friendly-name").value.trim();
          const title = $("#friendly-title").value.trim();
          const errorNode = $("#friendly-create-error");
          if (!challengerName || !title) {
            errorNode.textContent = "Enter a challenger name and a short title.";
            return;
          }
          button.disabled = true;
          errorNode.textContent = "Posting your machine…";
          try {
            await request("/api/friendly-challenges", {
              method: "POST",
              body: JSON.stringify({
                challengerName,
                title,
                clientId: localClientId(),
                blueprint: packChallenge(build.machine, build.arena, 0, build.rules, build.objective),
              }),
            });
            adapter.modalClose?.();
            await open(undefined, { restore: true });
            adapter.toast("Friendly challenge posted for 24 hours.");
          } catch (error) {
            errorNode.textContent = error.message || "Could not post this challenge.";
            button.disabled = false;
          }
        };
      },
    );
  }

  function shell(title = "FRIENDLY CHALLENGES.", subtitle = "Free machine matchups. No wallet, no entry fee.") {
    return `<div class="page-heading bounty-heading friendly-heading"><div class="bounty-heading-copy"><span class="eyebrow">WAR MACHINES / FREE PLAY</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions"><button class="primary" id="friendly-create">＋ Post your machine</button><button id="friendly-refresh">⟳ Refresh board</button></div></div>
      <div class="friendly-rules"><strong>24-hour listing window</strong><span>This is only how long the invite stays listed. There is no separate acceptance or build countdown; matches use normal arena rules.</span><span>Free to post and challenge · no wallet · no bounty or payment records.</span></div><div class="friendly-meta-notice"><span>Completed friendly battles contribute replay-verified telemetry to the public daily Meta reports. Raw battle logs are kept for 7 days; reports omit names and wallet addresses.</span><a href="#meta">See the data and daily reports →</a></div>`;
  }

  function bindShell(rows, currentGeneration) {
    $("#friendly-create").onclick = openCreateDialog;
    $("#friendly-refresh").onclick = () => void open(undefined, { restore: true });
    bindCards(rows);
    clearInterval(ticker);
    ticker = setInterval(tickCountdowns, 1000);
    clearTimeout(refreshTimer);
    const scheduleRefresh = () => {
      refreshTimer = setTimeout(() => {
        if (generation !== currentGeneration) return;
        if ($("#modal")?.open) scheduleRefresh();
        else void open(undefined, { restore: true });
      }, 30000);
    };
    scheduleRefresh();
  }

  async function open(id, { restore = false } = {}) {
    if (!restore && adapter.navigate) {
      adapter.navigate({ name: id ? "friendlyChallenge" : "friendly", value: id || undefined });
      return;
    }
    const currentGeneration = stop();
    adapter.show();
    app.innerHTML = shell() + '<div class="friendly-loading" role="status">Loading open friendly challenges…</div>';
    $("#friendly-create").onclick = openCreateDialog;
    $("#friendly-refresh").onclick = () => void open(id, { restore: true });
    try {
      const data = await request(id ? `/api/friendly-challenges/${encodeURIComponent(id)}` : "/api/friendly-challenges");
      if (generation !== currentGeneration) return;
      const rows = id ? [data] : data;
      const list = `<section class="friendly-board"><div class="contract-filter"><div><span class="eyebrow">${id ? "SHARED INVITE" : "OPEN MATCHUPS"}</span><h2>${id ? "Challenge details" : `${rows.length} open ${rows.length === 1 ? "challenge" : "challenges"}`}</h2></div><span class="friendly-update">AUTO-REFRESH · 30 SEC</span></div><div class="contract-grid" id="friendly-grid">${rows.map(challengeCard).join("") || '<div class="bounty-empty"><h2>No open friendly challenges</h2><p>Post your current machine and invite friends to test it—free, with a full 24-hour listing window.</p><button class="primary" id="friendly-create-empty">Post a friendly challenge</button></div>'}</div></section>`;
      app.innerHTML = shell(id ? "FRIENDLY INVITE." : undefined, id ? "Challenge this machine at your own pace." : undefined) + list;
      const emptyCreate = $("#friendly-create-empty");
      if (emptyCreate) emptyCreate.onclick = openCreateDialog;
      bindShell(rows, currentGeneration);
    } catch (error) {
      if (generation !== currentGeneration) return;
      app.innerHTML = shell() + `<section class="panel friendly-error"><h2>Could not load the board</h2><p>${esc(error.message)}</p><button class="primary" id="friendly-retry">Try again</button></section>`;
      $("#friendly-create").onclick = openCreateDialog;
      $("#friendly-refresh").onclick = () => void open(id, { restore: true });
      $("#friendly-retry").onclick = () => void open(id, { restore: true });
    }
  }

  return { open };
}
