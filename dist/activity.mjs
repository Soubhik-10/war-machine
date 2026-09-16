const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const shortHash = (value) =>
  value && value.length > 14
    ? `${value.slice(0, 8)}…${value.slice(-6)}`
    : value;

const readableTime = (value) => {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "--:--:--";
  }
};

const stateLabel = (state) =>
  ({
    active: "IN PROGRESS",
    ready: "READY",
    complete: "COMPLETE",
    error: "NEEDS ATTENTION",
  })[state] || "RECORDED";

const activityRow = (item) => {
  const details = [
    item.amount ? `${item.amount} pathUSD` : "",
    item.transactionHash ? `tx ${shortHash(item.transactionHash)}` : "",
    item.attemptId ? `attempt ${shortHash(item.attemptId)}` : "",
  ].filter(Boolean);
  return `<article class="agent-activity-row" data-state="${esc(item.state)}">
    <i aria-hidden="true"></i>
    <div class="agent-activity-copy">
      <strong>${esc(item.message)}</strong>
      ${item.title ? `<span>${esc(item.title)}</span>` : ""}
      ${details.length ? `<small>${esc(details.join(" · "))}</small>` : ""}
    </div>
    <div class="agent-activity-meta"><b>${esc(stateLabel(item.state))}</b><time datetime="${esc(new Date(item.updated || item.created).toISOString())}">${esc(readableTime(item.updated || item.created))}</time></div>
  </article>`;
};

export function installAgentActivity(adapter) {
  const app = document.querySelector("#app");
  if (!app || typeof MutationObserver === "undefined") return;
  let timer = 0;
  let requestId = 0;

  const stop = () => {
    clearTimeout(timer);
    timer = 0;
    requestId += 1;
  };

  const mount = () => {
    const intro = app.querySelector(".agent-intro");
    if (!intro) {
      stop();
      return;
    }
    if (app.querySelector(".agent-activity-section")) return;
    const steps = app.querySelector(".agent-steps");
    if (!steps) return;
    const section = document.createElement("section");
    section.className = "portal-section agent-activity-section";
    section.innerHTML = `<div class="section-title"><div><span class="eyebrow">LIVE ACCOUNT VIEW</span><h2>Agent activity</h2></div><div class="agent-activity-controls"><span id="agent-activity-sync">WAITING FOR WALLET</span><button id="agent-activity-refresh" type="button">↻ Refresh</button></div></div><section class="panel agent-activity-card"><div class="agent-activity-summary"><div><strong id="agent-activity-state">Connect a Tempo wallet to watch its agent.</strong><p id="agent-activity-note">This private view shows current bounty, escrow, engineering and settlement state. It never displays blueprints or wallet secrets.</p></div><button class="primary" id="agent-activity-connect" type="button">Connect Tempo wallet</button></div><div id="agent-activity-list" class="agent-activity-list" aria-live="polite"><p class="agent-activity-empty">No activity loaded yet.</p></div></section>`;
    steps.before(section);

    const state = section.querySelector("#agent-activity-state");
    const note = section.querySelector("#agent-activity-note");
    const sync = section.querySelector("#agent-activity-sync");
    const list = section.querySelector("#agent-activity-list");
    const connect = section.querySelector("#agent-activity-connect");
    const refresh = section.querySelector("#agent-activity-refresh");
    const schedule = (delay = 5000) => {
      clearTimeout(timer);
      timer = setTimeout(load, delay);
    };
    const load = async () => {
      const currentRequest = ++requestId;
      try {
        const response = await fetch("/api/me/activity", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (currentRequest !== requestId || !section.isConnected) return;
        if (response.status === 401) {
          state.textContent = "Connect a Tempo wallet to watch its agent.";
          note.textContent = "Your activity is private to the connected wallet. No key or blueprint is shown here.";
          sync.textContent = "WALLET NOT CONNECTED";
          connect.hidden = false;
          list.innerHTML = '<p class="agent-activity-empty">Connect the wallet that authorizes the agent, then refresh this view.</p>';
        } else if (!response.ok) {
          throw Error(payload.error || "Activity is temporarily unavailable.");
        } else {
          const events = Array.isArray(payload.events) ? payload.events : [];
          state.textContent = events.some((item) => item.state === "active")
            ? "Agent operations are in progress."
            : "No operation is currently in progress.";
          note.textContent = "Updates automatically while this page is open. Read-only status; it cannot authorize a wallet transaction.";
          sync.textContent = `LAST SYNC ${readableTime(payload.generatedAt || Date.now())}`;
          connect.hidden = true;
          list.innerHTML = events.length
            ? events.slice(0, 32).map(activityRow).join("")
            : '<p class="agent-activity-empty">No bounty or settlement activity yet.</p>';
        }
      } catch (error) {
        if (currentRequest !== requestId || !section.isConnected) return;
        sync.textContent = "SYNC FAILED";
        note.textContent = error.message || "Activity is temporarily unavailable.";
        connect.hidden = false;
      } finally {
        if (currentRequest === requestId && section.isConnected) schedule();
      }
    };
    connect.onclick = async () => {
      connect.disabled = true;
      try {
        await adapter.account?.();
      } catch (error) {
        note.textContent = error.message || "Wallet connection was not completed.";
      } finally {
        connect.disabled = false;
        await load();
      }
    };
    refresh.onclick = load;
    load();
  };

  const observer = new MutationObserver(mount);
  observer.observe(app, { childList: true, subtree: true });
  mount();
}
