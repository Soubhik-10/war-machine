// The hash is the shareable address of a screen. UI-only state (filters,
// drafts, focus and scroll) deliberately stays out of it.
const SIMPLE = new Set(["home", "workshop", "arena", "rules", "agents", "bounties", "free-board", "free-create"]);

export function parseRoute(hash = "") {
  const value = String(hash).replace(/^#/, "");
  if (!value || value === "home") return { name: "home" };
  if (SIMPLE.has(value)) return { name: value };
  if (/^rules-[a-z0-9-]+$/i.test(value)) return { name: "anchor", value };
  for (const [prefix, name] of [
    ["bounty=", "bounty"],
    ["free=", "free"],
    ["challenge=", "challenge"],
    ["build=", "build"],
  ]) {
    if (value.startsWith(prefix) && value.slice(prefix.length))
      return { name, value: value.slice(prefix.length) };
  }
  return { name: "missing", value };
}

export function serializeRoute(route) {
  if (SIMPLE.has(route?.name)) return route.name === "home" ? "#home" : `#${route.name}`;
  if (["bounty", "free", "challenge", "build"].includes(route?.name) && route.value)
    return `#${route.name}=${route.value}`;
  if (route?.name === "anchor" && route.value) return `#${route.value}`;
  return "#missing";
}

const sameRoute = (a, b) => serializeRoute(a) === serializeRoute(b);

// One owner for history changes. `render` is never allowed to mutate history;
// browser restoration is deduped because hashchange and popstate can both fire.
export function createHashRouter({ render, windowRef = window }) {
  let rendered = "";
  let scheduled = false;
  let pendingSource = "restore";

  const current = () => parseRoute(windowRef.location.hash);
  const saveScroll = () => {
    if (typeof windowRef.scrollY !== "number") return;
    const route = current();
    windowRef.history.replaceState(
      { ...(windowRef.history.state || {}), wmRoute: route, scrollY: windowRef.scrollY },
      "",
      windowRef.location.hash || serializeRoute(route),
    );
  };
  const renderCurrent = (source) => {
    const route = current();
    const key = serializeRoute(route);
    if (key === rendered && source === "restore") return;
    rendered = key;
    const state = windowRef.history.state || null;
    render(route, { source, state });
    if (source === "restore" && Number.isFinite(state?.scrollY) && typeof windowRef.scrollTo === "function")
      requestAnimationFrame(() => windowRef.scrollTo({ top: state.scrollY, behavior: "instant" }));
  };
  const restore = () => {
    pendingSource = "restore";
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      renderCurrent(pendingSource);
    });
  };

  windowRef.addEventListener("popstate", restore);
  windowRef.addEventListener("hashchange", restore);

  return {
    current,
    start() {
      const route = current();
      const hash = serializeRoute(route);
      if (windowRef.location.hash !== hash)
        windowRef.history.replaceState({ wmRoute: route }, "", hash);
      renderCurrent("initial");
    },
    navigate(route, { replace = false, state = null } = {}) {
      const target = serializeRoute(route);
      const same = sameRoute(current(), route);
      if (!same && !replace) saveScroll();
      const entryState = { wmRoute: route, ...(state || {}) };
      if (replace || same)
        windowRef.history.replaceState(entryState, "", target);
      else windowRef.history.pushState(entryState, "", target);
      rendered = target;
      render(route, { source: same ? "refresh" : "push", state: entryState });
    },
  };
}
