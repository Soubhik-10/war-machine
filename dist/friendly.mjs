import { ARENAS, packChallenge, stats, unpackChallenge, validate } from "./data.mjs";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const humanNumber = (value) => number(value).toLocaleString();
const formatSeconds = (value) => {
  const seconds = Math.max(0, number(value));
  if (seconds >= 60)
    return Math.floor(seconds / 60) + "m " + Math.round(seconds % 60) + "s";
  return seconds.toFixed(seconds < 10 ? 1 : 0) + "s";
};
function readResult(match) {
  return match?.result && typeof match.result === "object" ? match.result : match || {};
}
function matchOutcome(match) {
  const result = readResult(match);
  const label = String(result.outcome || match?.outcome || result.status || match?.status || "").toLowerCase();
  const winner = Number.isFinite(Number(result.winner))
    ? Number(result.winner)
    : Number.isFinite(Number(match?.winner))
      ? Number(match.winner)
      : null;
  if (label.includes("draw") || winner === -1) return "draw";
  if (["win", "won", "victory", "side0", "side-0"].includes(label) || winner === 0)
    return "side0";
  if (["loss", "lost", "defeat", "side1", "side-1"].includes(label) || winner === 1)
    return "side1";
  return "complete";
}
function unpackMachine(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.machine?.modules) return candidate.machine;
  if (candidate.modules) return candidate;
  try {
    return unpackChallenge(candidate, true).machine;
  } catch {
    return null;
  }
}
function readableBlueprint(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.blueprint) return candidate.blueprint;
  try {
    unpackChallenge(candidate, true);
    return candidate;
  } catch {
    return null;
  }
}
function matchChallenge(match, fallback = null) {
  return match?.challenge?.blueprint
    ? match.challenge
    : match?.friendlyChallenge?.blueprint
      ? match.friendlyChallenge
      : fallback;
}
function matchId(match) {
  return String(match?.id || match?.matchId || match?.match?.id || "");
}
function matchIsVerified(match) {
  const result = readResult(match);
  return Boolean(match?.verified || match?.serverVerified || match?.verifiedAt || match?.completedAt || result.verifiedAt);
}
function matchSideBlueprint(match, side, challenge) {
  const replay = match?.replay || match?.match?.replay || {};
  const keys = side === 0
    ? ["challenger", "side0", "host", "creator", "defender", "a", "blueprint0"]
    : ["defender", "side1", "host", "creator", "opponent", "player", "guest", "b", "blueprint1"];
  for (const key of keys) {
    const blueprint = readableBlueprint(replay[key]);
    if (blueprint) return blueprint;
  }
  const topKeys = side === 0
    ? ["challengerBlueprint", "playerBlueprint", "blueprint0"]
    : ["defenderBlueprint", "hostBlueprint", "creatorBlueprint", "opponentBlueprint", "blueprint1"];
  for (const key of topKeys) {
    const blueprint = readableBlueprint(match?.[key]);
    if (blueprint) return blueprint;
  }
  return side === 0 ? challenge?.blueprint || null : null;
}
function matchSides(match, challenge) {
  const firstBlueprint = matchSideBlueprint(match, 0, challenge);
  const secondBlueprint = matchSideBlueprint(match, 1, challenge);
  return [
    {
      name: String(match?.side0Name || match?.challengerName || match?.participantName || "Challenger").slice(0, 28),
      blueprint: firstBlueprint,
      machine: unpackMachine(firstBlueprint),
    },
    {
      name: String(match?.side1Name || match?.defenderName || match?.creatorName || match?.hostName || challenge?.challengerName || "Host").slice(0, 28),
      blueprint: secondBlueprint,
      machine: unpackMachine(secondBlueprint),
    },
  ];
}

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
    if (!result.ok) {
      const error = Error(payload.error || "Challenges are temporarily unavailable.");
      error.status = result.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function matchShareUrl(match) {
    const id = matchId(match);
    const url = new URL(location.href);
    url.hash = "#friendly";
    if (id) url.searchParams.set("friendlyMatch", id);
    return url.toString();
  }

  function writeMatchAddress(match, replace = false) {
    const id = matchId(match);
    if (!id) return;
    const url = new URL(location.href);
    url.hash = "#friendly";
    url.searchParams.set("friendlyMatch", id);
    history[replace ? "replaceState" : "pushState"](history.state, "", url);
  }

  function clearMatchAddress(replace = true) {
    const url = new URL(location.href);
    if (!url.searchParams.has("friendlyMatch")) return;
    url.searchParams.delete("friendlyMatch");
    history[replace ? "replaceState" : "pushState"](history.state, "", url);
  }

  async function copyLink(value, success) {
    try {
      await navigator.clipboard.writeText(value);
      adapter.toast(success);
    } catch {
      adapter.modal(
        "Copy link",
        '<label class="field"><span>Link</span><textarea class="share-code" readonly>' +
          esc(value) +
          '</textarea></label><p>Select and copy this link to share it.</p>',
      );
    }
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
      <div class="friendly-card-meta"><span>${machineStats.height} ${machineStats.height === 1 ? "level" : "levels"}</span><span>${machineStats.weapons} ${machineStats.weapons === 1 ? "weapon" : "weapons"}</span><span>Free match</span></div>
      <div class="contract-footer"><small>Locked build snapshot · 24-hour invite</small><div class="friendly-card-actions"><button data-copy-friendly="${esc(challenge.id)}">Invite link</button><button data-practice-friendly="${esc(challenge.id)}">Preview</button><button class="primary" data-accept-friendly="${esc(challenge.id)}">Accept challenge</button></div></div></div>
    </article>`;
  }

  function drawThumbs(rows) {
    for (const canvas of app.querySelectorAll("[data-friendly-thumb]")) {
      const challenge = rows.find((item) => item.id === canvas.dataset.friendlyThumb);
      const machine = unpackMachine(challenge?.blueprint);
      if (machine) adapter.thumbnail(canvas, machine);
    }
  }

  function drawMatchThumbs(match, challenge) {
    const sides = matchSides(match, challenge);
    for (const canvas of app.querySelectorAll("[data-friendly-match-thumb]")) {
      const index = Number(String(canvas.dataset.friendlyMatchThumb || "").split(":").pop());
      const machine = sides[index]?.machine;
      if (machine) adapter.thumbnail(canvas, machine);
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
    app.querySelectorAll("[data-accept-friendly]").forEach((button) => {
      button.onclick = () => {
        const item = rows.find((row) => row.id === button.dataset.acceptFriendly);
        if (item) openAcceptDialog(item);
      };
    });
    app.querySelectorAll("[data-copy-friendly]").forEach((button) => {
      button.onclick = async () => {
        const link = `${location.origin}${location.pathname}#friendly=${encodeURIComponent(button.dataset.copyFriendly)}`;
        try {
          await navigator.clipboard.writeText(link);
          adapter.toast("Invite link copied.");
        } catch {
          adapter.modal("Copy challenge link", `<label class="field"><span>Invite link</span><textarea class="share-code" readonly>${esc(link)}</textarea></label><p>Select and copy the link to send it to a friend.</p>`);
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
      "Create challenge",
      `<p>Your current machine will be shown publicly in 3D for 24 hours. Anyone can challenge it for free; the listing has no build countdown. Matches use the normal arena rules.</p>
       <label class="field"><span>Challenger name</span><input id="friendly-name" maxlength="28" value="${esc(name)}" autocomplete="nickname" required></label>
       <label class="field"><span>Challenge title</span><input id="friendly-title" maxlength="70" value="${esc(name)}’s challenge" required></label>
       <label class="friendly-rated-toggle"><input id="friendly-create-rated" type="checkbox"><span><b>Allow rated matches</b><small>Both players must opt in before this challenge can affect game rankings.</small></span></label>
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
                rated: Boolean($("#friendly-create-rated")?.checked),
                blueprint: packChallenge(build.machine, build.arena, 0, build.rules, build.objective),
              }),
            });
            adapter.modalClose?.();
            await open(undefined, { restore: true });
            adapter.toast("Challenge published for 24 hours.");
          } catch (error) {
            errorNode.textContent = error.message || "Could not post this challenge.";
            button.disabled = false;
          }
        };
      },
    );
  }

  function openAcceptDialog(challenge) {
    const build = adapter.getBuild();
    const issues = validate(build.machine, build.rules);
    if (issues.length) {
      adapter.toast("Finish the machine first: " + issues[0]);
      return;
    }
    const host = unpackMachine(challenge.blueprint);
    const defaultName = build.machine.name || "Independent engineer";
    const content = [
      '<div class="friendly-accept-header">',
      '<span class="eyebrow">VERSUS ',
      esc(challenge.challengerName || "HOST"),
      '</span><strong>',
      esc(host?.name || challenge.title || "Host machine"),
      '</strong><small>YOUR BUILD · ',
      esc(build.machine.name || "Current machine"),
      "</small></div>",
      "<p>The server locks both machine snapshots and their shared seed before it verifies the result. Casual matches stay off the rankings.</p>",
      '<label class="field"><span>Your callsign</span><input id="friendly-accept-name" maxlength="28" value="',
      esc(defaultName),
      '" autocomplete="nickname" required></label>',
      '<label class="friendly-rated-toggle"><input id="friendly-rated" type="checkbox" checked><span><b>Play rated</b><small>Verified results update your game rating. Ratings have no outside value.</small></span></label>',
      '<p id="friendly-accept-error" class="error-message" role="alert"></p>',
      '<div class="modal-footer"><button data-close>Cancel</button><button class="primary" id="friendly-accept">Lock builds &amp; run match</button></div>',
    ].join("");
    adapter.modal("Accept challenge", content, () => {
      const button = $("#friendly-accept");
      button.onclick = async () => {
        const challengerName = $("#friendly-accept-name").value.trim();
        const errorNode = $("#friendly-accept-error");
        if (!challengerName) {
          errorNode.textContent = "Enter a callsign for this match.";
          return;
        }
        button.disabled = true;
        errorNode.textContent = "Locking builds and verifying the match…";
        try {
          const response = await request(
            "/api/friendly-challenges/" + encodeURIComponent(challenge.id) + "/accept",
            {
              method: "POST",
              body: JSON.stringify({
                clientId: localClientId(),
                participantName: challengerName,
                blueprint: packChallenge(
                  build.machine,
                  build.arena,
                  0,
                  build.rules,
                  build.objective,
                ),
                rated: Boolean($("#friendly-rated")?.checked),
              }),
            },
          );
          const match = response?.match || response;
          if (!matchId(match))
            throw Error(
              "The server did not return a match record. Your machine was not submitted again.",
            );
          adapter.modalClose?.();
          writeMatchAddress(match);
          renderMatch(match, challenge);
          adapter.toast(
            matchIsVerified(match)
              ? "Verified result recorded."
              : "Match recorded. Verification is still running.",
          );
        } catch (error) {
          if ([404, 405, 501].includes(error?.status)) {
            errorNode.innerHTML =
              'Verified challenge matches are still rolling out on this server. <button type="button" id="friendly-preview-fallback">Run a local preview instead</button>';
            $("#friendly-preview-fallback")?.addEventListener("click", () => {
              adapter.modalClose?.();
              adapter.practice({ ...challenge, friendly: true });
            });
          } else {
            errorNode.textContent = error.message || "Could not start this match.";
          }
          button.disabled = false;
        }
      };
    });
  }

  function shell(title = "CHALLENGES.", subtitle = "Build a machine, challenge a friend, and climb the free rankings.", active = "board") {
    return [
      '<div class="page-heading bounty-heading friendly-heading"><div class="bounty-heading-copy"><span class="eyebrow">WAR MACHINES / FREE CHALLENGES</span><h1>',
      esc(title),
      "</h1><p>",
      esc(subtitle),
      '</p></div><div class="heading-actions"><button class="primary" id="friendly-create">Create challenge</button><button id="friendly-leaderboard"',
      active === "leaderboard" ? ' class="active"' : "",
      '>Rankings</button><button id="friendly-refresh">Refresh</button></div></div>',
      '<section class="friendly-intro panel"><div class="friendly-intro-copy"><span class="eyebrow">HOW IT WORKS</span><strong>Create · accept · verify · share</strong><p>Challenges are free. A rated result changes only your game rating after the server verifies the locked builds and match seed.</p></div><div class="friendly-intro-steps"><span><b>01</b> Build</span><span><b>02</b> Challenge</span><span><b>03</b> Replay</span><span><b>04</b> Rematch</span></div></section>',
    ].join("");
  }

  function bindShell(rows, currentGeneration) {
    $("#friendly-create").onclick = openCreateDialog;
    $("#friendly-refresh").onclick = () => void open(undefined, { restore: true });
    $("#friendly-leaderboard").onclick = () => void openLeaderboard();
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

  function resultMarkup(match, fallbackChallenge) {
    const challenge = matchChallenge(match, fallbackChallenge);
    const sides = matchSides(match, challenge);
    const result = readResult(match);
    const outcome = matchOutcome(match);
    const duration = number(
      result.time ?? result.duration ?? result.durationSeconds ?? match?.duration ?? match?.durationSeconds,
    );
    const rawDamage = result.damage || result.damageBySide || match?.damage || match?.damageBySide || [];
    const damage = Array.isArray(rawDamage)
      ? [number(rawDamage[0]), number(rawDamage[1])]
      : [number(rawDamage?.side0), number(rawDamage?.side1)];
    const arenaId = match?.replay?.arena || challenge?.blueprint?.a;
    const arena = ARENAS.find((item) => item.id === arenaId);
    const verified = matchIsVerified(match);
    const id = matchId(match);
    const winner = outcome === "side0" ? sides[0].name : outcome === "side1" ? sides[1].name : "DRAW";
    const headline = outcome === "draw"
      ? "DRAW"
      : outcome === "side0" || outcome === "side1"
        ? winner.toUpperCase() + " WINS"
        : "MATCH COMPLETE";
    const reason = String(result.reason || match?.reason || "Result recorded from the locked machine snapshots.").replace(/[-_]/g, " ");
    const ratings = match?.rating || match?.ratings || null;
    const ratingRows = [
      { name: sides[0].name, value: ratings?.challenger || ratings?.player || ratings },
      { name: sides[1].name, value: ratings?.defender },
    ].map(({ name, value }) => {
      const before = number(value?.before ?? value?.previous ?? value?.oldRating, NaN);
      const after = number(value?.after ?? value?.rating ?? value?.newRating, NaN);
      const delta = number(
        value?.delta ?? (Number.isFinite(before) && Number.isFinite(after) ? after - before : NaN),
        NaN,
      );
      return { name, before, after, delta };
    }).filter((value) => Number.isFinite(value.after));
    const created = number(match?.verifiedAt || match?.completedAt || match?.finishedAt || match?.updated || match?.created || result.verifiedAt, NaN);
    const date = Number.isFinite(created)
      ? new Date(created).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "Recorded now";
    const rateMarkup = !match?.rated
      ? '<div class="friendly-rating-note"><b>CASUAL MATCH</b><span>No rating change.</span></div>'
      : ratingRows.length
        ? ratingRows.map((rating) => '<div class="friendly-rating-note ' + (rating.delta >= 0 ? "gain" : "loss") + '"><b>' + esc(rating.name) + " " + (rating.delta > 0 ? "+" : "") + Math.round(rating.delta) + '</b><span>' + Math.round(rating.before) + " → " + Math.round(rating.after) + "</span></div>").join("")
        : '<div class="friendly-rating-note pending"><b>RATED MATCH</b><span>Rating appears after verification.</span></div>';
    return [
      '<section class="friendly-result-page">',
      '<div class="friendly-result-top"><button id="friendly-back">← All challenges</button><span class="friendly-result-proof ',
      verified ? "verified" : "pending",
      '"><i></i>',
      verified ? "SERVER-VERIFIED RESULT" : "MATCH RECORD",
      "</span></div>",
      '<section class="friendly-result-hero ',
      outcome === "draw" ? "draw" : outcome === "complete" ? "neutral" : "win",
      '"><div class="friendly-result-copy"><span class="eyebrow">',
      verified ? "VERIFIED MATCH" : "MATCH SUMMARY",
      " · ",
      esc(date),
      "</span><h1>",
      esc(headline),
      "</h1><p>",
      esc(reason),
      "</p>",
      rateMarkup,
      '</div><div class="friendly-result-score"><span>',
      outcome === "draw" ? "DRAW" : outcome === "side0" || outcome === "side1" ? "WIN" : "DONE",
      "</span><strong>",
      formatSeconds(duration),
      "</strong><small>",
      esc(arena?.name || "Locked arena"),
      "</small></div></section>",
      '<section class="friendly-share-card" id="friendly-share-card"><div class="friendly-share-card-head"><span class="eyebrow">WAR MACHINES / MATCH CARD</span><span>',
      verified ? "VERIFIED" : "FREE PLAY",
      '</span></div><div class="friendly-versus"><article class="friendly-side ',
      outcome === "side0" ? "winner" : "",
      '"><canvas data-friendly-match-thumb="',
      esc(id),
      ':0" width="420" height="300" aria-label="',
      esc(sides[0].name),
      ' machine preview"></canvas><div><span>',
      esc(sides[0].name),
      "</span><strong>",
      esc(sides[0].machine?.name || "Machine"),
      "</strong><small>",
      damage[0] ? humanNumber(damage[0]) + " DAMAGE" : "LOCKED BUILD",
      '</small></div></article><div class="friendly-versus-mark"><b>',
      outcome === "draw" ? "=" : "VS",
      "</b><span>",
      outcome === "draw" ? "EVEN" : "DECIDED",
      '</span></div><article class="friendly-side ',
      outcome === "side1" ? "winner" : "",
      '"><canvas data-friendly-match-thumb="',
      esc(id),
      ':1" width="420" height="300" aria-label="',
      esc(sides[1].name),
      ' machine preview"></canvas><div><span>',
      esc(sides[1].name),
      "</span><strong>",
      esc(sides[1].machine?.name || "Machine"),
      "</strong><small>",
      damage[1] ? humanNumber(damage[1]) + " DAMAGE" : "LOCKED BUILD",
      "</small></div></article></div>",
      '<div class="friendly-share-card-bottom"><span>',
      esc(arena?.name || "Arena"),
      "</span><span>",
      formatSeconds(duration),
      "</span><span>",
      match?.rated ? "RATED" : "CASUAL",
      "</span><span>",
      verified ? "VERIFIED" : "RECORDED",
      "</span></div></section>",
      '<section class="friendly-match-insights"><article class="panel"><span class="eyebrow">MATCH READOUT</span><div class="friendly-result-stats"><div><b>',
      formatSeconds(duration),
      "</b><span>DURATION</span></div><div><b>",
      humanNumber(damage[0]),
      " / ",
      humanNumber(damage[1]),
      "</b><span>DAMAGE</span></div><div><b>",
      esc(reason),
      '</b><span>DECIDING EVENT</span></div></div></article><article class="panel friendly-timeline-panel"><span class="eyebrow">REPLAY RECORD</span><p>',
      verified
        ? "This public link preserves the locked builds, arena, match seed, and verified result."
        : "This link preserves the current recorded result while verification finishes.",
      "</p><div class=\"friendly-timeline\"><span>0:00 · Match started</span><span>",
      formatSeconds(duration),
      " · ",
      esc(reason),
      "</span></div></article></section>",
      '<section class="friendly-result-actions"><div><button class="primary" id="friendly-watch-replay">Watch exact replay</button><button id="friendly-copy-replay">Copy replay link</button><button id="friendly-share-result">Share</button><button id="friendly-download-card">Download card</button></div><div><button id="friendly-view-leaderboard">View rankings</button>',
      challenge ? '<button id="friendly-test-current">Test my current build</button>' : "",
      "</div></section></section>",
    ].join("");
  }

  function drawShareCard(match, challenge) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    const width = 1600;
    const height = 900;
    canvas.width = width;
    canvas.height = height;
    const sides = matchSides(match, challenge);
    const outcome = matchOutcome(match);
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#07131d");
    gradient.addColorStop(0.58, "#101d25");
    gradient.addColorStop(1, "#211a15");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#dfad54";
    context.lineWidth = 4;
    context.strokeRect(32, 32, width - 64, height - 64);
    context.fillStyle = "#e7b55e";
    context.font = "700 27px monospace";
    context.fillText("WAR MACHINES · FREE CHALLENGE", 76, 92);
    const winner = outcome === "side0" ? sides[0].name : outcome === "side1" ? sides[1].name : "DRAW";
    context.fillStyle = "#f2f0e8";
    context.font = "700 76px Arial Narrow, Arial, sans-serif";
    context.fillText((outcome === "draw" ? "DRAW" : winner.toUpperCase() + " WINS"), 76, 188);
    context.font = "600 24px monospace";
    context.fillStyle = "#aebcc0";
    context.fillText((match?.rated ? "RATED" : "CASUAL") + " · " + (matchIsVerified(match) ? "VERIFIED" : "RECORDED"), 78, 236);
    const previews = [...app.querySelectorAll("[data-friendly-match-thumb]")];
    const boxes = [[86, 300], [860, 300]];
    for (const [index, box] of boxes.entries()) {
      const x = box[0];
      const y = box[1];
      context.fillStyle = index === 0 ? "#132f35" : "#35251f";
      context.fillRect(x, y, 654, 365);
      context.strokeStyle = (outcome === "side0" && index === 0) || (outcome === "side1" && index === 1) ? "#e7b55e" : "#3e5960";
      context.lineWidth = 4;
      context.strokeRect(x, y, 654, 365);
      try {
        if (previews[index]) context.drawImage(previews[index], x + 30, y + 30, 594, 218);
      } catch {}
      context.fillStyle = "#dce9e5";
      context.font = "700 31px Arial, sans-serif";
      context.fillText(sides[index].name.toUpperCase(), x + 28, y + 292);
      context.fillStyle = "#a8bbb9";
      context.font = "600 22px monospace";
      context.fillText((sides[index].machine?.name || "MACHINE").toUpperCase(), x + 28, y + 330);
    }
    context.fillStyle = "#e7b55e";
    context.font = "700 38px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(outcome === "draw" ? "=" : "VS", width / 2, 480);
    context.textAlign = "left";
    context.fillStyle = "#7fa2a3";
    context.font = "500 21px monospace";
    context.fillText("Replay at warmachine.live", 76, 842);
    return canvas;
  }

  function renderMatch(match, fallbackChallenge = null) {
    stop();
    adapter.show();
    const challenge = matchChallenge(match, fallbackChallenge);
    app.innerHTML =
      shell("MATCH RESULT.", "Locked machine snapshots. A shareable record for every free challenge.") +
      resultMarkup(match, challenge);
    $("#friendly-create").onclick = openCreateDialog;
    $("#friendly-leaderboard").onclick = () => void openLeaderboard();
    $("#friendly-refresh").onclick = () => void openMatch(matchId(match), challenge);
    drawMatchThumbs(match, challenge);
    $("#friendly-back").onclick = () => {
      clearMatchAddress(false);
      void open(undefined, { restore: true });
    };
    $("#friendly-watch-replay").onclick = () => {
      if (typeof adapter.replay !== "function") {
        adapter.toast("The exact replay is not available in this browser.");
        return;
      }
      adapter.replay(match);
    };
    $("#friendly-copy-replay").onclick = () =>
      void copyLink(matchShareUrl(match), "Replay link copied.");
    $("#friendly-share-result").onclick = async () => {
      const link = matchShareUrl(match);
      if (navigator.share) {
        try {
          await navigator.share({
            title: "War Machines match",
            text: "Watch this free War Machines challenge result.",
            url: link,
          });
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
        }
      }
      await copyLink(link, "Replay link copied.");
    };
    $("#friendly-download-card").onclick = () => {
      const card = drawShareCard(match, challenge);
      if (!card) {
        adapter.toast("Could not prepare the share card.");
        return;
      }
      card.toBlob((blob) => {
        if (!blob) {
          adapter.toast("Could not export the share card.");
          return;
        }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "war-machines-" + (matchId(match) || "match") + ".png";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      }, "image/png");
    };
    $("#friendly-view-leaderboard").onclick = () => void openLeaderboard();
    $("#friendly-test-current")?.addEventListener("click", () => {
      if (!challenge) {
        adapter.toast("The original challenge snapshot is unavailable for a local test.");
        return;
      }
      adapter.practice({ ...challenge, friendly: true });
    });
  }

  function leaderboardHtml(data) {
    const entries = Array.isArray(data)
      ? data
      : Array.isArray(data?.rankings)
        ? data.rankings
      : Array.isArray(data?.entries)
        ? data.entries
        : Array.isArray(data?.leaderboard)
          ? data.leaderboard
          : [];
    const season = data?.season?.name || data?.seasonName || "OPEN SEASON";
    const rows = entries.map((entry, index) => {
      const record = entry.record || {};
      const wins = number(entry.wins ?? record.wins);
      const losses = number(entry.losses ?? record.losses);
      const draws = number(entry.draws ?? record.draws);
      const matches = number(entry.matches ?? entry.matchCount ?? wins + losses + draws);
      const form = Array.isArray(entry.form ?? entry.recentForm) ? entry.form ?? entry.recentForm : [];
      const formText = form.length
        ? form.slice(0, 5).map((value) => String(value).slice(0, 1).toUpperCase()).join(" · ")
        : "—";
      return [
        "<tr><td><b class=\"friendly-rank\">",
        number(entry.rank, index + 1),
        "</b></td><td><strong>",
        esc(entry.name || entry.displayName || entry.playerName || "Anonymous engineer"),
        "</strong>",
        entry.provisional ? "<small>PROVISIONAL</small>" : "",
        "</td><td><b>",
        humanNumber(entry.rating ?? entry.elo ?? 1000),
        "</b></td><td>",
        matches,
        "</td><td>",
        wins,
        "–",
        losses,
        "–",
        draws,
        '</td><td><span class="friendly-form">',
        esc(formText),
        "</span></td></tr>",
      ].join("");
    }).join("");
    return [
      '<section class="friendly-leaderboard panel"><div class="friendly-leaderboard-head"><div><span class="eyebrow">',
      esc(season),
      '</span><h2>Verified rankings</h2><p>Only server-verified rated matches count. Repeated matches against the same opponent have limited rating impact.</p></div><button id="friendly-back-board">All challenges</button></div>',
      rows
        ? '<div class="friendly-rank-table-wrap"><table class="friendly-rank-table"><thead><tr><th>#</th><th>ENGINEER</th><th>RATING</th><th>MATCHES</th><th>W–L–D</th><th>FORM</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
        : '<div class="friendly-leaderboard-empty"><strong>Rankings are warming up.</strong><p>Finish a rated challenge to start the first verified ladder.</p></div>',
      "</section>",
    ].join("");
  }

  async function openLeaderboard() {
    const currentGeneration = stop();
    adapter.show();
    app.innerHTML =
      shell(
        "RANKINGS.",
        "Free, server-verified competition. Ratings are game-only.",
        "leaderboard",
      ) + '<section class="friendly-loading panel" role="status">Loading verified rankings…</section>';
    $("#friendly-create").onclick = openCreateDialog;
    $("#friendly-leaderboard").onclick = () => void openLeaderboard();
    $("#friendly-refresh").onclick = () => void openLeaderboard();
    try {
      const data = await request("/api/friendly-leaderboard");
      if (generation !== currentGeneration) return;
      app.innerHTML =
        shell(
          "RANKINGS.",
          "Free, server-verified competition. Ratings are game-only.",
          "leaderboard",
        ) + leaderboardHtml(data);
      $("#friendly-create").onclick = openCreateDialog;
      $("#friendly-leaderboard").onclick = () => void openLeaderboard();
      $("#friendly-refresh").onclick = () => void openLeaderboard();
      $("#friendly-back-board").onclick = () => void open(undefined, { restore: true });
    } catch (error) {
      if (generation !== currentGeneration) return;
      app.innerHTML =
        shell(
          "RANKINGS.",
          "Free, server-verified competition. Ratings are game-only.",
          "leaderboard",
        ) +
        '<section class="panel friendly-error"><span class="eyebrow">RANKINGS OFFLINE</span><h2>Rankings are not available yet.</h2><p>' +
        esc(error.message || "The server is still preparing the first season.") +
        '</p><button class="primary" id="friendly-back-board">Browse challenges</button></section>';
      $("#friendly-create").onclick = openCreateDialog;
      $("#friendly-leaderboard").onclick = () => void openLeaderboard();
      $("#friendly-refresh").onclick = () => void openLeaderboard();
      $("#friendly-back-board").onclick = () => void open(undefined, { restore: true });
    }
  }

  async function openMatch(id, fallbackChallenge = null) {
    const currentGeneration = stop();
    adapter.show();
    app.innerHTML =
      shell("MATCH RESULT.", "Loading the server-verified match record…") +
      '<section class="friendly-loading panel" role="status">Loading match result…</section>';
    $("#friendly-create").onclick = openCreateDialog;
    $("#friendly-leaderboard").onclick = () => void openLeaderboard();
    $("#friendly-refresh").onclick = () => void openMatch(id, fallbackChallenge);
    try {
      const response = await request("/api/friendly-matches/" + encodeURIComponent(id));
      if (generation !== currentGeneration) return;
      const match = response?.match || response;
      try {
        const replayResponse = await request("/api/friendly-replays/" + encodeURIComponent(id));
        const replay = replayResponse?.replay || replayResponse;
        if (replay && typeof replay === "object")
          match.replay = { ...(match.replay || {}), ...replay };
      } catch {}
      if (generation !== currentGeneration) return;
      renderMatch(match, fallbackChallenge);
    } catch (error) {
      if (generation !== currentGeneration) return;
      app.innerHTML =
        shell("MATCH RESULT.", "The result link could not be opened right now.") +
        '<section class="panel friendly-error"><span class="eyebrow">RESULT UNAVAILABLE</span><h2>We could not load that match.</h2><p>' +
        esc(error.message || "Try again in a moment.") +
        '</p><div><button class="primary" id="friendly-match-retry">Try again</button><button id="friendly-match-board">All challenges</button></div></section>';
      $("#friendly-create").onclick = openCreateDialog;
      $("#friendly-leaderboard").onclick = () => void openLeaderboard();
      $("#friendly-refresh").onclick = () => void openMatch(id, fallbackChallenge);
      $("#friendly-match-retry").onclick = () => void openMatch(id, fallbackChallenge);
      $("#friendly-match-board").onclick = () => {
        clearMatchAddress(false);
        void open(undefined, { restore: true });
      };
    }
  }

  async function open(id, { restore = false } = {}) {
    if (!restore && adapter.navigate) {
      adapter.navigate({ name: id ? "friendlyChallenge" : "friendly", value: id || undefined });
      return;
    }
    const sharedMatch = new URL(location.href).searchParams.get("friendlyMatch");
    if (sharedMatch) return openMatch(sharedMatch);
    const currentGeneration = stop();
    adapter.show();
    app.innerHTML = shell() + '<div class="friendly-loading" role="status">Loading open challenges…</div>';
    $("#friendly-create").onclick = openCreateDialog;
    $("#friendly-refresh").onclick = () => void open(id, { restore: true });
    $("#friendly-leaderboard").onclick = () => void openLeaderboard();
    try {
      const data = await request(id ? `/api/friendly-challenges/${encodeURIComponent(id)}` : "/api/friendly-challenges");
      if (generation !== currentGeneration) return;
      const rows = id ? [data] : Array.isArray(data) ? data : data?.challenges || [];
      const list = `<section class="friendly-board"><div class="contract-filter"><div><span class="eyebrow">${id ? "SHARED INVITE" : "OPEN MATCHUPS"}</span><h2>${id ? "Challenge details" : `${rows.length} open ${rows.length === 1 ? "challenge" : "challenges"}`}</h2></div><span class="friendly-update">AUTO-REFRESH · 30 SEC</span></div><div class="contract-grid" id="friendly-grid">${rows.map(challengeCard).join("") || '<div class="bounty-empty"><h2>No open challenges</h2><p>Publish your current machine and invite friends to test it during a 24-hour listing window.</p><button class="primary" id="friendly-create-empty">Create a challenge</button></div>'}</div></section>`;
      app.innerHTML = shell(id ? "CHALLENGE INVITE." : undefined, id ? "Review the locked host build, then accept it with your own machine." : undefined) + list;
      const emptyCreate = $("#friendly-create-empty");
      if (emptyCreate) emptyCreate.onclick = openCreateDialog;
      bindShell(rows, currentGeneration);
    } catch (error) {
      if (generation !== currentGeneration) return;
      app.innerHTML = shell() + `<section class="panel friendly-error"><h2>Could not load the board</h2><p>${esc(error.message)}</p><button class="primary" id="friendly-retry">Try again</button></section>`;
      $("#friendly-create").onclick = openCreateDialog;
      $("#friendly-refresh").onclick = () => void open(id, { restore: true });
      $("#friendly-leaderboard").onclick = () => void openLeaderboard();
      $("#friendly-retry").onclick = () => void open(id, { restore: true });
    }
  }

  return { open };
}
