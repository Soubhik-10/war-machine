import {
  ARENAS,
  packChallenge,
  stats,
  unpackChallenge,
  validate,
  rulesLabel,
} from "./data.mjs";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const key = () => crypto.randomUUID().replaceAll("-", "");
const time = (value) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown time";
  }
};
const status = (bounty) => {
  if (bounty.status !== "open") return "CLOSED";
  if (bounty.expires && Number(bounty.expires) <= Date.now()) return "EXPIRED";
  return "OPEN";
};

export function createFreeChallengeUI(adapter) {
  let generation = 0, controller = null;

  const request = async (path, { method = "GET", body, idempotencyKey, signal } = {}) => {
    const response = await fetch("/api" + path, {
      method,
      credentials: "include",
      signal,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = Error(value.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return value;
  };
  const emailProfile = async (signal) => {
    try {
      return await request("/auth/email/me", { signal });
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  };
  const begin = () => {
    controller?.abort();
    adapter.show();
    // adapter.show clears the previous view, which calls leave() on this UI.
    // Create the route controller after that cleanup so the new request is not
    // accidentally aborted by its own screen transition.
    controller = new AbortController();
    return ++generation;
  };
  const active = (value) => value === generation;
  const leave = () => {
    generation++;
    controller?.abort();
    controller = null;
  };
  const navigate = (route, restore) => {
    if (!restore && adapter.navigate) {
      adapter.navigate(route);
      return true;
    }
    return false;
  };
  const heading = (title, subtitle, profile = null) =>
    `<div class="page-heading bounty-heading free-heading"><div><span class="eyebrow">WAR MACHINES / HOSTED FREE CHALLENGES</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="heading-actions"><button id="free-paid-board" type="button">Paid bounties</button><button id="free-board-home" type="button">Free board</button>${profile ? `<button id="free-email-account" type="button" title="Email-verified player">${esc(profile.name)}</button>` : ""}</div></div>`;
  const boardTabs = () =>
    `<nav class="board-kind-tabs" aria-label="Challenge board type"><button id="free-paid-tab" type="button">Paid bounties · pathUSD</button><button class="active" type="button" aria-current="page">Free friend challenges</button></nav>`;
  const wireShared = (profile) => {
    $("#free-paid-board")?.addEventListener("click", () => adapter.navigate({ name: "bounties" }));
    $("#free-board-home")?.addEventListener("click", () => openBoard());
    $("#free-paid-tab")?.addEventListener("click", () => adapter.navigate({ name: "bounties" }));
    $("#free-email-account")?.addEventListener("click", () => {
      void request("/auth/email/logout", { method: "POST", body: {} })
        .then(() => {
          adapter.toast("Email session signed out.");
          return openBoard();
        })
        .catch((error) => adapter.toast(error.message));
    });
  };
  const card = (bounty) => {
    const arena = ARENAS.find((item) => item.id === bounty.scout?.arena),
      state = status(bounty),
      minutes = bounty.expires ? Math.max(0, Math.ceil((Number(bounty.expires) - Date.now()) / 60000)) : null;
    return `<article class="contract-card free-contract-card"><div class="contract-card-top"><span class="free-badge">FREE · EMAIL VERIFIED</span><small>${esc(state)}</small></div><div class="free-card-signal"><span aria-hidden="true">♜</span><b>HOSTED FRIEND CHALLENGE</b><small>No payment · no wallet · one official run per verified email</small></div><div class="contract-content"><h2>${esc(bounty.title)}</h2><p>${esc(arena?.name || bounty.scout?.arena || "Arena")} · ${Number(bounty.scout?.cost || 0)} build credits · ${Number(bounty.scout?.parts || 0)} parts</p><div class="contract-class">${esc(rulesLabel(bounty.scout?.rules || bounty.blueprint?.q || {}))}</div><div class="contract-footer"><span><b>FREE</b> · ${Number(bounty.attempts || 0)} official runs${minutes === null ? "" : ` · ${minutes ? `${minutes} min left` : "expired"}`}</span><button data-free-challenge="${esc(bounty.id)}" type="button">View challenge ↗</button></div></div></article>`;
  };
  const emailGate = (title, subtitle, returnTo, profile = null) => {
    const g = begin();
    if (profile) return openCreate({ restore: true, profile });
    document.querySelector("#app").innerHTML =
      heading(title, subtitle) +
      `<section class="panel free-email-gate"><div><span class="free-badge">FREE · EMAIL VERIFIED</span><h2>Sign in by email</h2><p>We send a one-time sign-in link. No Tempo wallet, payment, or ChatGPT account is used for free friend challenges.</p><form id="free-email-form"><label class="field"><span>Email address</span><input id="free-email" type="email" autocomplete="email" maxlength="254" required></label><label class="field"><span>Display name</span><input id="free-email-name" type="text" autocomplete="nickname" maxlength="28" placeholder="Independent engineer"></label><p id="free-email-note" class="hint" role="status"></p><button class="primary" type="submit">Email me a secure sign-in link</button><button id="free-email-back" type="button">Back to free board</button></form></div></section>`;
    wireShared(null);
    $("#free-email-back").onclick = () => openBoard();
    $("#free-email-form").onsubmit = (event) => {
      event.preventDefault();
      const button = $("#free-email-form button[type='submit']"), note = $("#free-email-note");
      button.disabled = true;
      note.textContent = "Sending secure link…";
      void request("/auth/email/request", {
        method: "POST",
        body: {
          email: $("#free-email").value,
          name: $("#free-email-name").value,
          returnTo,
        },
      })
        .then((result) => {
          if (!active(g)) return;
          note.textContent = result.message || "Check your inbox for the sign-in link.";
        })
        .catch((error) => {
          if (active(g)) note.textContent = error.message;
        })
        .finally(() => {
          if (button.isConnected) button.disabled = false;
        });
    };
  };
  const resultPanel = (bounty, attempt) => {
    const outcome = String(attempt.result?.outcome || "result").toUpperCase(),
      duration = Number(attempt.result?.time || 0);
    return `<section class="panel free-result"><span class="free-badge">HOSTED RESULT</span><h2>${esc(outcome)}</h2><p>${duration ? `${duration.toFixed(1)} seconds · ` : ""}The server ran the locked machines with its own seed. No payment, escrow, signer, or relayer was involved.</p><div class="bounty-actions"><button id="watch-free-replay" class="primary" type="button">Watch official replay</button><button id="back-free-detail" type="button">Back to challenge</button></div></section>`;
  };
  const detail = (bounty, profile, attempt = null) => {
    const arena = ARENAS.find((item) => item.id === bounty.scout?.arena),
      own = profile?.id === bounty.owner,
      expiry = bounty.expires ? time(bounty.expires) : "No expiry",
      canEnter = bounty.availability?.enter?.allowed,
      reason = bounty.availability?.enter?.reasons?.[0] || "";
    document.querySelector("#app").innerHTML =
      heading("FREE FRIEND CHALLENGE", "Hosted on the public free board. Payment and Tempo Wallet are never used here.", profile) +
      boardTabs() +
      `<div class="contract-detail free-detail"><section class="panel defender-card free-defender-card"><div class="contract-card-top"><span class="free-badge">FREE · EMAIL VERIFIED</span><small>${esc(status(bounty))}</small></div><div class="free-card-signal free-detail-signal"><span aria-hidden="true">♜</span><b>HOSTED FREE CHALLENGE</b><small>Public defender · locked rules · server-recorded result</small></div><div class="defender-caption"><h2>${esc(unpackChallenge(bounty.blueprint, true).machine.name)}</h2><p>${Number(bounty.scout?.cost || 0)} build credits · ${Number(bounty.scout?.parts || 0)} fitted parts · ${Number(bounty.scout?.weapons || 0)} weapons</p><span>${esc(arena?.name || bounty.scout?.arena || "Arena")}</span></div><div class="bounty-actions"><button id="copy-free-link" type="button">↗ Copy challenge link</button>${navigator.share ? '<button id="share-free-link" type="button">Share…</button>' : ""}</div></section><section class="panel contract-terms free-terms"><span class="eyebrow">${esc(bounty.ownerName)} / FREE TERMS</span><h2>${esc(bounty.title)}</h2><div class="free-economy"><div><b>FREE</b><small>ENTRY</small></div><div><b>0</b><small>REWARD / ESCROW</small></div><div><b>EMAIL</b><small>VERIFIED PLAYER</small></div></div><div class="contract-rule"><strong>${esc(arena?.name || bounty.scout?.arena || "Arena")}</strong><p>${esc(arena?.desc || "Both machines use the locked arena.")}</p></div><div class="contract-rule"><strong>${esc(rulesLabel(bounty.scout?.rules || bounty.blueprint?.q || {}))}</strong><p>Both machines use the same locked rules and fight automatically for up to 100 seconds.</p></div><div class="contract-rule"><strong>Hosted, no payment</strong><p>Your result is generated by the server and can be replayed. It cannot touch your wallet, the paid bounty escrow, MPP, a signer, or a relayer.</p></div><p class="contract-expiry">${esc(expiry)} · ${Number(bounty.attempts || 0)} official runs<br>${bounty.listed ? "Visible on the free board" : "Link only"}</p>${!profile ? '<button id="free-sign-in-play" class="primary" type="button">Sign in by email to play</button>' : own ? '<button id="close-free-challenge" type="button">Close this free challenge</button>' : `<button id="free-enter" class="primary" type="button" ${canEnter ? "" : "disabled"}>Run hosted challenge</button><p class="hint" id="free-entry-note">${esc(canEnter ? "Use your current workshop machine. You get one official run with this verified email account." : reason)}</p>`}<p id="free-error" class="error-message" role="status"></p></section></div>${attempt ? resultPanel(bounty, attempt) : ""}<section class="panel contract-history free-history"><h3>Recent hosted results</h3>${bounty.history?.length ? bounty.history.map((item) => `<div class="attempt-row"><span>${esc(item.participantName || "Independent engineer")}<small class="attempt-outcome">${esc(String(item.result?.outcome || item.status).toUpperCase())}</small></span><small>${esc(time(item.created))}</small><strong>${item.result?.time ? `${Number(item.result.time).toFixed(1)}s` : "Recorded"}</strong></div>`).join("") : "<p>No verified player has run this challenge yet.</p>"}</section>`;
    wireShared(profile);
    $("#copy-free-link").onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.origin + location.pathname + "#free=" + bounty.id);
        adapter.toast("Free challenge link copied.");
      } catch {
        adapter.toast("Copy the address from your browser to share this challenge.");
      }
    };
    $("#share-free-link")?.addEventListener("click", () =>
      navigator.share({ title: bounty.title, text: "Can you beat my free War Machines challenge?", url: location.origin + location.pathname + "#free=" + bounty.id })
        .catch((error) => { if (error.name !== "AbortError") adapter.toast("Use Copy challenge link to share."); }),
    );
    $("#free-sign-in-play")?.addEventListener("click", () => emailGate("PLAY A FREE CHALLENGE", "Verify an email address to run this hosted challenge.", "/#free=" + bounty.id));
    $("#close-free-challenge")?.addEventListener("click", () => {
      const button = $("#close-free-challenge");
      button.disabled = true;
      void request(`/free/bounties/${bounty.id}/cancel`, { method: "POST", body: {} })
        .then((fresh) => detail(fresh, profile))
        .catch((error) => { $("#free-error").textContent = error.message; })
        .finally(() => { if (button.isConnected) button.disabled = false; });
    });
    $("#free-enter")?.addEventListener("click", () => {
      const button = $("#free-enter"), draft = adapter.getBuild(), lockedRules = bounty.blueprint.q,
        issues = validate(draft.machine, lockedRules);
      if (issues.length) {
        $("#free-error").textContent = issues[0];
        return;
      }
      button.disabled = true;
      $("#free-entry-note").textContent = "Running the hosted simulation…";
      const idempotencyKey = key();
      const submit = () => request(`/free/bounties/${bounty.id}/attempts`, {
        method: "POST",
        idempotencyKey,
        body: {
          blueprint: packChallenge(draft.machine, bounty.blueprint.a, 0, lockedRules, draft.objective || bounty.blueprint.o || "reactor"),
          participantName: draft.machine.name,
        },
      });
      void submit()
        .then((completed) => {
          adapter.toast("Hosted free challenge recorded.");
          detail(bounty, profile, completed);
        })
        .catch((error) => {
          if ($("#free-error")) $("#free-error").textContent = error.message;
          if ($("#free-entry-note")) $("#free-entry-note").textContent = "No payment was requested.";
        })
        .finally(() => { if (button.isConnected) button.disabled = false; });
    });
    $("#watch-free-replay")?.addEventListener("click", () => adapter.replay(attempt, bounty));
    $("#back-free-detail")?.addEventListener("click", () => open(bounty.id));
  };
  async function openBoard({ restore = false } = {}) {
    if (navigate({ name: "free-board" }, restore)) return;
    const g = begin();
    document.querySelector("#app").innerHTML =
      heading("FREE FRIEND CHALLENGES", "Loading public, no-payment challenges…") +
      '<section class="panel bounty-empty"><p>Loading hosted free challenges…</p></section>';
    try {
      const [bounties, profile] = await Promise.all([
        request("/free/bounties", { signal: controller.signal }),
        emailProfile(controller.signal),
      ]);
      if (!active(g)) return;
      document.querySelector("#app").innerHTML =
        heading("FREE FRIEND CHALLENGES", "Hosted public challenges with no payment, wallet, escrow, or platform fee.", profile) +
        boardTabs() +
        `<section class="free-board-intro panel"><div><span class="free-badge">FREE · HOSTED · EMAIL VERIFIED</span><h2>Challenge friends without paying</h2><p>Post your current machine, share the link, and let each email-verified friend run one official server-recorded battle. Paid pathUSD bounties stay on their own board.</p></div><div class="bounty-actions"><button id="create-free-challenge" class="primary" type="button">+ Post a free challenge</button>${profile ? '<button id="free-sign-out" type="button">Sign out</button>' : '<button id="free-sign-in" type="button">Sign in by email</button>'}</div></section><section class="contract-grid free-contract-grid">${bounties.length ? bounties.map(card).join("") : '<div class="bounty-empty">No free friend challenges are open right now. Post the first one.</div>'}</section>`;
      wireShared(profile);
      $("#create-free-challenge").onclick = () => openCreate();
      $("#free-sign-in")?.addEventListener("click", () => emailGate("POST OR PLAY FOR FREE", "Verify your email to post or enter a hosted free challenge.", "/#free-board"));
      $("#free-sign-out")?.addEventListener("click", () => $("#free-email-account")?.click());
      $$('[data-free-challenge]').forEach((button) => {
        button.onclick = () => open(button.dataset.freeChallenge);
      });
    } catch (error) {
      if (!active(g) || error.name === "AbortError") return;
      document.querySelector("#app").innerHTML =
        heading("FREE BOARD UNAVAILABLE", "The paid bounty board remains separate.") +
        `<section class="panel bounty-empty"><p>${esc(error.message)}</p><button id="retry-free-board" type="button">Try again</button><button id="open-paid-board" type="button">Paid bounties</button></section>`;
      $("#retry-free-board").onclick = () => openBoard();
      $("#open-paid-board").onclick = () => adapter.navigate({ name: "bounties" });
    }
  }
  async function open(id, { restore = false } = {}) {
    if (navigate({ name: "free", value: id }, restore)) return;
    const g = begin();
    document.querySelector("#app").innerHTML = heading("FREE FRIEND CHALLENGE", "Loading the hosted challenge…") + '<section class="panel bounty-empty"><p>Loading challenge…</p></section>';
    try {
      const [bounty, profile] = await Promise.all([
        request("/free/bounties/" + id, { signal: controller.signal }),
        emailProfile(controller.signal),
      ]);
      if (active(g)) detail(bounty, profile);
    } catch (error) {
      if (!active(g) || error.name === "AbortError") return;
      document.querySelector("#app").innerHTML = heading("FREE CHALLENGE NOT FOUND", "It may have been removed or the link is invalid.") + `<section class="panel bounty-empty"><p>${esc(error.message)}</p><button id="free-back" type="button">Free board</button></section>`;
      $("#free-back").onclick = () => openBoard();
    }
  }
  async function openCreate({ restore = false, profile = null } = {}) {
    if (navigate({ name: "free-create" }, restore)) return;
    const g = begin();
    try {
      const signedIn = profile || await emailProfile(controller.signal);
      if (!active(g)) return;
      if (!signedIn) {
        emailGate("POST A FREE CHALLENGE", "Email verification keeps the public free board useful for real friends.", "/#free-create");
        return;
      }
      const draft = adapter.getBuild(), issues = validate(draft.machine, draft.rules), currentStats = stats(draft.machine), arena = ARENAS.find((item) => item.id === draft.arena);
      document.querySelector("#app").innerHTML =
        heading("POST A FREE CHALLENGE", "This creates a public hosted challenge with no entry fee or reward.", signedIn) +
        boardTabs() +
        `<form id="create-free-challenge-form" class="contract-create free-create"><section class="panel create-preview"><h2>${esc(draft.machine.name)}</h2><p>${currentStats.cost} build credits · ${currentStats.parts} parts · ${currentStats.mass} t</p><p class="hint">Your current workshop machine, arena, objective, and rules are locked when you post.</p><p><strong>${esc(arena?.name || draft.arena)}</strong> · ${esc(rulesLabel(draft.rules))}</p><button id="edit-free-build" type="button">Edit in workshop</button></section><section class="panel contract-form"><span class="free-badge">FREE · EMAIL VERIFIED</span><label class="field"><span>Challenge title</span><input id="free-title" required maxlength="70" value="${esc("Can you beat " + draft.machine.name + "?")}"></label><label class="field"><span>Duration · hours</span><input id="free-hours" type="number" min="1" max="168" step="1" value="24" required></label><label class="identity-check"><input id="free-listed" type="checkbox" checked><span>Show this challenge on the public free board</span></label><p class="hint">Free challenges are server-hosted, public by default, and require a verified email to post or play. They never request a wallet signature or payment.</p><p id="free-create-error" class="error-message" role="status">${esc(issues[0] || "")}</p><button id="post-free-challenge" class="primary" type="submit" ${issues.length ? "disabled" : ""}>Post free challenge</button></section></form>`;
      wireShared(signedIn);
      $("#edit-free-build").onclick = adapter.workshop;
      $("#create-free-challenge-form").onsubmit = (event) => {
        event.preventDefault();
        const button = $("#post-free-challenge"), body = {
          title: $("#free-title").value,
          blueprint: packChallenge(draft.machine, draft.arena, 0, draft.rules, draft.objective || "reactor"),
          hours: Number($("#free-hours").value),
          listed: $("#free-listed").checked,
        };
        button.disabled = true;
        void request("/free/bounties", { method: "POST", body, idempotencyKey: key() })
          .then((bounty) => open(bounty.id))
          .catch((error) => { $("#free-create-error").textContent = error.message; })
          .finally(() => { if (button.isConnected) button.disabled = false; });
      };
    } catch (error) {
      if (!active(g) || error.name === "AbortError") return;
      emailGate("POST A FREE CHALLENGE", error.message, "/#free-create");
    }
  }
  return { leave, openBoard, open, openCreate };
}
