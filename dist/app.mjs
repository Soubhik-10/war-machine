                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            import {
  DEFAULT_RULES,
  normalizeRules,
  limitIssues,
  rulesLabel,
  MAX_MODULES,
  PARTS,
  BY_ID,
  PRESETS,
  PAINTS,
  GRID,
  LEVELS,
  LAYER_HEIGHT,
  PATTERNS,
  GRADES,
  clone,
  stats,
  HEAT_CAUTION,
  HEAT_DANGER,
  HEAT_LIMIT,
  POWER_CAUTION,
  POWER_CRITICAL,
  partSpec,
  keyOf,
  connected,
  validate,
  ARENAS,
  OBJECTIVES,
  ENEMIES,
  packChallenge,
  unpackChallenge,
  encodeChallenge,
  decodeChallenge,
} from "./data.mjs";
import { PART_GUIDANCE } from "./part-guidance.mjs";
import { createPortal } from "./portal.mjs";
import { createBountyUI } from "./bounties.mjs";
import { createFriendlyChallengesUI } from "./friendly.mjs";
import { createHashRouter } from "./routes.mjs";
import { CLIENT_ENGINE_HASH } from "./release.mjs";
import { TERRAIN_INFO } from "./data.mjs";
import {
  Battle,
  CELL,
  WIDTH,
  HEIGHT,
  DT,
  world,
  ABILITIES,
  failureLabel,
} from "./engine.mjs";
import { Renderer, Geometry, workshopScene, battleScene } from "./renderer.mjs";
import { newCamera, bindCamera, fittedSpan } from "./camera.mjs";
import {
  getGraphicsProfile,
  setGraphicsTier,
  watchPowerState,
} from "./performance.mjs";
import {
  engineeringReport,
  battleAdvice,
  weaponRows,
  combatSummary,
  stressTest,
  stressTestAsync,
  pickModule,
} from "./engineering.mjs";
import { AudioDirector, MusicDirector, readAudioPreference } from "./audio.mjs";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  app = $("#app"),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const partGuide = (p) =>
  // Resource bands are shared with the simulation so the HUD and report agree.
  PART_GUIDANCE[p.id] || { role: p.cat.toUpperCase(), quick: p.desc };
function partMetricRows(part) {
  const p = partSpec(part),
    rows = [["DURABILITY", `${Math.round(p.hp)} HP`], ["MASS", `${Math.round(p.mass)} t`]];
  if (p.damage && p.rate)
    rows.push(["DPS", `${(p.damage * (p.pellets || 1) / p.rate).toFixed(1)}`]);
  if (p.range) rows.push(["RANGE", `${Math.round(p.range)} m`]);
  if (p.thrust) rows.push(["THRUST", `${Math.round(p.thrust)}`]);
  if (p.power) rows.push(["GENERATION", `+${Math.round(p.power)}/s`]);
  if (p.cooling) rows.push(["COOLING", `${Math.round(p.cooling)}/s`]);
  if (p.energy) rows.push(["ENERGY / SHOT", `${p.energy}`]);
  if (p.heat) rows.push(["HEAT / SHOT", `${p.heat}`]);
  if (p.shield) rows.push(["SHIELD", `${Math.round(p.shield)}`]);
  if (p.sensor) rows.push(["SENSOR NETWORK", `${Math.round(p.sensor * 100)}%`]);
  if (p.armor) rows.push(["DAMAGE RESIST", `${Math.round(p.armor * 100)}%`]);
  if (p.capacity) rows.push(["ENERGY CAPACITY", `+${Math.round(p.capacity)}`]);
  if (p.repair) rows.push(["REPAIR", `${Math.round(p.repair)}/s`]);
  if (p.ram) rows.push(["IMPACT", `${Math.round(p.ram)}`]);
  return rows;
}
function machineMetricRows(s) {
  const powerFactor = s.energy ? clamp(s.power / s.energy, 0, 1) : 1,
    coolingFactor = s.heat ? clamp(s.cooling / s.heat, 0, 1) : 1,
    sustainedDps = s.dps * Math.max(0.2, powerFactor) * Math.max(0.2, coolingFactor),
    mobility = Math.round(clamp((s.speed / 115) * s.stability * 100, 0, 100));
  return [
    ["RAW DPS", `${Math.round(s.dps)}`],
    ["SUSTAINED DPS", `${Math.round(sustainedDps)}`],
    ["TOP SPEED", `${Math.round(s.speed)} m/s`],
    ["MOBILITY SCORE", `${mobility}%`],
    ["POWER HEADROOM", `${(s.power - s.energy).toFixed(1)}/s`],
    ["COOLING HEADROOM", `${(s.cooling - s.heat).toFixed(1)}/s`],
    ["TOTAL DURABILITY", `${Math.round(s.hp)} HP`],
    ["SENSOR NETWORK", `${Math.round((s.sensor || 0) * 100)}%`],
  ];
}
function machineMetricText(s, name = machine.name || "Machine") {
  return `${name} · ${machineMetricRows(s).map(([label, value]) => `${label}: ${value}`).join(" · ")}. Power and cooling headroom reduce sustained output when they run negative.`;
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let graphicsProfile = getGraphicsProfile();
let lastArenaRender = 0;
let theaterFallback = false;
let battleFocusView = false;
let machine = clone(PRESETS[0]),
  selected = "cannon",
  category = "Weapons",
  rotation = 0,
  layer = 0,
  mode = "place",
  mirror = false,
  fullStack = true,
  exploded = false,
  focus = null,
  brush = "#5cbab4",
  history = [],
  view = "workshop",
  sound = readAudioPreference().enabled;
let builderRenderer = null,
  arenaRenderer = null,
  thumbRenderer = null,
  largePreviewRenderer = null,
  largePreviewCanvas = null,
  thumbCanvas = null,
  benchCamera = newCamera(),
  fightCamera = newCamera(true),
  hover = null,
  cursor = { x: 4, y: 4 },
  benchRAF = 0,
  benchDirty = true;
let arenaId = "foundry",
  objective = "reactor",
  enemyIndex = 0,
  seed = 42817,
  challenge = null,
  battle = null,
  running = false,
  paused = false,
  speed = 1,
  raf = 0,
  lastFrame = 0,
  accumulator = 0,
  matchSource = null,
  lastLogCount = 0,
  inspectMode = false,
  battleMode = "auto";
const audioDirector = new AudioDirector();
const musicDirector = new MusicDirector({
  tracks: {
    general: { src: "./audio/general.ogg", loop: true, gain: 0.52 },
    battle: { src: "./audio/battle.ogg", loop: true, gain: 0.42 },
    victory: { src: "./audio/victory.ogg", loop: false, gain: 0.68 },
    defeat: { src: "./audio/defeat.ogg", loop: false, gain: 0.64 },
  },
});
// UI confirmation reuses the context created by the user-gesture audio director.
let audioCtx = null;
let arenaIdleRAF = 0,
  battleCountdownTimer = 0,
  battleCountdownRun = 0,
  modalCleanup = null,
  replaceFitted = false,
  scoutRenderer = null,
  bountyClock = 0;
let portal = null,
  bountyUI = null,
  friendlyUI = null,
  routeRouter = null,
  routeRestoring = false,
  bountyContext = null,
  replayRestore = null,
  officialReceipt = null,
  officialAttemptId = null,
  officialRedirectTimer = 0;
let rules = clone(DEFAULT_RULES),
  preChallengeRules = null,
  mirrorOpponent = false;
const applyGraphicsProfile = (next) => {
  if (!next || next.tier === graphicsProfile.tier) return;
  graphicsProfile = next;
  document.documentElement.dataset.graphicsTier = next.tier;
  for (const renderer of [
    builderRenderer,
    arenaRenderer,
    scoutRenderer,
    thumbRenderer,
  ]) {
    if (renderer)
      renderer.maxPixelRatio =
        renderer === thumbRenderer && next.tier === "high"
          ? 2
          : next.maxPixelRatio;
  }
  lastArenaRender = 0;
  invalidateBench();
};
document.documentElement.dataset.graphicsTier = graphicsProfile.tier;
window.warMachinesGraphics = {
  get tier() {
    return graphicsProfile.tier;
  },
  get profile() {
    return graphicsProfile;
  },
  setTier(tier) {
    const next = setGraphicsTier(tier);
    applyGraphicsProfile(next);
    return next;
  },
};
watchPowerState(graphicsProfile, applyGraphicsProfile);
const frontNames = ["North ↑", "East →", "South ↓", "West ←"];
let wins = {};
try {
  const raw =
    localStorage.getItem("wm-machine-v3") ||
    localStorage.getItem("wm-machine-v2") ||
    localStorage.getItem("wm-machine-v1");
  if (raw) {
    const saved = unpackChallenge(JSON.parse(raw), true);
    machine = saved.machine;
    rules = saved.rules;
    arenaId = saved.arena;
    objective = saved.objective || "reactor";
    seed = saved.seed;
    battleMode = rules.combat;
    rotation = machine.front || 0;
  }
  wins = JSON.parse(
    localStorage.getItem("wm-wins-v2") ||
      localStorage.getItem("wm-wins-v1") ||
      "{}",
  );
} catch {}
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3200);
}
function save() {
  try {
    localStorage.setItem(
      "wm-machine-v3",
      JSON.stringify(packChallenge(machine, arenaId, seed, rules, objective)),
    );
  } catch {
    $(".local-tag").textContent = "EXPORT TO SAVE";
  }
}
function snapshot() {
  history.push(clone(machine));
  if (history.length > 60) history.shift();
}
function changed() {
  save();
  invalidateBench();
  updateReadout();
  renderInspector();
}
function setNav() {
  document.body.dataset.page = view;
  $$("[data-view]").forEach((el) =>
    el.classList.toggle("active", el.dataset.view === view),
  );
  queueMicrotask(syncMusic);
}
function go(route, options) {
  routeRouter?.navigate(route, options);
}
function stopBattle() {
  battleCountdownRun++;
  clearTimeout(battleCountdownTimer);
  battleCountdownTimer = 0;
  $(".arena-screen")?.classList.remove("countdown-active");
  $("#fight-overlay")?.classList.remove("countdown-overlay");
  running = false;
  paused = false;
  cancelAnimationFrame(raf);
  audioDirector.clear({ stop: true, stale: true });
  musicDirector.hold("battle-paused", false);
}
function cleanupView() {
  document.body.classList.remove("official-replay");
  $("#builder-focus")?.classList.remove("theater");
  if (officialRedirectTimer) {
    clearTimeout(officialRedirectTimer);
    officialRedirectTimer = 0;
  }
  portal?.leave();
  bountyUI?.leave();
  clearInterval(bountyClock);
  bountyClock = 0;
  cancelAnimationFrame(arenaIdleRAF);
  stopBattle();
  cancelAnimationFrame(benchRAF);
  builderRenderer?.dispose();
  builderRenderer = null;
  arenaRenderer?.dispose();
  arenaRenderer = null;
  largePreviewRenderer?.dispose();
  largePreviewRenderer = null;
  largePreviewCanvas = null;
}
function sprite(p) {
  return `<canvas class="sprite" width="160" height="160" data-sprite="${p.id}" aria-hidden="true"></canvas>`;
}
const thumbnailCache = new Map();
const thumbnailJobs = new Map();
let thumbnailRAF = 0;
function thumbnailKey(machineOrPart) {
  return JSON.stringify({
    subject: machineOrPart,
    hull: typeof machineOrPart === "string" ? machine.paint : undefined,
    quality: graphicsProfile.tier,
    ratio: graphicsProfile.tier === "high" ? 2 : graphicsProfile.maxPixelRatio,
    yaw: typeof machineOrPart === "string" ? -2.3 : -2.55,
    elevation: 0.62,
  });
}
function scheduleThumbnailWork() {
  if (thumbnailRAF) return;
  thumbnailRAF = requestAnimationFrame(() => {
    thumbnailRAF = 0;
    const deadline = performance.now() + 6;
    for (const [canvas, subject] of thumbnailJobs) {
      thumbnailJobs.delete(canvas);
      if (canvas.isConnected) renderThumbnail(canvas, subject);
      if (performance.now() >= deadline) break;
    }
    if (thumbnailJobs.size) scheduleThumbnailWork();
  });
}
function queueThumbnail(canvas, machineOrPart) {
  thumbnailJobs.set(canvas, machineOrPart);
  scheduleThumbnailWork();
}
function renderLargePreview(canvas, machineOrPart) {
  if (
    typeof machineOrPart === "string" ||
    (canvas.id !== "defender-preview" &&
      canvas.id !== "create-preview" &&
      canvas.width < 450)
  )
    return false;
  try {
    if (largePreviewCanvas !== canvas) {
      largePreviewRenderer?.dispose();
      largePreviewRenderer = new Renderer(canvas, {
        maxPixelRatio: graphicsProfile.maxPixelRatio,
      });
      largePreviewCanvas = canvas;
    }
    const g = new Geometry();
    g.detail = graphicsProfile.tier === "high" ? "full" : "reduced";
    g.material = 4;
    g.box(0, -0.12, 0, 9.8, 0.18, 8.1, "#1d2b31");
    g.machine(machineOrPart, { time: 0 });
    const fit = fittedSpan(
      machineOrPart,
      (canvas.clientWidth || canvas.width) /
        Math.max(1, canvas.clientHeight || canvas.height),
      -2.35,
      0.64,
    );
    largePreviewRenderer.render(g, {
      target: fit.center,
      yaw: -2.35,
      elevation: 0.64,
      span: Math.max(2.6, fit.span + 0.65),
      bg: [0.075, 0.12, 0.15, 1],
    });
    return true;
  } catch (error) {
    console.error("High-resolution 3D preview failed", error);
    return false;
  }
}
function renderThumbnail(canvas, machineOrPart) {
  try {
    if (renderLargePreview(canvas, machineOrPart)) return;
    const cacheKey = thumbnailKey(machineOrPart);
    let cached = thumbnailCache.get(cacheKey);
    if (cached) {
      thumbnailCache.delete(cacheKey);
      thumbnailCache.set(cacheKey, cached);
    }
    if (!cached) {
      thumbCanvas ||= document.createElement("canvas");
      thumbCanvas.width = thumbCanvas.height = 220;
      thumbRenderer ||= new Renderer(thumbCanvas, { preserveDrawingBuffer: true, maxPixelRatio: graphicsProfile.tier === "high" ? 2 : graphicsProfile.maxPixelRatio });
      const g = new Geometry();
      let params;
      if (typeof machineOrPart === "string") {
        g.cylinder([0, 0, 0], [0, 0.08, 0], 0.9, "#2f3d42", 24);
        g.module(
          { id: machineOrPart, pattern: "racing" },
          machine.paint || "#e5a849",
        );
        params = {
          target: [0, 0.78, -0.12],
          yaw: -2.3,
          elevation: 0.62,
          span: 2.65,
        };
      } else {
        g.machine(machineOrPart);
        const fit = fittedSpan(machineOrPart, 1, -2.55, 0.62);
        params = {
          target: fit.center,
          yaw: -2.55,
          elevation: 0.62,
          span: fit.span - 0.5,
        };
      }
      thumbRenderer.render(g, params);
      cached = document.createElement("canvas");
      cached.width = cached.height = 220;
      cached.getContext("2d").drawImage(thumbCanvas, 0, 0);
      thumbnailCache.set(cacheKey, cached);
      if (thumbnailCache.size > 90)
        thumbnailCache.delete(thumbnailCache.keys().next().value);
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
  } catch {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#b9c9c2";
    ctx.textAlign = "center";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(
      typeof machineOrPart === "string"
        ? BY_ID[machineOrPart].name
        : machineOrPart.name,
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}
function renderSprites() {
  $$("[data-sprite]").forEach((c) => queueThumbnail(c, c.dataset.sprite));
}
function drawThumbnails() {
  const saved = savedBlueprints();
  $$("[data-thumb]").forEach((c) => {
    const [type, id] = c.dataset.thumb.split(":");
    const m = type === "saved" ? saved[+id] : PRESETS[+id];
    if (m) queueThumbnail(c, m);
  });
}
function workshop() {
  if (!routeRestoring) return go({ name: "workshop" });
  restoreReplay();
  cleanupView();
  view = "workshop";
  setNav();
  hover = null;
  focus = machine.modules.some((m) => keyOf(m) === focus) ? focus : null;
  app.innerHTML = `<div class="page-heading"><div><span class="eyebrow">BUILD / TEST / REFINE</span><h1>WORKSHOP</h1><p>Place parts, manage the tradeoffs, and see what survives.</p></div><div class="heading-actions"><button id="blueprints-btn">▦ Blueprints</button><button id="share-btn">↗ Challenge a friend</button></div></div>
 <div class="workspace"><aside class="panel parts-panel"><div class="panel-head"><h3>Parts</h3><small>${PARTS.length} PARTS</small></div><div class="parts-tabs">${["All", "Weapons", "Defense", "Structure", "Mobility", "Systems"].map((c) => `<button data-category="${c}" class="${c === category ? "active" : ""}">${c}</button>`).join("")}</div><div class="parts-list" id="parts-list"></div><div class="selection-details" id="selection-details"></div></aside>
 <section class="panel bench"><div class="bench-top"><input class="machine-title" id="machine-name" aria-label="Machine name" maxlength="28" value="${esc(machine.name)}"><small id="module-count"></small></div>
 <div class="bench-tools">${[
   ["place", "▦ Build"],
   ["inspect", "◎ Inspect"],
   ["paint", "◉ Paint"],
   ["remove", "⌫ Remove"],
 ]
   .map(
     ([id, label]) =>
       `<button data-mode="${id}" class="${mode === id ? "active" : ""}">${label}</button>`,
   )
   .join(
     "",
   )}<label class="toggle replace-toggle"><input id="replace-fitted" type="checkbox" ${replaceFitted ? "checked" : ""}> Replace parts</label><button id="rotate-btn" title="Rotate selected part (R)">↻ ${rotation * 90}°</button><button id="undo-btn" aria-label="Undo last change">↶ Undo</button></div>
 <div class="front-bar"><div><strong>▴ MACHINE FRONT</strong><small>This side faces the other machine in battle.</small></div><select id="machine-front" aria-label="Machine front">${frontNames.map((n, i) => `<option value="${i}" ${i === (machine.front || 0) ? "selected" : ""}>${n}</option>`).join("")}</select><label class="toggle"><input id="align-front" type="checkbox" checked> Turn mounts too</label></div><div class="level-bar"><span>BUILD LEVEL</span><div class="segmented">${["0 · Chassis", "1 · Deck", "2 · Tower"].map((text, i) => `<button data-level="${i}" class="${layer === i ? "active" : ""}">${text}</button>`).join("")}</div><label class="toggle"><input id="mirror" type="checkbox" ${mirror ? "checked" : ""}> Mirror</label></div>
 <div class="bench-stage" id="builder-focus"><div class="grid-caption"><span id="install-hint"></span><span id="level-label"></span></div><div class="builder-wrap"><canvas id="builder" width="900" height="680" tabindex="0" aria-label="3D assembly: tap to build, drag to orbit, scroll or pinch to zoom. Choose a build level for vertical stacking."></canvas></div>
 <div class="camera-controls"><button data-camera="iso" title="Reset and fit">⌖ Fit</button><button data-camera="front">Front</button><button data-camera="top">Top</button><button data-camera="side">Side</button><button data-camera="pan" title="Switch drag between orbit and pan">✥ Pan</button><button data-camera="in" aria-label="Zoom in">+</button><button data-camera="out" aria-label="Zoom out">−</button><button id="builder-fullscreen-btn" title="Fullscreen builder" aria-label="Fullscreen builder">⛶</button></div>
 <div class="grid-caption bottom"><span>DRAG TO ORBIT · PINCH / SCROLL TO ZOOM</span><span>3 LEVELS</span></div></div>
 <div class="view-toggles"><label class="toggle"><input id="full-stack" type="checkbox" ${fullStack ? "checked" : ""}> Show upper levels</label><label class="toggle"><input id="explode" type="checkbox" ${exploded ? "checked" : ""}> Exploded view</label><button class="quiet" id="clear-btn">Clear machine</button></div><div class="bench-status" id="bench-status"></div></section>
 <aside class="right-column"><section class="panel limits-panel"><details class="workshop-disclosure limits-disclosure" id="limits-disclosure"><summary><span><strong>Engineering limits</strong><small id="class-label">${rules.mode.toUpperCase()}</small></span><span class="compact-limit" id="limit-compact"></span></summary><div class="stats-body" id="stats"></div></details></section><section class="panel engineering-panel"><div class="panel-head engineering-head"><div><small>BUILD CHECK</small><h3>Build report</h3></div><label class="climate-control"><span>Arena</span><select id="workshop-climate" class="workshop-climate" aria-label="Workshop terrain" ${challenge ? "disabled" : ""}>${ARENAS.map((a) => `<option value="${a.id}" ${a.id === arenaId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label></div><div id="engineering-summary"></div><details class="engineering-disclosure" id="engineering-disclosure"><summary><span>Open build findings</span><span id="engineering-count"></span></summary><div id="engineering-report"></div></details></section><section class="panel inspector-panel"><details class="workshop-disclosure inspector-disclosure" id="inspector-disclosure"><summary><span><strong>Part details</strong><small id="inspector-label">INSPECT</small></span></summary><div id="inspector"></div></details></section></aside></div>
 ${rulesPanel()}<div class="customization-row"><section class="panel"><div class="panel-head"><h3>Paint & identity</h3><small>MAKE IT YOURS</small></div><div class="custom-body"><div class="paint-row">${PAINTS.map((p) => `<button class="swatch ${machine.paint === p ? "active" : ""}" style="background:${p}" data-paint="${p}" aria-label="Hull paint ${p}"></button>`).join("")}</div><div class="custom-fields"><label class="color-field">Hull <input id="hull-color" type="color" value="${machine.paint}"></label><label class="color-field">Accent <input id="accent-color" type="color" value="${machine.accent || "#dbc58b"}"></label><label class="color-field">Lights <input id="glow-color" type="color" value="${machine.glow || "#6ef1dc"}"></label><label class="field"><span>Livery</span><select id="pattern">${PATTERNS.map((p) => `<option value="${p}">${p[0].toUpperCase() + p.slice(1)}</option>`).join("")}</select></label><label class="field"><span>Material finish</span><select id="finish"><option value="matte">Weathered paint</option><option value="alloy">Brushed alloy</option></select></label><label class="field"><span>Unit number</span><input id="unit-number" type="number" min="1" max="99" value="${machine.number || 7}"></label></div><p class="hint">Use Paint mode to color individual parts. Hull paint affects parts without a custom color.</p></div></section>
 <section class="panel"><div class="panel-head"><h3>Machine behavior</h3><small>CHOOSE BEFORE THE FIGHT</small></div><div class="tactics-body"><label class="field"><span>Movement</span><select id="tactic"><option value="balanced">Hold optimal range</option><option value="kite">Kite & retreat</option><option value="flank">Flank & circle</option><option value="ram">Ram & overwhelm</option></select></label><label class="field"><span>Target priority</span>${targetSelect("target")}</label><label class="field"><span>Range <b id="range-value">${machine.range} m</b></span><input type="range" id="range" min="80" max="600" step="10" value="${machine.range}"></label><label class="field"><span>Damage response</span><select id="stance"><option value="steady">Hold the line</option><option value="aggressive">Push when enemy weakens</option><option value="guarded">Protect the damaged side</option></select></label></div></section></div>
 <div class="deploy-bar"><div><h3>Ready to test.</h3><p>Choose how it moves, run a fight, and fix what breaks.</p></div><div class="deploy-actions"><button id="save-btn">Save blueprint</button><button class="primary" id="deploy-btn">Open the arena ↗</button></div></div><div class="footer-note"><span id="rules-footer">${rulesLabel(rules)}</span><span>R ROTATE / CTRL+Z UNDO / ARROWS + ENTER BUILD</span></div>`;
  renderParts();
  const machineSurface = $(".builder-wrap");
  if (machineSurface) {
    const tooltip = machineMetricText(stats(machine));
    machineSurface.title = tooltip;
    machineSurface.setAttribute("aria-label", tooltip);
  }
  organizeWorkshop();
  $("#save-btn")?.insertAdjacentHTML("afterend", '<button id="stress-btn">Stress test</button>');
  bindWorkshop();
  bindRules();
  $(".rules-panel .rules-body")?.insertAdjacentHTML("beforeend", '<p class="timeout-formula">Timeout score: 35% core · 25% structure · 15% weapons · 15% mobility · 10% power/cooling. A gap under 2.5 points is a draw.</p>');
  $("#workshop-climate").onchange = (e) => {
    arenaId = e.target.value;
    save();
    updateReadout();
  };
  updateReadout();
  renderInspector();
  invalidateBench();
  renderContractContext();
  window.scrollTo(0, 0);
}

// Move the existing controls intact so their IDs and event bindings stay stable.
function organizeWorkshop() {
  const settings = document.createElement("div");
  settings.className = "workshop-settings";
  const customization = $(".customization-row");
  const panels = [
    [customization.children[1], "Machine behavior", "Movement, targets & range"],
    [$(".rules-panel"), "Match rules", "Class & construction limits"],
    [customization.children[0], "Appearance", "Paint, finish & identity"],
  ];
  for (const [panel, title, description] of panels) {
    const disclosure = document.createElement("details");
    disclosure.className = "settings-disclosure";
    const summary = document.createElement("summary");
    summary.innerHTML = `<span><strong>${title}</strong><small>${description}</small></span>`;
    disclosure.append(summary, panel);
    settings.append(disclosure);
  }
  customization.remove();
  $(".deploy-bar").after(settings);
  $("#deploy-btn").textContent = "Test machine ↗";
  $("#deploy-btn").setAttribute("aria-describedby", "deploy-status");
  $(".deploy-bar p").id = "deploy-status";
}

function rulesPanel() {
  return `<section class="panel rules-panel"><div class="panel-head"><h3>Match rules</h3><small>${challenge ? "LOCKED BY CHALLENGE" : "SET THE LIMITS"}</small></div><div class="rules-body"><div class="rules-presets">${[
    ["standard", "Standard"],
    ["skirmish", "Skirmish"],
    ["heavy", "Heavy"],
    ["custom", "Custom"],
    ["unlimited", "∞ Unlimited"],
  ]
    .map(
      ([id, label]) =>
        `<button data-rules="${id}" class="${id === rules.mode || (rules.mode === "custom" && ((id === "skirmish" && rules.credits === 800 && rules.parts === 24 && rules.mass === 240 && rules.weapons === 6) || (id === "heavy" && rules.credits === 3000 && rules.parts === 64 && rules.mass === 1200 && rules.weapons === 20))) ? "active" : ""}" ${challenge ? "disabled" : ""}>${label}</button>`,
    )
    .join("")}</div><div class="rules-fields">${[
    ["credits", "Credit budget", 1000000],
    ["parts", "Fitted part limit", 243],
    ["mass", "Mass · tonnes", 100000],
    ["weapons", "Weapon limit", 243],
  ]
    .map(
      ([id, label, max]) =>
        `<label class="field"><span>${label}</span><input data-rule-input="${id}" aria-label="${label}" type="number" min="0" max="${max}" step="1" value="${rules[id] ?? 0}" ${challenge ? "disabled" : ""}></label>`,
    )
    .join(
      "",
    )}</div><p class="hint" id="rules-hint">${challenge ? "These rules travel with the challenge and apply to both machines. Leave the challenge to edit them." : "The required command core is free from the fitted-part limit. Zero means no cap. Unlimited opens all 243 sockets across three levels; structure, mobility, and support still matter. Limits include upgrades and elevated mounts. Change a limit to create a custom class."}</p>${challenge ? '<button id="workshop-leave-challenge">Leave friend challenge</button>' : ""}</div></section>`;
}
function bindRules() {
  const redraw = () => {
    const panel = $(".rules-panel");
    panel.outerHTML = rulesPanel();
    bindRules();
    $(".rules-panel .rules-body")?.insertAdjacentHTML("beforeend", '<p class="timeout-formula">Timeout score: 35% core · 25% structure · 15% weapons · 15% mobility · 10% power/cooling. A gap under 2.5 points is a draw.</p>');
    updateReadout();
    save();
  };
  $$("[data-rules]").forEach(
    (b) =>
      (b.onclick = () => {
        if (challenge) return;
        const id = b.dataset.rules;
        rules = normalizeRules({
          ...DEFAULT_RULES,
          combat: rules.combat,
          ...(id === "skirmish"
            ? { mode: "custom", credits: 800, parts: 24, mass: 240, weapons: 6 }
            : id === "heavy"
              ? {
                  mode: "custom",
                  credits: 3000,
                  parts: 64,
                  mass: 1200,
                  weapons: 20,
                }
              : id === "custom"
                ? { ...rules, mode: "custom" }
                : { mode: id }),
        });
        redraw();
      }),
  );
  $$("[data-rule-input]").forEach(
    (input) =>
      (input.onchange = () => {
        if (challenge) return;
        const n = Number(input.value),
          key = input.dataset.ruleInput;
        if (
          input.value.trim() === "" ||
          !Number.isInteger(n) ||
          n < 0 ||
          n > +input.max
        ) {
          toast("Enter a whole number from 0 to " + input.max + ".");
          input.value = rules[key] ?? 0;
          return;
        }
        rules = normalizeRules({
          ...rules,
          mode: "custom",
          [key]: n === 0 ? null : n,
        });
        redraw();
      }),
  );
  if ($("#workshop-leave-challenge"))
    $("#workshop-leave-challenge").onclick = leaveChallenge;
}

function targetSelect(id) {
  return `<select id="${id}" aria-label="Target priority"><option value="weapons">Enemy weapons</option><option value="power">Power & cooling</option><option value="mobility">Wheels & treads</option><option value="core">Command core</option><option value="nearest">Nearest part</option></select>`;
}
function setBuildMode(next) {
  mode = next;
  $$("[data-mode]").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode),
  );
  renderParts();
  renderInspector();
  invalidateBench();
}
function renderParts({ rebuild = false } = {}) {
  const list = $("#parts-list");
  if (!list) return;
  const signature = `${category}:${layer}`;
  if (rebuild || list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.innerHTML = PARTS.filter(
    (p) => p.id !== "core" && (category === "All" || p.cat === category),
  )
    .map((p) => {
      const guide = partGuide(p);
      const effective = partSpec({ id: p.id, z: layer });
      const metrics = partMetricRows(p)
        .map(([label, value]) => `${label}: ${value}`)
        .join(" · ");
      return `<button class="part-card ${selected === p.id && mode === "place" ? "active" : ""}" data-part="${p.id}" title="${esc(`${guide.role} · ${metrics}. ${p.desc}`)}" aria-label="${esc(p.name + ". " + guide.role + ". " + metrics)}"><span class="price">${effective.cost} ¢</span><span class="part-role">${esc(guide.role)}</span>${sprite(p)}<strong>${p.name}</strong></button>`;
    })
    .join("");
    $$("[data-part]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.part;
        setBuildMode("place");
        if (innerWidth < 641)
          $(".bench").scrollIntoView({ behavior: "smooth", block: "start" });
      }),
    );
    renderSprites();
  } else {
    // The common selection path keeps existing canvases, listeners and focus.
    $$('[data-part]').forEach((card) => {
      const active = card.dataset.part === selected && mode === "place";
      card.classList.toggle("active", active);
      card.setAttribute("aria-pressed", String(active));
    });
  }
  const base = BY_ID[selected],
    p = partSpec({ id: selected, z: layer }),
    guide = partGuide(base);
  $("#selection-details").innerHTML =
    `<span class="selection-kicker">AT A GLANCE · ${esc(guide.role)}</span><h3>${p.name}</h3><p class="part-quick">${esc(guide.quick)}</p><p>${p.desc}</p><div class="part-tags"><span>${p.hp} HP</span><span>${p.mass} t</span><span>${p.ground ? "Ground only" : p.support ? "Supports stacking" : "Upper mount ready"}</span></div>`;
  $("#install-hint").textContent =
    mode === "place"
      ? p.name + " · tap a + socket"
      : mode === "paint"
        ? "Tap a part to apply your brush color"
        : mode === "remove"
          ? "Tap a part to remove it"
          : "Tap a fitted part to customize it";
  $("#level-label").textContent = ["CHASSIS", "UPPER DECK", "TOWER"][layer];
}
function budgetError(next) {
  if (next.modules.length > MAX_MODULES)
    return "All 243 build sockets are occupied.";
  const before = stats(machine),
    after = stats(next),
    errors = limitIssues(next, rules);
  if (
    errors.length &&
    ["cost", "parts", "mass", "weapons"].every((k) => after[k] <= before[k]) &&
    ["cost", "parts", "mass", "weapons"].some((k) => after[k] < before[k])
  )
    return "";
  return errors[0] || "";
}
function placeCell(c, forcedMode = mode) {
  if (c.x < 0 || c.x >= 9 || c.y < 0 || c.y >= 9) return;
  cursor = c;
  const existing = machine.modules.find(
    (m) => m.x === c.x && m.y === c.y && (m.z || 0) === layer,
  );
  if (forcedMode === "place" && existing && !replaceFitted) {
    focus = keyOf(existing);
    renderInspector();
    invalidateBench();
    toast(
      "Part selected. Use its inspector, or enable Replace parts to swap it.",
    );
    return;
  }
  if (forcedMode === "inspect" || existing?.id === "core") {
    focus = existing ? keyOf(existing) : null;
    renderInspector();
    invalidateBench();
    return;
  }
  if (forcedMode === "paint") {
    if (!existing) return;
    snapshot();
    existing.c = brush;
    focus = keyOf(existing);
    changed();
    return;
  }
  const next = clone(machine),
    positions = [c];
  if (mirror && c.x !== 4) positions.push({ x: 8 - c.x, y: c.y });
  let touched = false;
  for (const pos of positions) {
    const old = next.modules.find(
      (m) => m.x === pos.x && m.y === pos.y && (m.z || 0) === layer,
    );
    if (old?.id === "core") continue;
    if (old && forcedMode === "place" && !replaceFitted) {
      toast("A mirrored socket is occupied. Enable Replace parts to swap it.");
      return;
    }
    if (forcedMode === "remove") {
      if (old) {
        next.modules.splice(next.modules.indexOf(old), 1);
        touched = true;
      }
      continue;
    }
    const p = BY_ID[selected];
    if (layer && p.ground) {
      toast(p.name + " belongs on the chassis level.");
      return;
    }
    if (
      layer &&
      !next.modules.some(
        (m) =>
          m.x === pos.x &&
          m.y === pos.y &&
          (m.z || 0) === layer - 1 &&
          BY_ID[m.id].support,
      )
    ) {
      toast(
        "Place a supporting frame, deck, core, or armor directly below this socket.",
      );
      return;
    }
    if (old && old.id === selected && old.r === rotation) {
      focus = keyOf(old);
      renderInspector();
      continue;
    }
    if (old) next.modules.splice(next.modules.indexOf(old), 1);
    next.modules.push({
      id: selected,
      x: pos.x,
      y: pos.y,
      r: positions.length > 1 && pos !== c ? (4 - rotation) % 4 : rotation,
      ...(layer ? { z: layer } : {}),
    });
    touched = true;
  }
  if (!touched) return;
  const error = forcedMode === "remove" ? "" : budgetError(next);
  if (error) {
    toast(error);
    return;
  }
  snapshot();
  machine = next;
  focus = forcedMode === "remove" ? null : keyOf({ ...c, z: layer });
  changed();
  if (sound)
    beep(forcedMode === "remove" ? 180 : 440, 0.035, 0.025, "triangle");
}
function updateReadout() {
  if (!$("#stats")) return;
  const s = stats(machine),
    issues = validate(machine, rules),
    cap = (k) => (rules[k] === null ? "∞" : rules[k].toLocaleString()),
    over = (k, v) => rules[k] !== null && v > rules[k];
  $("#module-count").textContent =
    `${s.parts} / ${cap("parts")} FITTED PARTS + CORE`;
  $("#class-label").textContent = rules.mode.toUpperCase();
  $("#rules-footer").textContent = rulesLabel(rules);
  const compactLimit = $("#limit-compact");
  if (compactLimit) {
    compactLimit.textContent = `${rules.credits === null ? "NO CREDIT CAP" : `${s.cost.toLocaleString()} / ${rules.credits.toLocaleString()} ¢`} · ${s.parts}/${cap("parts")} parts`;
    compactLimit.classList.toggle("warn", !!issues.length);
  }
  const powerFactor = s.energy ? clamp(s.power / s.energy, 0, 1) : 1,
    coolingFactor = s.heat ? clamp(s.cooling / s.heat, 0, 1) : 1,
    sustainedDps = s.dps * Math.max(0.2, powerFactor) * Math.max(0.2, coolingFactor),
    mobilityScore = Math.round(clamp((s.speed / 115) * s.stability * 100, 0, 100));
  const machineSurface = $(".builder-wrap");
  if (machineSurface) {
    const tooltip = machineMetricText(s);
    machineSurface.title = tooltip;
    machineSurface.setAttribute("aria-label", tooltip);
  }
  $("#stats").innerHTML =
    `<div class="budget-row"><strong>${s.cost.toLocaleString()} <span>¢</span></strong><span>${rules.credits === null ? "NO CREDIT CAP" : (rules.credits - s.cost).toLocaleString() + " left"}</span></div><div class="meter"><i style="width:${rules.credits === null ? 0 : Math.min(100, (s.cost / rules.credits) * 100)}%"></i></div><div class="limit-chips"><span class="${over("parts", s.parts) ? "warn" : ""}">${s.parts}/${cap("parts")} fitted</span><span class="${over("mass", s.mass) ? "warn" : ""}">${s.mass}/${cap("mass")} t</span><span class="${over("weapons", s.weapons) ? "warn" : ""}">${s.weapons}/${cap("weapons")} weapons</span></div><div class="stat-grid"><div><small>INTEGRITY</small><strong>${s.hp.toLocaleString()} <small>HP</small></strong></div><div><small>FIREPOWER</small><strong>${Math.round(s.dps)} <small>DPS</small></strong></div><div><small>TOP SPEED</small><strong>${Math.round(s.speed)} <small>m/s</small></strong></div><div><small>STABILITY</small><strong>${Math.round(s.stability * 100)}<small>%</small></strong></div></div><div class="system-row"><span>Sustained DPS</span><b class="${sustainedDps < s.dps * .8 ? "warn" : ""}">${Math.round(sustainedDps)}</b></div><div class="system-row"><span>Mobility score</span><b class="${mobilityScore < 50 ? "warn" : ""}">${mobilityScore}%</b></div><div class="system-row"><span>Power / demand</span><b class="${s.power < s.energy ? "warn" : ""}">${Math.round(s.power)} / ${Math.ceil(s.energy)}</b></div><div class="system-row"><span>Cooling / heat</span><b class="${s.cooling < s.heat ? "warn" : ""}">${Math.round(s.cooling)} / ${Math.ceil(s.heat)}</b></div><div class="system-row"><span>Shield / energy reserve</span><b>${Math.round(s.shield)} / ${s.capacity}</b></div><div class="system-row"><span>Targeting / sensors</span><b class="${s.sensor < .8 ? "warn" : ""}">${Math.round((s.sensor || 0) * 100)}% / ${s.sensors || 0}</b></div>`;
  $("#bench-status").classList.toggle("invalid", !!issues.length);
  $("#bench-status").innerHTML =
    `<span class="status-dot"></span>${esc(issues[0] || "Structure sound. Cleared for deployment.")}`;
  $("#deploy-btn").disabled = !!issues.length;
  $(".deploy-bar h3").textContent = issues.length ? "Build needs attention" : "Ready to test";
  $("#deploy-status").textContent = issues[0] || "Practice is free. Your machines fight automatically.";
  $("#undo-btn").disabled = !history.length;
  renderEngineering();
}
function renderInspector() {
  if (!$("#inspector")) return;
  const m = machine.modules.find((m) => keyOf(m) === focus),
    disclosure = $("#inspector-disclosure");
  if (mode === "paint") {
    $("#inspector-label").textContent = "PAINT";
    if (disclosure) disclosure.open = true;
    $("#inspector").innerHTML =
      `<div class="inspector-body"><h3>Paint brush</h3><p>Tap a part to give it a custom color. Your other parts keep their hull paint.</p><label class="color-field">Brush color <input type="color" id="brush-color" value="${brush}"></label><button id="reset-part-paints">Use hull color on every part</button></div>`;
    $("#brush-color").oninput = (e) => (brush = e.target.value);
    $("#reset-part-paints").onclick = () => {
      snapshot();
      machine.modules.forEach((m) => delete m.c);
      changed();
    };
    return;
  }
  if (!m) {
    $("#inspector-label").textContent = "INSPECT";
    $("#inspector").innerHTML =
      '<div class="inspector-body"><p>Select <strong>Inspect</strong>, then tap a fitted part to reinforce it, overclock it, rotate it, or give it a custom color.</p><div class="stack-guide"><strong>Build upward</strong><span>Fit a frame or deck → select Level 1 → place a turret above it. Add another supporting deck to reach Level 2.</span></div><p class="hint">Upper mounts cost +12 credits per level. Tall builds have slower steering.</p></div>';
    return;
  }
  const p = partSpec(m),
    base = BY_ID[m.id],
    tunable = !!(
      base.rate ||
      base.thrust ||
      base.power ||
      base.cooling ||
      base.shield
  );
  $("#inspector-label").textContent = `LEVEL ${m.z || 0}`;
  if (disclosure) disclosure.open = true;
  $("#inspector").innerHTML =
    `<div class="inspector-body"><h3>${p.name}</h3><p class="hint">${p.hp} HP · ${p.mass} t · ${p.cost} credits</p><label class="field"><span>Specification</span><select id="part-grade"><option value="stock">Standard</option><option value="reinforced">Reinforced: +35% HP</option>${tunable ? '<option value="tuned">Overclocked: +20% output</option>' : ""}</select></label><p class="hint" id="grade-detail">Reinforced: +30% cost, +25% mass. Overclocked: +35% cost, −15% HP; weapons generate 30% more heat.</p><div class="cost-breakdown"><span>Base ${base.cost} ¢</span><span>Upgrade ${Math.ceil(base.cost * GRADES[m.u || "stock"].cost) - base.cost} ¢</span><span>Mount ${(m.z || 0) * 12} ¢</span></div><label class="color-field">Part color <input type="color" id="part-color" value="${m.c || machine.paint}"></label><div class="inspector-actions"><button id="part-rotate">↻ Rotate ${m.r * 90}°</button><button id="part-reset-color">Hull color</button>${m.id !== "core" ? '<button id="part-replace">Replace with selected part</button><button id="part-remove">Remove</button><button id="remove-column">Remove stack</button>' : ""}</div></div>`;
  $("#part-grade").value = m.u || "stock";
  $("#part-grade").onchange = (e) => {
    const next = clone(machine),
      part = next.modules.find((p) => keyOf(p) === focus);
    if (e.target.value === "stock") delete part.u;
    else part.u = e.target.value;
    const err = budgetError(next);
    if (err) {
      toast(err);
      renderInspector();
      return;
    }
    snapshot();
    machine = next;
    changed();
  };
  $("#part-color").onchange = (e) => {
    snapshot();
    m.c = e.target.value;
    changed();
  };
  $("#part-reset-color").onclick = () => {
    snapshot();
    delete m.c;
    changed();
  };
  $("#part-rotate").onclick = () => {
    snapshot();
    m.r = (m.r + 1) % 4;
    changed();
  };
  if ($("#part-replace"))
    $("#part-replace").onclick = () => {
      const before = replaceFitted;
      replaceFitted = true;
      layer = m.z || 0;
      placeCell({ x: m.x, y: m.y }, "place");
      replaceFitted = before;
      $$("[data-level]").forEach((b) =>
        b.classList.toggle("active", +b.dataset.level === layer),
      );
      renderParts();
    };
  if ($("#part-remove"))
    $("#part-remove").onclick = () => {
      snapshot();
      machine.modules = machine.modules.filter((p) => p !== m);
      focus = null;
      changed();
    };
  if ($("#remove-column"))
    $("#remove-column").onclick = () => {
      snapshot();
      machine.modules = machine.modules.filter(
        (p) => !(p.x === m.x && p.y === m.y && (p.z || 0) >= (m.z || 0)),
      );
      focus = null;
      changed();
    };
}
function drawBuilder() {
  const c = $("#builder");
  if (!c) return;
  try {
    builderRenderer ||= new Renderer(c, { maxPixelRatio: graphicsProfile.maxPixelRatio });
    const fit = fittedSpan(
      machine,
      c.clientWidth / Math.max(1, c.clientHeight),
      benchCamera.yaw,
      benchCamera.elevation,
      LAYER_HEIGHT + (exploded ? 0.7 : 0),
    );
    builderRenderer.render(
      workshopScene(machine, {
        reuse: true,
        quality: graphicsProfile,
        hover: hover || (document.activeElement === c ? cursor : null),
        selected,
        rotation,
        erase: mode === "remove",
        grid: mode === "place",
        ghost: mode === "place",
        layer,
        full: fullStack,
        explode: exploded,
        focus,
        phase: reducedMotion ? 0 : performance.now() * 0.001,
      }),
      {
        target: [
          fit.center[0] + benchCamera.panX,
          fit.center[1],
          fit.center[2] + benchCamera.panZ,
        ],
        yaw: benchCamera.yaw,
        elevation: benchCamera.elevation,
        span: fit.span / benchCamera.zoom,
      },
    );
  } catch (e) {
    renderError(c, e);
  }
}
function renderError(canvas, error) {
  if (!$("#render-warning")) {
    const p = document.createElement("p");
    p.id = "render-warning";
    p.className = "render-warning";
    p.textContent =
      "3D graphics need WebGL 2 and hardware acceleration. Please enable them or use a supported browser.";
    canvas.after(p);
  }
  console.error(error);
}
function startBenchAnimation() {
  if (benchRAF || view !== "workshop") return;
  benchRAF = requestAnimationFrame(() => {
    benchRAF = 0;
    if (view !== "workshop" || !benchDirty) return;
    drawBuilder();
    benchDirty = false;
  });
}
function invalidateBench() {
  benchDirty = true;
  startBenchAnimation();
}
function cellFromEvent(e) {
  const gap = LAYER_HEIGHT + (exploded ? 0.7 : 0),
    hitPart = pickModule(builderRenderer?.ray(e.clientX, e.clientY), machine, {
      layer,
      full: fullStack,
      gap,
      allLevels: mode !== "place",
    });
  if (hitPart)
    return { x: hitPart.x, y: hitPart.y, z: hitPart.z || 0, part: hitPart };
  const hit = builderRenderer?.pick(e.clientX, e.clientY, layer * gap + 0.14);
  return hit
    ? { x: Math.round(hit.x) + 4, y: Math.round(hit.z) + 4 }
    : { x: -1, y: -1 };
}
function builderTap(e) {
  const c = cellFromEvent(e);
  if (c.part && (mode !== "place" || e.button === 2) && (c.z || 0) !== layer) {
    layer = c.z || 0;
    $$("[data-level]").forEach((b) =>
      b.classList.toggle("active", +b.dataset.level === layer),
    );
    renderParts();
  }
  placeCell(c, e.button === 2 ? "remove" : mode);
}
function bindWorkshop() {
  $("#replace-fitted").onchange = (e) => (replaceFitted = e.target.checked);
  $("#machine-front").onchange = (e) => {
    snapshot();
    const front = +e.target.value,
      delta = (front - (machine.front || 0) + 4) % 4;
    machine.front = front;
    if ($("#align-front").checked)
      for (const m of machine.modules)
        if (
          BY_ID[m.id].cat === "Weapons" ||
          BY_ID[m.id].cat === "Mobility" ||
          m.id === "ram" ||
          m.id === "booster"
        )
          m.r = ((m.r || 0) + delta) % 4;
    rotation = front;
    $("#rotate-btn").textContent = "↻ " + rotation * 90 + "°";
    changed();
    toast(
      "Front set to " + frontNames[front] + ". The lit nose faces the other machine.",
    );
  };
  $$("[data-category]").forEach(
    (b) =>
      (b.onclick = () => {
        category = b.dataset.category;
        $$("[data-category]").forEach((t) =>
          t.classList.toggle("active", t === b),
        );
        renderParts();
      }),
  );
  $$("[data-mode]").forEach(
    (b) => (b.onclick = () => setBuildMode(b.dataset.mode)),
  );
  $$("[data-level]").forEach(
    (b) =>
      (b.onclick = () => {
        layer = +b.dataset.level;
        $$("[data-level]").forEach((t) =>
          t.classList.toggle("active", t === b),
        );
        hover = null;
        invalidateBench();
        renderParts();
      }),
  );
  $("#machine-name").onfocus = () => snapshot();
  $("#machine-name").oninput = (e) => {
    machine.name = e.target.value.trim().slice(0, 28) || "Unnamed machine";
    save();
  };
  $("#rotate-btn").onclick = rotate;
  $("#undo-btn").onclick = undo;
  $("#mirror").onchange = (e) => (mirror = e.target.checked);
  $("#full-stack").onchange = (e) => {
    fullStack = e.target.checked;
    invalidateBench();
  };
  $("#explode").onchange = (e) => {
    exploded = e.target.checked;
    invalidateBench();
  };
  $("#clear-btn").onclick = () =>
    showModal(
      "Strip the chassis",
      `<p>Remove every part except the command core? Undo can restore this machine.</p><div class="modal-footer"><button data-close>Keep building</button><button class="primary" id="confirm-clear">Clear machine</button></div>`,
      () => {
        $("#confirm-clear").onclick = () => {
          snapshot();
          machine.modules = machine.modules.filter((m) => m.id === "core");
          focus = null;
          layer = 0;
          save();
          closeModal();
          workshop();
        };
      },
    );
  $("#finish").value = machine.finish || "matte";
  $("#finish").onchange = (e) => {
    snapshot();
    machine.finish = e.target.value;
    changed();
  };
  for (const k of ["tactic", "target", "stance", "pattern"]) {
    $("#" + k).value = machine[k] || (k === "pattern" ? "solid" : "");
    $("#" + k).onchange = (e) => {
      snapshot();
      machine[k] = e.target.value;
      save();
      invalidateBench();
    };
  }
  $("#range").oninput = (e) => {
    machine.range = +e.target.value;
    $("#range-value").textContent = machine.range + " m";
    save();
  };
  $$("[data-paint]").forEach(
    (b) =>
      (b.onclick = () => {
        snapshot();
        machine.paint = b.dataset.paint;
        $("#hull-color").value = machine.paint;
        $$("[data-paint]").forEach((t) =>
          t.classList.toggle("active", t === b),
        );
        save();
        invalidateBench();
      }),
  );
  for (const [id, prop] of [
    ["hull-color", "paint"],
    ["accent-color", "accent"],
    ["glow-color", "glow"],
  ])
    $("#" + id).onchange = (e) => {
      snapshot();
      machine[prop] = e.target.value;
      save();
      invalidateBench();
    };
  $("#unit-number").onchange = (e) => {
    snapshot();
    machine.number = clamp(Math.round(+e.target.value) || 7, 1, 99);
    e.target.value = machine.number;
    save();
    invalidateBench();
  };
  $$("[data-camera]").forEach(
    (b) =>
      (b.onclick = () => {
        const action = b.dataset.camera;
        if (action === "iso") Object.assign(benchCamera, newCamera());
        if (action === "front") {
          benchCamera.yaw = Math.PI - ((machine.front || 0) * Math.PI) / 2;
          benchCamera.elevation = 0.42;
          benchCamera.panX = benchCamera.panZ = 0;
        }
        if (action === "top") {
          benchCamera.elevation = 1.46;
          benchCamera.yaw = 0;
        }
        if (action === "side") benchCamera.elevation = 0.3;
        if (action === "in")
          benchCamera.zoom = Math.min(2.8, benchCamera.zoom * 1.15);
        if (action === "out")
          benchCamera.zoom = Math.max(0.45, benchCamera.zoom / 1.15);
        if (action === "pan") {
          benchCamera.drag = benchCamera.drag === "pan" ? "orbit" : "pan";
          b.classList.toggle("active", benchCamera.drag === "pan");
        }
        invalidateBench();
      }),
  );
  $("#builder-fullscreen-btn").onclick = async () => {
    const stage = $("#builder-focus");
    if (!stage) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
      else stage.classList.toggle("theater");
    } catch {
      stage.classList.toggle("theater");
    }
    requestAnimationFrame(invalidateBench);
  };
  const c = $("#builder");
  bindCamera(c, benchCamera, {
    change: () => {
      hover = null;
      invalidateBench();
    },
    tap: builderTap,
    hover: (e) => {
      hover = e ? cellFromEvent(e) : null;
      invalidateBench();
    },
  });
  c.onkeydown = (e) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        " ",
        "Delete",
        "Backspace",
      ].includes(e.key)
    ) {
      e.preventDefault();
      if (e.key === "ArrowUp") cursor.y = Math.max(0, cursor.y - 1);
      if (e.key === "ArrowDown") cursor.y = Math.min(8, cursor.y + 1);
      if (e.key === "ArrowLeft") cursor.x = Math.max(0, cursor.x - 1);
      if (e.key === "ArrowRight") cursor.x = Math.min(8, cursor.x + 1);
      if (e.key === "Enter" || e.key === " ") placeCell(cursor);
      if (["Delete", "Backspace"].includes(e.key)) placeCell(cursor, "remove");
      hover = null;
      invalidateBench();
    }
  };
  $("#blueprints-btn").onclick = blueprints;
  $("#share-btn").onclick = shareDialog;
  $("#save-btn").onclick = saveBlueprint;
  $("#stress-btn").onclick = () => showStressTest();
  $("#deploy-btn").onclick = arenaView;
}
function rotate() {
  rotation = (rotation + 1) % 4;
  if ($("#rotate-btn"))
    $("#rotate-btn").textContent = "↻ " + rotation * 90 + "°";
  invalidateBench();
}
function undo() {
  if (history.length) {
    machine = history.pop();
    save();
    workshop();
    toast("Last change restored.");
  }
}
function showModal(title, body, bind) {
  modalCleanup?.();
  modalCleanup = null;
  if (
    document.fullscreenElement &&
    !document.fullscreenElement.contains($("#modal"))
  )
    document.fullscreenElement.append($("#modal"));
  $("#modal-content").innerHTML =
    `<div class="modal-header"><h2>${title}</h2><button data-close aria-label="Close dialog">×</button></div><div class="modal-body">${body}</div>`;
  $("#modal-content")
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = closeModal));
  if (!$("#modal").open) $("#modal").showModal();
  bind?.();
}
function closeModal() {
  modalCleanup?.();
  modalCleanup = null;
  $("#modal").close();
  if ($("#modal").parentElement !== document.body)
    document.body.append($("#modal"));
}
function savedEntries() {
  try {
    return JSON.parse(
      localStorage.getItem("wm-blueprints-v3") ||
        localStorage.getItem("wm-blueprints-v2") ||
        localStorage.getItem("wm-blueprints-v1") ||
        "[]",
    )
      .slice(0, 8)
      .map((o) => {
        try {
          return unpackChallenge(o, true);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
function savedBlueprints() {
  return savedEntries().map((e) => e.machine);
}
function blueprints() {
  const saved = savedBlueprints();
  showModal(
    "Blueprint library",
    `<p>Start with a proven chassis, then make it yours. Loading a blueprint replaces your assembly; Undo brings it back.</p><h3>Factory blueprints</h3><div class="blueprints">${PRESETS.map((m, i) => blueprintCard(m, i, "factory")).join("")}</div><h3>Your blueprints · ${saved.length}/8</h3><div class="blueprints">${saved.length ? saved.map((m, i) => blueprintCard(m, i, "saved")).join("") : "<p>No saved blueprints yet. Save your machine to keep a separate copy.</p>"}</div><div class="modal-footer"><label class="file-button">Import blueprint<input id="load-blueprint-file" type="file" accept=".json,application/json" hidden></label><button id="export-blueprint">Export blueprint</button><button id="save-library" class="primary">Save current machine</button></div>`,
    () => {
      document.querySelectorAll("[data-blueprint]").forEach(
        (b) =>
          (b.onclick = () => {
            snapshot();
            machine = clone(
              b.dataset.source === "factory"
                ? PRESETS[+b.dataset.blueprint]
                : saved[+b.dataset.blueprint],
            );
            if (!challenge && b.dataset.source === "saved") {
              const savedEntry = savedEntries()[+b.dataset.blueprint];
              rules = savedEntry.rules;
              arenaId = savedEntry.arena;
              objective = savedEntry.objective || "reactor";
              battleMode = rules.combat;
            }
            rotation = machine.front || 0;
            save();
            closeModal();
            workshop();
            toast(machine.name + " loaded.");
          }),
      );
      $("#save-library").onclick = () => {
        saveBlueprint();
        blueprints();
      };
      $("#export-blueprint").onclick = exportBlueprint;
      $("#load-blueprint-file").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          if (file.size > 128000) throw Error("Blueprint is too large.");
          const data = unpackChallenge(JSON.parse(await file.text()), true);
          snapshot();
          machine = data.machine;
          if (!challenge) {
            rules = data.rules;
            arenaId = data.arena;
            objective = data.objective || "reactor";
            seed = data.seed;
            battleMode = rules.combat;
          }
          rotation = machine.front || 0;
          save();
          closeModal();
          workshop();
          toast("Blueprint imported.");
        } catch (e) {
          toast(e.message || "Invalid blueprint.");
        }
      };
      drawThumbnails();
    },
  );
}
function blueprintCard(m, i, source) {
  return `<button class="blueprint-card" data-blueprint="${i}" data-source="${source}"><canvas width="180" height="180" data-thumb="${source}:${i}" aria-hidden="true"></canvas><span><strong>${esc(m.name)}</strong><small>${stats(m).cost} ¢ · ${m.modules.length} modules</small><span class="tag">${{ balanced: "BALANCED", kite: "LONG RANGE", ram: "BRAWLER", flank: "FLANKER" }[m.tactic]}</span></span></button>`;
}
function saveBlueprint() {
  const list = savedEntries(),
    ix = list.findIndex((e) => e.machine.name === machine.name);
  if (ix >= 0) list.splice(ix, 1);
  list.unshift({
    machine: clone(machine),
    arena: arenaId,
    objective,
    seed,
    rules: clone(rules),
  });
  try {
    localStorage.setItem(
      "wm-blueprints-v3",
      JSON.stringify(
        list
          .slice(0, 8)
          .map((e) => packChallenge(e.machine, e.arena, e.seed, e.rules, e.objective || "reactor")),
      ),
    );
    save();
    toast("Blueprint and match rules saved on this device.");
  } catch {
    toast("Storage unavailable. Export your blueprint to keep it.");
  }
}
function downloadFile(name, text) {
  const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportBlueprint() {
  downloadFile(
    machine.name.replace(/[^a-z0-9_-]/gi, "-") + ".war-machine.json",
  JSON.stringify(packChallenge(machine, arenaId, seed, rules, objective), null, 2),
  );
}
function shareDialog() {
  const issues = validate(machine, rules);
  const code = issues.length
    ? ""
    : encodeChallenge(packChallenge(machine, arenaId, seed, rules, objective));
  const link = location.origin + location.pathname + "#challenge=" + code;
  showModal(
    "Share a challenge",
    `<p>Share this link so a friend can load your machine, arena, and rules. They build a machine of their own, then both machines run the same deterministic match.</p><h3>${esc(machine.name)} · ${stats(machine).cost} credits</h3><p>${esc(ARENAS.find((a) => a.id === arenaId).name)} · seed ${seed} · Deterministic combat · front ${frontNames[machine.front || 0]}</p>${issues.length ? `<div class="notice">Finish your machine before sharing: ${esc(issues[0])}</div>` : `<label class="field"><span>Challenge link</span><textarea class="share-code" id="challenge-link" readonly>${esc(link)}</textarea></label><div class="modal-footer"><button id="test-challenge">Test this machine</button><button id="export-challenge">Export blueprint</button><button class="primary" id="copy-challenge">Copy challenge link</button></div>`}<h3>Open a challenge</h3><label class="field"><span>Paste a challenge link or code</span><textarea class="share-code" id="import-code" placeholder="Paste your friend’s challenge here…"></textarea></label><p id="import-error" class="error-message" role="alert"></p><div class="modal-footer"><label class="file-button">Import challenge file<input id="import-file" type="file" accept=".json,application/json" hidden></label><button class="primary" id="import-challenge">Open challenge</button></div><div class="notice">Challenges are asynchronous. Send the link yourself; results stay on each player’s device. Deploy the game on your own static host to share playable links. For large builds or machines on different hosts, send the exported JSON file and import it as a challenge.</div>`,
    () => {
      if (!issues.length) {
        $("#copy-challenge").onclick = async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast("Challenge link copied. Send it to your friend.");
          } catch {
            $("#challenge-link").focus();
            $("#challenge-link").select();
            toast("Select and copy the challenge link above.");
          }
        };
        $("#export-challenge").onclick = exportBlueprint;
        $("#test-challenge").onclick = () =>
          loadChallenge(decodeChallenge(code));
      }
      $("#import-challenge").onclick = () => {
        try {
          loadChallenge(decodeChallenge($("#import-code").value));
        } catch (e) {
          $("#import-error").textContent = e.message;
        }
      };
      $("#import-file").onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          if (f.size > 128000) throw Error("Blueprint file is too large.");
          loadChallenge(unpackChallenge(JSON.parse(await f.text())));
        } catch (e) {
          $("#import-error").textContent =
            e.message || "Invalid blueprint file.";
        }
      };
    },
  );
}

function leaveChallenge() {
  restoreReplay();
  bountyContext = null;
  officialReceipt = null;
  challenge = null;
  if (preChallengeRules) rules = preChallengeRules;
  preChallengeRules = null;
  battleMode = rules.combat;
  historyReplace();
  save();
  view === "arena" ? arenaView() : workshop();
}
function opponent() {
  return (
    challenge?.machine ||
    (mirrorOpponent ? clone(machine) : ENEMIES[enemyIndex].machine)
  );
}
function matchIssues() {
  return [
    ...validate(machine, rules).map((e) => "Your machine: " + e),
    ...validate(opponent(), rules).map((e) => "Other machine: " + e),
  ];
}
function loadChallenge(c) {
  if (!routeRestoring)
    return go({
      name: "challenge",
      value: encodeChallenge(
        packChallenge(c.machine, c.arena, c.seed, c.rules, c.objective || "reactor"),
      ),
    });
  restoreReplay();
  bountyContext = null;
  officialReceipt = null;
  if (!challenge) preChallengeRules = clone(rules);
  challenge = c;
  rules = clone(c.rules);
  battleMode = rules.combat;
  arenaId = c.arena;
  objective = c.objective || "reactor";
  seed = c.seed;
  mirrorOpponent = false;
  closeModal();
  arenaView();
  toast(
    "Challenge loaded. Opponent, arena, seed, combat mode, and limits are locked.",
  );
}
function arenaView() {
  theaterFallback = false;
  battleFocusView = false;
  if (!routeRestoring && !challenge) return go({ name: "arena" });
  cleanupView();
  document.body.classList.toggle("official-replay", !!officialReceipt);
  view = "arena";
  setNav();
  Object.assign(fightCamera, newCamera(true));
  const enemy = opponent(),
    meta = mirrorOpponent
      ? {
          rank: "MIRROR",
          hint: "An exact copy of your current machine under your chosen rules. Test a build at any size.",
        }
      : ENEMIES[enemyIndex],
    arena = ARENAS.find((a) => a.id === arenaId);
  app.innerHTML = `<div class="page-heading"><div><span class="eyebrow">ARENA / COMBAT TEST</span><h1>RUN THE TEST.</h1><p>Watch the fight. Read the report. Refine the build.</p></div><div class="heading-actions"><button id="return-workshop">← Workshop</button><button id="scout-rival">◎ View opponent</button><button id="arena-share">↗ Challenge a friend</button></div></div>${challenge ? `<div class="arena-challenge">${officialReceipt ? "VERIFIED TRIAL" : bountyContext ? bountyContext.attemptId ? "BOUNTY BUILD WINDOW" : "LOCAL SIMULATION" : "FRIEND CHALLENGE"} · ${esc(enemy.name)} · ${stats(enemy).cost} credits <button id="leave-challenge">Leave challenge</button></div>` : ""}
 <div class="match-rules-banner"><strong>${challenge ? "LOCKED CHALLENGE RULES" : "MATCH RULES"}</strong><span>${esc(rulesLabel(rules))} · Deterministic combat</span></div><div class="arena-layout"><aside class="panel opponents-panel"><div class="panel-head"><h3>Practice opponents</h3><small>${Object.keys(wins).length}/${ENEMIES.length} WINS</small></div><button id="mirror-rival" class="mirror-rival ${mirrorOpponent ? "active" : ""}" ${challenge ? "disabled" : ""}><strong>◈ Mirror my build</strong><small>Exact copy · always matches your limits</small></button><div class="opponent-list">${ENEMIES.map((e, i) => `<button class="opponent ${!challenge && !mirrorOpponent && i === enemyIndex ? "active" : ""}" data-enemy="${i}" ${challenge ? "disabled" : ""}><canvas class="opponent-preview" width="160" height="160" data-thumb="factory:${i}" aria-hidden="true"></canvas><span><strong>${e.name}</strong><small>${e.rank} · ${stats(e.machine).cost} ¢</small></span>${wins[i] ? '<span class="win" title="Defeated">◆</span>' : ""}</button>`).join("")}</div></aside>
 <div class="arena-main"><section class="panel arena-top"><div><small>${arena.label.toUpperCase()}</small><h2>${arena.name}</h2><p>${arena.desc}</p></div><div class="arena-controls"><select id="arena-select" aria-label="Arena" ${challenge ? "disabled" : ""}>${ARENAS.map((a) => `<option value="${a.id}" ${a.id === arenaId ? "selected" : ""}>${a.name}</option>`).join("")}</select><button id="seed-btn" ${challenge ? "disabled" : ""} title="New battle seed">⟳ Seed</button></div></section>
<section class="combat-stage" id="combat-stage"><div class="arena-screen"><canvas id="arena-canvas" width="1200" height="800" tabindex="0" aria-label="Deterministic battle arena. Drag to orbit, pinch to zoom. Tap a part to inspect its condition."></canvas>
 <div id="damage-labels" class="damage-labels" aria-hidden="true"></div><div class="fight-hud"><div class="fighter-hud"><strong>${esc(machine.name)}</strong><div class="meter"><i id="your-hp" style="width:100%"></i></div><small id="your-systems">YOUR MACHINE · ${stats(machine).cost} ¢</small><div class="resource-meters"><span title="Heat"><i id="your-heat"></i></span><span title="Energy"><i id="your-energy"></i></span></div></div><div class="timer"><span id="fight-time">1:40</span><small id="fight-state">STANDBY</small></div><div class="fighter-hud"><strong>${esc(enemy.name)}</strong><div class="meter"><i id="enemy-hp" style="width:100%"></i></div><small id="enemy-systems">OPPONENT MACHINE · ${stats(enemy).cost} ¢</small><div class="resource-meters"><span title="Heat"><i id="enemy-heat"></i></span><span title="Energy"><i id="enemy-energy"></i></span></div></div></div>
 <div class="arena-corner"><span id="terrain-label">ROAD</span><span id="reactor-label">REACTOR NEUTRAL</span></div><div class="minimap-wrap"><canvas id="minimap" width="240" height="160" aria-label="Arena overview. Machine positions and objectives."></canvas><small>TACTICAL MAP</small></div>
 <div class="fight-overlay briefing-overlay" id="fight-overlay"><div class="match-card"><small>${challenge ? "FRIEND CHALLENGE" : meta.rank + " PRACTICE MATCH"}</small><h2>${esc(enemy.name)}</h2><p>${esc(challenge ? "Build your machine to the same rules, then watch both machines fight." : meta.hint)}</p><div class="engineering-contract"><span class="auto-indicator"></span><div><strong>MACHINES FIGHT AUTOMATICALLY</strong><small>They use the movement, target and damage settings from the workshop.</small></div></div><aside class="meta-battle-notice"><strong>BATTLE DATA NOTICE</strong><span>When completed, this match contributes machine builds, outcome, weapon, damage, heat, power, arena, and engine data to the public daily Meta report. Raw logs are kept for 7 days; reports omit names and wallet addresses.</span><a href="#meta">View the data &amp; daily reports →</a></aside><button class="primary" id="start-battle">Start simulation ↗</button><p class="mode-note">UP TO 100 SECONDS · SAME SEED, SAME RESULT</p></div></div>
 </div><div class="arena-camera-bar"><div class="camera-follow"><span>CAMERA</span><select id="camera-follow" aria-label="Camera follow"><option value="both">Frame both</option><option value="you">Follow you</option><option value="rival">Follow opponent</option><option value="free">Free camera</option></select></div><div class="group"><button data-fight-camera="left" aria-label="Orbit left">↶</button><button data-fight-camera="right" aria-label="Orbit right">↷</button><button data-fight-camera="fit">⌖ Fit</button><button data-fight-camera="in" aria-label="Zoom in">+</button><button data-fight-camera="out" aria-label="Zoom out">−</button><button id="focus-view-btn" type="button" aria-pressed="false" aria-label="Hide bottom battle controls and tactical map" title="Hide bottom controls and tactical map">Hide HUD</button><button id="theater-btn" type="button" title="Fullscreen arena" aria-label="Enter fullscreen arena">⛶</button></div></div>
 <div class="observation-deck"><div class="observation-heading"><span class="auto-indicator"></span><strong id="observation-status">SYSTEM STATUS</strong><span id="observation-hint">Behavior locked when the match starts</span></div><div class="weapons-monitor" id="weapons-monitor"></div><div class="system-readout" id="system-readout"></div></div>
 <div class="panel battle-toolbar"><div class="group"><button id="pause-btn" disabled>Ⅱ Pause</button><button id="replay-btn" disabled>↻ Replay</button><button id="inspect-btn">◎ Damage</button></div><div class="group"><span class="mode-note">SPEED</span>${[0.5, 1, 2, 4].map((s) => `<button data-speed="${s}" class="${speed === s ? "active" : ""}">${s}×</button>`).join("")}</div></div></section>
 <div class="combat-log"><section class="panel"><h3>Combat log <small id="seed-label">SEED ${seed}</small></h3><div class="log-lines" id="combat-log">Ready for deployment.</div></section><section class="panel arena-legend"><h3>Arena rules</h3><p><b>Central ring:</b> hold for 3s to gain +8 energy/sec while present. <b>Green caches:</b> restore 100 HP and 30 energy; respawn after 25s.</p><p>Destroy cover to open a firing lane. At 55s the containment field closes.</p></section></div></div></div><div class="battle-bottom"><button id="tune-btn">← Back to workshop</button><button id="import-btn">Load a challenge</button></div><div class="footer-note"><span>SPACE PAUSE · TAP PART TO INSPECT</span><span>DRAG ORBIT · RIGHT DRAG PAN · SCROLL / PINCH ZOOM</span></div>`;
  $("#arena-select")?.insertAdjacentHTML("afterend", `<select id="objective-select" aria-label="Match objective" ${challenge ? "disabled" : ""}>${OBJECTIVES.map((o) => `<option value="${o.id}" ${o.id === objective ? "selected" : ""}>${o.name}</option>`).join("")}</select>`);
  if (objective === "escort") {
    const legend = $(".arena-legend");
    if (legend) legend.querySelector("h3").textContent = "Escort the convoy";
    if (legend) legend.querySelector("p").innerHTML = "<b>Convoy:</b> keep your cargo close, deny the opponent access, and escort it to the far extraction gate. Progress decides ties at the time limit.";
  }
  battle = new Battle(machine, enemy, arenaId, seed, {
    mode: battleMode,
    swapSpawns: !!bountyContext && !!(seed & 1),
    objective,
  });
  $(".arena-screen")?.insertAdjacentHTML("afterbegin", '<div id="machine-warning" class="machine-warning" hidden></div>');
  lastArenaRender = 0;
  bindArena();
  drawThumbnails();
  drawArena();
  updateHUD();
  startArenaIdle();
  renderContractContext();
  renderTerrainKey(arena);
  window.scrollTo(0, 0);
}
function bindArena() {
  $("#scout-rival").onclick = scoutRival;
  $("#mirror-rival").onclick = () => {
    mirrorOpponent = true;
    arenaView();
  };
  $$("[data-enemy]").forEach(
    (b) =>
      (b.onclick = () => {
        enemyIndex = +b.dataset.enemy;
        mirrorOpponent = false;
        arenaView();
      }),
  );
  $("#return-workshop").onclick = workshop;
  $("#tune-btn").onclick = workshop;
  $("#arena-share").onclick = shareDialog;
  $("#import-btn").onclick = shareDialog;
  if ($("#leave-challenge")) $("#leave-challenge").onclick = leaveChallenge;
  $("#arena-select").onchange = (e) => {
    arenaId = e.target.value;
    save();
    arenaView();
  };
  $("#objective-select").onchange = (e) => {
    objective = e.target.value === "escort" ? "escort" : "reactor";
    save();
    arenaView();
  };
  $("#seed-btn").onclick = () => {
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
    save();
    arenaView();
  };
  $("#start-battle").onclick = () => {
    enterArenaTheater();
    startBattle(false);
  };
  $("#pause-btn").onclick = togglePause;
  $("#replay-btn").onclick = () => {
    enterArenaTheater();
    startBattle(true);
  };
  $("#inspect-btn").onclick = () => {
    inspectMode = !inspectMode;
    $("#inspect-btn").classList.toggle("active", inspectMode);
    drawArena();
  };
  $$("[data-speed]").forEach(
    (b) =>
      (b.onclick = () => {
        speed = +b.dataset.speed;
        $$("[data-speed]").forEach((t) =>
          t.classList.toggle("active", t === b),
        );
      }),
  );
  const issues = matchIssues();
  $("#start-battle").disabled = !!issues.length;
  if (issues.length)
    $(".match-card p").textContent =
      issues[0] +
      (issues[0].startsWith("Other machine:")
        ? " Choose Mirror my build, another opponent, or change the rules."
        : " Return to the workshop to finish your machine.");
  $("#camera-follow").onchange = (e) => {
    fightCamera.follow = e.target.value;
    fightCamera.anchor = null;
    fightCamera.panX = fightCamera.panZ = 0;
    drawArena();
  };
  $$("[data-fight-camera]").forEach(
    (b) =>
      (b.onclick = () => {
        const action = b.dataset.fightCamera;
        if (action === "fit") Object.assign(fightCamera, newCamera(true));
        if (action === "left") fightCamera.yaw -= Math.PI / 6;
        if (action === "right") fightCamera.yaw += Math.PI / 6;
        if (action === "in")
          fightCamera.zoom = Math.min(2.8, fightCamera.zoom * 1.15);
        if (action === "out")
          fightCamera.zoom = Math.max(0.45, fightCamera.zoom / 1.15);
        $("#camera-follow").value = fightCamera.follow;
        drawArena();
      }),
  );
  $("#focus-view-btn").onclick = () => setBattleFocusView(!battleFocusView);
  $("#theater-btn").onclick = toggleArenaTheater;
  syncArenaTheater();
  bindCamera($("#arena-canvas"), fightCamera, {
    change: () => {
      $("#camera-follow").value = fightCamera.follow;
      drawArena();
    },
    tap: arenaTap,
  });
}

function syncArenaTheater() {
  const stage = $("#combat-stage");
  if (!stage) return;
  const active = document.fullscreenElement === stage || theaterFallback;
  stage.classList.toggle("theater", active);
  const button = $("#theater-btn");
  if (button) {
    button.textContent = active ? "↙" : "⛶";
    button.title = active ? "Exit fullscreen arena" : "Fullscreen arena";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(active));
  }
}

function enterArenaTheater() {
  const stage = $("#combat-stage");
  if (!stage) return;
  theaterFallback = true;
  syncArenaTheater();
  if (typeof stage.requestFullscreen !== "function") return;
  try {
    const request = stage.requestFullscreen();
    Promise.resolve(request).then(() => {
      theaterFallback = false;
      syncArenaTheater();
      drawArena();
    }).catch(() => {
      theaterFallback = true;
      syncArenaTheater();
      drawArena();
    });
  } catch {
    theaterFallback = true;
    syncArenaTheater();
  }
}

async function toggleArenaTheater() {
  const stage = $("#combat-stage");
  if (!stage) return;
  if (document.fullscreenElement === stage) {
    try { await document.exitFullscreen(); } catch { /* Keep the current theater view. */ }
    return;
  }
  if (theaterFallback) {
    theaterFallback = false;
    syncArenaTheater();
    drawArena();
    return;
  }
  enterArenaTheater();
}

function setBattleFocusView(enabled) {
  battleFocusView = !!enabled;
  const stage = $("#combat-stage"), button = $("#focus-view-btn");
  if (!stage || !button) return;
  stage.classList.toggle("focus-view", battleFocusView);
  button.textContent = battleFocusView ? "Show HUD" : "Hide HUD";
  button.title = battleFocusView ? "Show bottom controls and tactical map" : "Hide bottom controls and tactical map";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(battleFocusView));
  drawArena();
}

function arenaTap(e) {
  if (!arenaRenderer || !battle) return;
  let nearest = null;
  for (const v of battle.vehicles)
    for (const m of battle.active(v)) {
      const p = world(v, m),
        screen = arenaRenderer.project([
          (p.x - 600) / CELL,
          p.h / CELL + 1,
          (p.y - 400) / CELL,
        ]),
        distance = Math.hypot(screen.x - e.clientX, screen.y - e.clientY);
      if (distance < 27 && (!nearest || distance < nearest.distance))
        nearest = { v, m, distance };
    }
  if (nearest) {
    const { v, m } = nearest;
    toast(
      v.name +
        " · " +
        BY_ID[m.id].name +
        " · " +
        Math.round(m.hp) +
        " / " +
        partSpec(m).hp +
        " HP" +
        (partSpec(m).rate ? " · " + battle.weaponStatus(v, m) : ""),
    );
  }
}
function startBattle(replay = false) {
  if (battleCountdownTimer) return;
  if (officialReceipt) replay = true;
  if (!replay) {
    const issues = matchIssues();
    if (issues.length) {
      toast(issues[0]);
      return;
    }
    matchSource = {
      a: clone(machine),
      b: clone(opponent()),
      arena: arenaId,
      objective,
      seed,
      enemy: challenge || mirrorOpponent ? null : enemyIndex,
      mode: battleMode,
      rules: clone(rules),
      commands: null,
      swapSpawns: !!bountyContext && !!(seed & 1),
    };
  }
  if (!matchSource) return;
  const startButton = $("#start-battle");
  if (startButton) startButton.disabled = true;
  runBattleCountdown(() => launchBattle(replay));
}
function runBattleCountdown(onComplete) {
  const overlay = $("#fight-overlay"),
    screen = $(".arena-screen");
  if (!overlay || !screen) {
    onComplete();
    return;
  }
  const run = ++battleCountdownRun,
    beats = [
      ["3", 520],
      ["2", 440],
      ["1", 360],
      ["FIGHT!", 760],
    ];
  let beatIndex = 0;
  overlay.classList.remove("briefing-overlay");
  overlay.classList.add("countdown-overlay");
  overlay.hidden = false;
  screen.classList.add("countdown-active");
  const advance = () => {
    if (run !== battleCountdownRun || view !== "arena") return;
    const beat = beats[beatIndex];
    if (!beat) {
      battleCountdownTimer = 0;
      screen.classList.remove("countdown-active");
      overlay.classList.remove("countdown-overlay");
      overlay.hidden = true;
      onComplete();
      return;
    }
    const [label, frequency] = beat;
    overlay.innerHTML = `<div class="countdown-card" role="status" aria-live="assertive" aria-atomic="true"><small>COMBAT SYSTEMS · ARMED</small><strong class="countdown-number" data-beat="${label}">${label}</strong><span>${label === "FIGHT!" ? "ENGAGE" : "PREPARE FOR DEPLOYMENT"}</span></div>`;
    beep(frequency, label === "FIGHT!" ? 0.34 : 0.2, label === "FIGHT!" ? 0.09 : 0.055, "triangle");
    beatIndex++;
    battleCountdownTimer = window.setTimeout(advance, reducedMotion ? 520 : beat[0] === "FIGHT!" ? 760 : 720);
  };
  advance();
}
function launchBattle(replay = false) {
  if (!matchSource || view !== "arena") return;
  cancelAnimationFrame(raf);
  battle = new Battle(
    matchSource.a,
    matchSource.b,
    matchSource.arena,
    matchSource.seed,
    {
      mode: matchSource.mode,
      swapSpawns: !!matchSource.swapSpawns,
      objective: matchSource.objective || "reactor",
      observeEvents: true,
      ...(replay ? { commands: matchSource.commands || [] } : {}),
    },
  );
  running = true;
  paused = false;
  lastFrame = 0;
  lastArenaRender = 0;
  accumulator = 0;
  lastLogCount = 0;
  audioDirector.reset();
  musicDirector.hold("battle-paused", false);
  syncMusic({ restart: true });
  $("#fight-overlay").hidden = true;
  $("#pause-btn").disabled = false;
  $("#pause-btn").textContent = "Ⅱ Pause";
  $("#replay-btn").disabled = true;
  $("#arena-select").disabled = true;
  $("#seed-btn").disabled = true;
  $$("[data-enemy]").forEach((b) => (b.disabled = true));
  $("#mirror-rival").disabled = true;
  $("#arena-canvas").focus({ preventScroll: true });
  raf = requestAnimationFrame(frame);
}
function togglePause() {
  if (!running) return;
  paused = !paused;
  musicDirector.hold("battle-paused", paused);
  $("#pause-btn").textContent = paused ? "▶ Resume" : "Ⅱ Pause";
  lastFrame = 0;
  accumulator = 0;
  updateHUD();
}

function startArenaIdle() {
  cancelAnimationFrame(arenaIdleRAF);
  let prior = 0;
  const loop = (t) => {
    if (view !== "arena" || running) return;
    if (t - prior > 65) {
      drawArena();
      prior = t;
    }
    arenaIdleRAF = requestAnimationFrame(loop);
  };
  arenaIdleRAF = requestAnimationFrame(loop);
}
let hudTime = 0;
function frame(t) {
  if (!running || view !== "arena") return;
  try {
    if (document.hidden) {
      audioDirector.clear({ stale: true });
      lastFrame = t;
      raf = requestAnimationFrame(frame);
      return;
    }
    if (!lastFrame) lastFrame = t;
    const delta = Math.min((t - lastFrame) / 1000, 0.12);
    lastFrame = t;
    if (!paused) {
      accumulator += delta * speed;
      let steps = 0;
      const stepStart = performance.now();
      while (accumulator >= DT && steps++ < 32 && !battle.result && (steps === 1 || performance.now() - stepStart < 6)) {
        battle.step();
        accumulator -= DT;
      }
    }
    if (battle.result) {
      if (!battle.fault) drawArena();
      finishBattle();
      return;
    }
    syncBattleSound();
    if (!lastArenaRender || t - lastArenaRender >= 1000 / graphicsProfile.renderHz) {
      drawArena();
      lastArenaRender = t;
    }
    if (t - hudTime > 90) {
      updateHUD();
      hudTime = t;
    }
    raf = requestAnimationFrame(frame);
  } catch {
    battle?.stopForSimulationFault?.();
    running = false;
    paused = false;
    cancelAnimationFrame(raf);
    try {
      if (battle?.result || battle?.fault) finishBattle();
    } catch {
      const overlay = $("#fight-overlay");
      if (overlay) {
        overlay.hidden = false;
        overlay.innerHTML = `<div class="match-card"><small>${battle?.fault ? "SIMULATION SAFETY STOP" : "RESULT DISPLAY RECOVERY"}</small><h2>${battle?.fault ? "SIMULATION STOPPED." : "BATTLE ENDED."}</h2><p>${battle?.fault ? "The match stopped safely and no result was recorded." : "The simulation result is available; the display recovered safely."}</p><button class="primary" id="sim-fault-workshop">Refit machine</button></div>`;
        $("#sim-fault-workshop").onclick = workshop;
      }
    }
  }
}
function updateHUD() {
  if (!battle || !$("#your-hp")) return;
  for (const [i, id] of ["your", "enemy"].entries()) {
    const v = battle.vehicles[i],
      core = v.modules.find((m) => m.id === "core");
    const meterRoot = $("#" + id + "-heat")?.closest(".resource-meters");
    if (meterRoot && !meterRoot.querySelector(".resource-meter")) {
      meterRoot.innerHTML =
        '<div class="resource-meter heat-meter"><span>HEAT</span><div><i id="' + id + '-heat"></i></div><b id="' + id + '-heat-value">0°</b></div>' +
        '<div class="resource-meter power-meter"><span>POWER</span><div><i id="' + id + '-energy"></i></div><b id="' + id + '-energy-value">0</b></div>';
    }
    $("#" + id + "-hp").style.width = Math.max(0, battle.health(v) * 100) + "%";
    $("#" + id + "-systems").textContent = v.dead
      ? "CORE LOST"
      : v.coreLost
        ? `CORE DESTROYED · POWER ROUTING DAMAGED · ${Math.round(v.heat)}° · ${Math.round(v.energy)} PWR`
      : `${Math.round(core.hp)} CORE · ${Math.round(v.heat)}° · ${Math.round(v.energy)} PWR${v.disabled > 0 ? " · EMP" : v.overheated ? " · OVERHEAT" : v.coolingDown ? " · COOLING" : v.chill > 0 ? " · FROZEN" : ""}`;
    const heatRatio = v.heat / HEAT_LIMIT,
      powerRatio = v.energy / Math.max(1, v.maxEnergy),
      heatMeter = $("#" + id + "-heat")?.closest(".resource-meter"),
      powerMeter = $("#" + id + "-energy")?.closest(".resource-meter");
    $("#" + id + "-heat").style.width = Math.min(100, heatRatio * 100) + "%";
    $("#" + id + "-energy").style.width = Math.min(100, powerRatio * 100) + "%";
    $("#" + id + "-heat-value") && ($( "#" + id + "-heat-value").textContent = Math.round(v.heat) + "°");
    $("#" + id + "-energy-value") && ($( "#" + id + "-energy-value").textContent = Math.round(v.energy));
    heatMeter?.classList.toggle("caution", v.heat >= HEAT_CAUTION && v.heat < HEAT_DANGER);
    heatMeter?.classList.toggle("danger", v.heat >= HEAT_DANGER && v.heat < HEAT_LIMIT);
    heatMeter?.classList.toggle("critical", v.heat >= HEAT_LIMIT);
    powerMeter?.classList.toggle("caution", powerRatio <= POWER_CAUTION && powerRatio > POWER_CRITICAL);
    powerMeter?.classList.toggle("critical", powerRatio <= POWER_CRITICAL);
  }
  const secs = Math.max(0, Math.ceil(100 - battle.time));
  $("#fight-time").textContent =
    Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
  $("#fight-state").textContent = battle.result
    ? "FINISHED"
    : !running
      ? "STANDBY"
      : paused
        ? "PAUSED"
        : battle.replaying
          ? "REPLAY"
          : battle.time < 2
            ? "ARMING"
            : battle.time > 55
              ? "FIELD CLOSING"
              : "LIVE";
  const v = battle.vehicles[0];
  const warning = $("#machine-warning");
  if (warning) {
    const unstable = v.modules.some((m) => partSpec(m).explosive && m.hp > 0 && (m.instability || 0) >= .55);
    const powerRatio = v.energy / Math.max(1, v.maxEnergy);
    const state = v.dead
      ? "CORE LOST"
      : v.disabled > 0
        ? "EMP DISABLED"
        : v.overheated
          ? "WEAPONS OVERHEATED · COOLING REQUIRED"
          : v.coolingDown
            ? "THERMAL RETREAT · FIRE PAUSED"
            : v.heat >= HEAT_DANGER
            ? "OVERHEAT IMMINENT · OUTPUT REDUCED"
            : unstable
              ? "BATTERY INSTABILITY"
              : powerRatio <= POWER_CRITICAL
                ? "BROWNOUT · WEAPONS WAITING"
                : powerRatio <= POWER_CAUTION
                  ? "POWER LIMITED · OUTPUT REDUCED"
                  : "";
    warning.hidden = !state;
    warning.textContent = state;
    warning.className = "machine-warning" + (v.disabled > 0 ? " emp" : v.overheated || v.coolingDown || v.heat >= HEAT_DANGER ? " heat" : powerRatio <= POWER_CAUTION ? " power" : unstable ? " battery" : "");
  }
  battle.uiTrace ||= [];
  if (!battle.uiTrace.length || battle.time - battle.uiTrace.at(-1).t >= .25) {
    battle.uiTrace.push({ t: battle.time, heat: v.heat, energy: v.energy, maxEnergy: v.maxEnergy });
    if (battle.uiTrace.length > 420) battle.uiTrace.shift();
  }
  renderWeaponMonitor();
  $("#observation-status").textContent = battle.replaying
    ? "EXACT REPLAY"
    : paused
      ? "ANALYSIS PAUSED"
      : "SYSTEM STATUS";
  $("#observation-hint").textContent = paused
    ? "Inspect the design. Resume when ready."
    : battle.replaying
      ? "Same design, behavior, arena, and seed"
      : "Behavior locked · " + v.tactic + " · targets " + v.target;
  const powerMargin = v.s.power - v.s.energy,
    heatMargin = v.s.cooling - v.s.heat,
    powerClass = powerMargin < 0 ? "critical" : powerMargin < 8 ? "caution" : "",
    heatClass = heatMargin < 0 ? "critical" : heatMargin < 8 ? "caution" : "";
  $("#system-readout").innerHTML =
    '<span class="system-chip resource-chip ' + powerClass + '"><b>POWER HEADROOM</b><small>' + (powerMargin >= 0 ? "+" : "") + powerMargin.toFixed(1) + " /s</small></span>" +
    '<span class="system-chip resource-chip ' + heatClass + '"><b>COOLING HEADROOM</b><small>' + (heatMargin >= 0 ? "+" : "") + heatMargin.toFixed(1) + " /s</small></span>" +
    Object.entries(ABILITIES)
    .map(([id, a]) => {
      const active =
        id === "vent"
          ? v.vent > 0
          : id === "smoke"
            ? battle.smoke.some((s) => s.side === 0)
            : v[id] > 0;
      const state = !running
        ? "STANDBY"
        : active
          ? "ACTIVE"
          : battle.abilityStatus(0, id) || "READY";
      return (
        '<span class="system-chip ' +
        (active ? "active" : "") +
        '"><b>' +
        a.name +
        "</b><small>" +
        state +
        "</small></span>"
      );
    })
    .join("");
  $("#terrain-label").textContent = v.terrain.toUpperCase();
  $("#terrain-label").title = TERRAIN_INFO[v.terrain]?.effect || "";
  $("#reactor-label").textContent =
    battle.objective === "escort"
      ? `ESCORT YOU ${Math.round((battle.escort?.[0]?.progress || 0) * 100)}% · OPPONENT ${Math.round((battle.escort?.[1]?.progress || 0) * 100)}%`
      : battle.node.owner < 0
        ? "REACTOR NEUTRAL"
        : battle.node.owner === 0
          ? "REACTOR +8 PWR"
          : "OPPONENT CONTROLS REACTOR";
  if (lastLogCount !== battle.events.length || battle.tick % 60 < 6) {
    $("#combat-log").innerHTML = battle.events
      .slice(-6)
      .map(
        (e) =>
          `<div><span>${e.t.toFixed(1).padStart(5, "0")}</span> ${e.side === 0 ? "YOU · " : e.side === 1 ? "OPPONENT · " : ""}${esc(e.text)}</div>`,
      )
      .join("");
    lastLogCount = battle.events.length;
  }
  drawMinimap();
}
function drawArena() {
  const canvas = $("#arena-canvas");
  if (!canvas || !battle) return;
  try {
    arenaRenderer ||= new Renderer(canvas, { maxPixelRatio: graphicsProfile.maxPixelRatio });
    const vehicles =
        fightCamera.follow === "you"
          ? [battle.vehicles[0]]
          : fightCamera.follow === "rival"
            ? [battle.vehicles[1]]
            : battle.vehicles,
      points = vehicles.flatMap((v) =>
        [-1, 1].map((sign) => ({
          x: (v.x - 600 + sign * v.radius) / CELL + 4,
          y: (v.y - 400 + sign * v.radius) / CELL + 4,
          z: v.s.height - 1,
        })),
      ),
      fit = fittedSpan(
        { modules: points },
        canvas.clientWidth / Math.max(1, canvas.clientHeight),
        fightCamera.yaw,
        fightCamera.elevation,
      );
    let target = fit.center,
      span = Math.max(12, fit.span);
    if (fightCamera.follow === "free") {
      fightCamera.anchor ||= fightCamera.current
        ? [fightCamera.current.x, fightCamera.current.y, fightCamera.current.z]
        : target;
      target = [
        fightCamera.anchor[0] + fightCamera.panX,
        fightCamera.anchor[1],
        fightCamera.anchor[2] + fightCamera.panZ,
      ];
      span = fightCamera.freeSpan || span;
      fightCamera.freeSpan = span;
    } else {
      fightCamera.anchor = null;
      fightCamera.freeSpan = null;
      target = [
        target[0] + fightCamera.panX,
        target[1],
        target[2] + fightCamera.panZ,
      ];
    }
    const previous = fightCamera.current;
    fightCamera.current = previous
      ? {
          x: previous.x + (target[0] - previous.x) * 0.12,
          y: previous.y + (target[1] - previous.y) * 0.12,
          z: previous.z + (target[2] - previous.z) * 0.12,
          span: previous.span + (span - previous.span) * 0.1,
        }
      : { x: target[0], y: target[1], z: target[2], span };
    const c = fightCamera.current;
    arenaRenderer.render(
      battleScene(battle, {
        inspect: inspectMode,
        reuse: true,
        quality: graphicsProfile,
      }),
      {
      target: [c.x, c.y, c.z],
      yaw: fightCamera.yaw,
      elevation: fightCamera.elevation,
      span: c.span / fightCamera.zoom,
      bg: [0.065, 0.084, 0.1, 1],
      },
    );
    drawDamageLabels();
  } catch (e) {
    renderError(canvas, e);
  }
}
function drawMinimap() {
  const canvas = $("#minimap");
  if (!canvas || !battle) return;
  const c = canvas.getContext("2d"),
    sx = canvas.width / WIDTH,
    sy = canvas.height / HEIGHT;
  c.fillStyle = "#17272de8";
  c.fillRect(0, 0, canvas.width, canvas.height);
  for (const t of battle.arena.terrain) {
    c.fillStyle = {
      lava: "#ae623b",
      vent: "#84603d",
      ice: "#7598a6",
      mud: "#55513d",
      oil: "#334c52",
      ridge: "#987456",
      sand: "#8a7c5a",
      coolant: "#59aa86",
      rubble: "#978066",
    }[t.type];
    c.fillRect(t.x * sx, t.y * sy, t.w * sx, t.h * sy);
  }
  for (const b of battle.obstacles()) {
    c.fillStyle = "#9aa9a7";
    c.fillRect(b.x * sx, b.y * sy, b.w * sx, b.h * sy);
  }
  c.strokeStyle =
    battle.node.owner === 0
      ? "#76dfc6"
      : battle.node.owner === 1
        ? "#df9b80"
        : "#b8b597";
  c.beginPath();
  c.arc(120, 80, 18, 0, Math.PI * 2);
  c.stroke();
  if (battle.objective === "escort") {
    for (const cargo of battle.escort || []) {
      c.fillStyle = cargo.side ? "#df9b80" : "#76dfc6";
      c.fillRect(cargo.x * sx - 4, cargo.y * sy - 4, 8, 8);
      c.strokeStyle = c.fillStyle;
      c.strokeRect((cargo.side ? 150 : 150) * sx, cargo.y * sy - 2, 900 * sx, 4);
      c.fillStyle = "#f5d27b";
      c.fillRect((cargo.side ? 1050 - cargo.progress * 900 : 150 + cargo.progress * 900) * sx - 2, cargo.y * sy - 2, 4, 4);
    }
  }
  for (const p of battle.pickups) {
    if (battle.time < p.ready) continue;
    c.fillStyle = "#a6e7b2";
    c.fillRect(p.x * sx - 3, p.y * sy - 3, 6, 6);
  }
  for (const v of battle.vehicles) {
    c.fillStyle = v.side ? "#f3a085" : "#73ead4";
    c.beginPath();
    c.arc(v.x * sx, v.y * sy, v.dead ? 3 : 5, 0, Math.PI * 2);
    c.fill();
    if (!v.dead) {
      const a = v.a + ((v.front || 0) * Math.PI) / 2 - Math.PI / 2;
      c.strokeStyle = c.fillStyle;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(v.x * sx, v.y * sy);
      c.lineTo(v.x * sx + Math.cos(a) * 12, v.y * sy + Math.sin(a) * 12);
      c.stroke();
      c.lineWidth = 1;
    }
    if (v.side === 0 && v.waypoint) {
      c.strokeStyle = "#73ead4";
      c.beginPath();
      c.moveTo(v.x * sx, v.y * sy);
      c.lineTo(v.waypoint.x * sx, v.waypoint.y * sy);
      c.stroke();
    }
  }
  if (battle.time > 55) {
    c.strokeStyle = "#eba15d";
    c.beginPath();
    c.arc(120, 80, battle.ring * sx, 0, Math.PI * 2);
    c.stroke();
  }
}
function finishBattle() {
  running = false;
  paused = false;
  if (!battle.replaying) matchSource.commands = clone(battle.commands);
  if (!battle.replaying && !officialReceipt && !battle.fault && matchSource) {
    const kind = bountyContext
      ? bountyContext.friendly === true
        ? "browser-friendly"
        : "browser-challenge"
      : "browser-practice";
    try {
      const challenger = packChallenge(matchSource.a, matchSource.arena, matchSource.seed, matchSource.rules, matchSource.objective),
        defender = packChallenge(matchSource.b, matchSource.arena, matchSource.seed, matchSource.rules, matchSource.objective);
      fetch("/api/meta/battles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          clientBattleId: crypto.randomUUID(), kind, engineHash: CLIENT_ENGINE_HASH,
          challenger, defender, seed: matchSource.seed, mode: matchSource.mode,
          swapSpawns: !!matchSource.swapSpawns, objective: matchSource.objective || "reactor",
          commands: matchSource.commands || [],
        }),
      }).catch(() => {});
    } catch {}
  }
  updateHUD();
  $("#pause-btn").disabled = true;
  $("#replay-btn").disabled = false;
  $("#arena-select").disabled = !!challenge;
  $("#objective-select").disabled = !!challenge;
  $("#seed-btn").disabled = !!challenge;
  $$("[data-enemy]").forEach((b) => (b.disabled = !!challenge));
  $("#mirror-rival").disabled = !!challenge;
  const r = battle.result,
    won = r.winner === 0,
    draw = r.winner < 0,
    v = battle.vehicles[0];
  syncMusic({ restart: true });
  if (won && !battle.replaying && matchSource.enemy !== null) {
    wins[matchSource.enemy] = true;
    try {
      localStorage.setItem("wm-wins-v2", JSON.stringify(wins));
    } catch {}
  }
  const advice = battle.fault
    ? "The simulation detected an invalid state and stopped safely. No result was recorded."
    : battleAdvice(battle).notes[0];
  const overlay = $("#fight-overlay");
  overlay.classList.remove("briefing-overlay");
  overlay.hidden = false;
  overlay.innerHTML = `<div class="match-card"><small>${officialReceipt ? "PAID REPLAY · " : ""}${esc(r.reason.toUpperCase())}</small><h2 style="color:${won ? "var(--gold)" : draw ? "var(--text)" : "var(--red)"}">${battle.fault ? "SIMULATION STOPPED." : won ? "VICTORY." : draw ? "STALEMATE." : "OUTENGINEERED."}</h2><div class="result-grid"><div><strong>${r.time.toFixed(1)}s</strong><small>BATTLE TIME</small></div><div><strong>${r.damage[0]}</strong><small>DAMAGE</small></div><div><strong>${v.intercepts}</strong><small>INTERCEPTIONS</small></div></div><p>${esc(advice)}</p><p class="hint">Deterministic trial · ${v.pickups} caches · ${v.detached} part${v.detached === 1 ? "" : "s"} collapsed</p><div class="modal-footer"><button id="battle-report-btn">Battle report</button><button id="watch-replay">↻ Exact replay</button><button class="primary" id="result-tune">Refit machine</button></div><div class="result-extras"><button id="fight-again">${officialReceipt ? "Continue to result" : "Fight again"}</button><button id="inspect-wreck">Inspect wreckage</button></div></div>`;
  $("#battle-report-btn").onclick = showBattleReportEnhanced;
  $("#watch-replay").onclick = () => startBattle(true);
  $("#result-tune").onclick = workshop;
  $("#fight-again").onclick = () =>
    officialReceipt && officialAttemptId
      ? bountyUI.attempt(officialAttemptId)
      : officialReceipt
        ? bountyUI.open(bountyContext.id)
        : startBattle(false);
  if (officialReceipt && officialAttemptId) {
    officialRedirectTimer = window.setTimeout(() => {
      officialRedirectTimer = 0;
      bountyUI.attempt(officialAttemptId);
    }, 1400);
  }
  $("#inspect-wreck").onclick = () => {
    overlay.hidden = true;
    inspectMode = true;
    $("#inspect-btn").classList.add("active");
    drawArena();
  };
  if (battle.fault) {
    for (const id of ["battle-report-btn", "watch-replay", "inspect-wreck"]) {
      const button = $("#" + id);
      if (button) button.disabled = true;
    }
  }
  $("#fight-state").textContent = battle.fault ? "SIM STOPPED" : won ? "VICTORY" : draw ? "DRAW" : "DEFEAT";
  startArenaIdle();
}
function renderEngineering() {
  const node = $("#engineering-report"),
    summary = $("#engineering-summary");
  if (!node) return;
  const notes = engineeringReport(machine, rules, arenaId),
    errors = notes.filter((n) => n.level === "error").length,
    warnings = notes.filter((n) => n.level === "warn").length,
    plural = (n, word) => n + " " + word + (n === 1 ? "" : "s"),
    headline = errors
      ? [
          plural(errors, "required fix"),
          warnings ? plural(warnings, "tuning note") : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : warnings
        ? plural(warnings, "tuning note")
        : "Ready for a trial",
    detail = errors
      ? "Open the report and resolve the required items before testing."
      : warnings
        ? "Open findings to jump to the parts that improve this build."
        : "Systems, structure, and selected terrain look sound.";
  if (summary)
    summary.innerHTML = `<span class="report-pulse ${errors ? "urgent" : warnings ? "caution" : "ready"}"></span><span><b>${headline}</b><small>${detail}</small></span>`;
  const count = $("#engineering-count");
  if (count)
    count.textContent = errors
      ? plural(errors, "required fix")
      : warnings
        ? plural(warnings, "tuning note")
        : "All clear";
  const disclosure = $("#engineering-disclosure");
  if (errors && disclosure) disclosure.open = true;
  const renderNote = (n) => {
      const state =
          n.level === "good"
            ? "READY"
            : n.level === "error"
              ? "REQUIRED"
              : "TUNE",
        icon = n.level === "good" ? "✓" : n.level === "error" ? "!" : "↗",
        action =
          n.level === "good"
            ? "Review parts"
            : "Browse " + n.category.toLowerCase();
      return `<button class="engineering-note ${n.level}" data-engineering-category="${n.category}"><span class="engineering-icon" aria-hidden="true">${icon}</span><span class="engineering-copy"><span class="engineering-note-meta"><b>${esc(n.category)}</b><i>${state}</i></span><strong>${esc(n.text)}</strong><small>${action} <em>→</em></small></span></button>`;
    },
    ordered = [
      ...notes.filter((n) => n.level === "error"),
      ...notes.filter((n) => n.level !== "error"),
    ],
    visibleCount = Math.min(ordered.length, errors ? Math.max(2, errors) : 2),
    visibleNotes = ordered.slice(0, visibleCount),
    moreNotes = ordered.slice(visibleCount);
  node.innerHTML = `${visibleNotes.map(renderNote).join("")}${moreNotes.length ? `<details class="engineering-more"><summary>Show ${moreNotes.length} more ${moreNotes.length === 1 ? "finding" : "findings"}</summary><div>${moreNotes.map(renderNote).join("")}</div></details>` : ""}`;
  $$("[data-engineering-category]").forEach(
    (b) =>
      (b.onclick = () => {
        category = b.dataset.engineeringCategory;
        $$("[data-category]").forEach((t) =>
          t.classList.toggle("active", t.dataset.category === category),
        );
        renderParts();
        $(".parts-panel").scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }),
  );
}
function renderWeaponMonitor() {
  const node = $("#weapons-monitor");
  if (!node || !battle) return;
  const v = battle.vehicles[0],
    groups = new Map();
  for (const m of v.modules) {
    if (!BY_ID[m.id].rate && !BY_ID[m.id].ram) continue;
    const status = battle.weaponStatus(v, m),
      key = m.id + ":" + status,
      g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { id: m.id, status, count: 1 });
  }
  node.innerHTML = [...groups.values()]
    .map(
      (g) =>
        `<span class="weapon-state ${["LOW POWER", "OVERHEAT", "OUT OF ARC", "DESTROYED"].includes(g.status) ? "warning" : ""}"><b>${esc(BY_ID[g.id].name)}${g.count > 1 ? " ×" + g.count : ""}</b><small>${g.status}</small></span>`,
    )
    .join("");
  $$(".weapon-state").forEach((el) => {
    const status = el.querySelector("small")?.textContent || "";
    el.classList.toggle(
      "warning",
      ["LOW POWER", "POWER LIMITED", "OVERHEAT", "OVERHEAT RISK", "HEAT LIMITED", "OUT OF ARC", "DESTROYED"].includes(status),
    );
  });
}
function drawDamageLabels() {
  const node = $("#damage-labels"),
    canvas = $("#arena-canvas");
  if (!node || !canvas || !arenaRenderer) return;
  const box = canvas.getBoundingClientRect(),
    placed = [];
  node.innerHTML = battle.damageLabels
    .map((e) => {
      const p = arenaRenderer.project([
        (e.x - 600) / CELL,
        e.h / CELL + (1 - e.life / 0.75) * 0.8,
        (e.y - 400) / CELL,
      ]);
      let x = p.x - box.left,
        y = p.y - box.top;
      while (
        placed.some((q) => Math.abs(q.x - x) < 36 && Math.abs(q.y - y) < 17)
      )
        y -= 18;
      placed.push({ x, y });
      if (x < 8 || y < 45 || x > box.width - 8 || y > box.height - 12)
        return "";
      return `<span class="damage-number ${e.side ? "enemy" : "own"}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;opacity:${Math.min(1, e.life / 0.2)}">−${Math.round(e.amount)}</span>`;
    })
    .join("");
}
function scoutRival() {
  if (running && !paused) togglePause();
  const rival = opponent(),
    s = stats(rival),
    composition = new Map();
  for (const m of rival.modules)
    composition.set(m.id, (composition.get(m.id) || 0) + 1);
  const camera = newCamera();
  showModal(
    "Opponent details",
    `<div class="scout-grid"><div><canvas id="scout-canvas" width="640" height="520" aria-label="Other machine preview. Drag to orbit, pinch or scroll to zoom."></canvas><p class="hint">Drag to orbit · pinch to zoom · front ${frontNames[rival.front || 0]}</p></div><div><span class="eyebrow">${challenge ? "FRIEND CHALLENGE" : "SELECTED OPPONENT"}</span><h2>${esc(rival.name)}</h2><p>${s.cost} credits · ${s.mass} t · ${s.parts} parts · ${s.height} levels</p><p>${esc(rival.tactic)} behavior · ${rival.range} m range · targets ${esc(rival.target)}</p><div class="scout-parts">${[...composition].map(([id, n]) => `<span><b>${n}×</b> ${esc(BY_ID[id].name)}</span>`).join("")}</div></div></div><div class="scout-notes">${engineeringReport(
      rival,
      rules,
      arenaId,
    )
      .filter((n) => n.level === "warn")
      .slice(0, 3)
      .map((n) => `<p>◎ ${esc(n.text)}</p>`)
      .join(
        "",
      )}</div><div class="modal-footer"><button data-close>Close preview</button><button class="primary" id="scout-refit">Build your machine</button></div>`,
    () => {
      const canvas = $("#scout-canvas");
      scoutRenderer = new Renderer(canvas, { maxPixelRatio: graphicsProfile.maxPixelRatio });
      const draw = () => {
        if (!scoutRenderer || !canvas.isConnected) return;
        const fit = fittedSpan(
          rival,
          canvas.clientWidth / Math.max(1, canvas.clientHeight),
          camera.yaw,
          camera.elevation,
        );
        scoutRenderer.render(
          workshopScene(rival, {
            grid: false,
            ghost: false,
            reuse: true,
            quality: graphicsProfile,
          }),
          {
            target: [
              fit.center[0] + camera.panX,
              fit.center[1],
              fit.center[2] + camera.panZ,
            ],
            yaw: camera.yaw,
            elevation: camera.elevation,
            span: fit.span / camera.zoom,
          },
        );
      };
      bindCamera(canvas, camera, { change: draw });
      draw();
      window.addEventListener("resize", draw);
      modalCleanup = () => {
        window.removeEventListener("resize", draw);
        scoutRenderer?.dispose();
        scoutRenderer = null;
      };
      $("#scout-refit").onclick = () => {
        closeModal();
        workshop();
      };
    },
  );
}
function showBattleReport() {
  const report = battleAdvice(battle),
    v = battle.vehicles[0];
  showModal(
    "Battle engineering report",
    `<div class="report-score"><div><strong>${report.ownIntegrity}%</strong><span>YOUR INTEGRITY</span></div><div><strong>${report.enemyIntegrity}%</strong><span>OPPONENT INTEGRITY</span></div><div><strong>${v.shots} / ${v.hits}</strong><span>SHOTS / IMPACTS</span></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Weapon</th><th>Fitted / left</th><th>Shots</th><th>Damage</th></tr></thead><tbody>${report.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.count} / ${r.alive}</td><td>${r.shots}</td><td>${Math.round(r.damage)}</td></tr>`).join("")}</tbody></table></div><p class="hint">Weapon damage includes its direct, splash, and chain hits to enemy parts; shield absorption and secondary reactor explosions are separate. Piercing shots can produce multiple impacts.</p><div class="report-advice">${report.notes.map((n) => `<p>↗ ${esc(n)}</p>`).join("")}</div><div class="modal-footer"><button data-close>Back to result</button><button class="primary" id="report-refit">Refit with this in mind</button></div>`,
    () => {
      $("#report-refit").onclick = () => {
        closeModal();
        workshop();
      };
    },
  );
}
function showStressTest() {
  let cancelled = false;
  const progress = (completed, total, arena = "Preparing") => {
    const fill = $("#stress-progress-fill"), label = $("#stress-progress-label"), count = $("#stress-progress-count");
    if (fill) fill.style.width = `${Math.round((completed / Math.max(1, total)) * 100)}%`;
    if (label) label.textContent = completed ? `Testing ${arena}` : "Preparing deterministic tests";
    if (count) count.textContent = `${completed} of ${total} runs`;
  };
  showModal("Build stress test", `<p>Running two fixed seeds across every arena. The test yields between battles so the page stays responsive. Results are local and never touch a bounty or wallet.</p><div class="stress-progress" role="status" aria-live="polite"><div class="stress-progress-head"><strong id="stress-progress-label">Preparing deterministic tests</strong><span id="stress-progress-count">0 of 0 runs</span></div><div class="stress-progress-track"><i id="stress-progress-fill"></i></div><button id="stress-cancel">Stop test</button></div>`, () => {
    const stop = $("#stress-cancel");
    if (stop) stop.onclick = () => { cancelled = true; stop.disabled = true; stop.textContent = "Stopping…"; };
    modalCleanup = () => { cancelled = true; };
    void (async () => {
      try {
        const result = await stressTestAsync(machine, opponent(), "all", seed, { objective, onProgress: ({ completed, total, arena }) => progress(completed, total, arena), shouldCancel: () => cancelled });
        if (cancelled || result.cancelled) {
          if ($("#stress-progress-label")) $("#stress-progress-label").textContent = "Test stopped";
          if ($("#stress-cancel")) { $("#stress-cancel").textContent = "Close"; $("#stress-cancel").disabled = false; $("#stress-cancel").onclick = closeModal; }
          return;
        }
        const s = result.summary, bar = (value, max = 1) => `<span class="metric-bar"><i style="width:${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(1)}%"></i></span>`;
        showModal("Build stress test", `<p>Completed ${result.runs.length} deterministic runs across ${result.terrainScores.length} arenas. Use the spread to find builds that only work on one surface.</p><div class="report-score"><div><strong>${Math.round(s.averageSurvival)}s</strong><span>AVERAGE SURVIVAL</span></div><div><strong>${Math.round(s.winRate * 100)}%</strong><span>WIN RATE</span></div><div><strong>${s.averageOverheats.toFixed(1)}</strong><span>OVERHEATS / RUN</span></div></div><div class="stress-grid"><section><h3>Terrain spread</h3>${result.terrainScores.map(t => `<div class="stress-row"><b>${esc(t.name)}</b><span>${Math.round(t.winRate * 100)}% wins · ${Math.round(t.time)}s</span>${bar(t.winRate)}</div>`).join("")}</section><section><h3>Failure pressure</h3><p><b>Most dangerous weapon:</b> ${result.dangerousWeapon ? `${esc(result.dangerousWeapon.name)} · ${Math.round(result.dangerousWeapon.damage / Math.max(1, result.dangerousWeapon.runs))} damage/run` : "none recorded"}</p><p><b>Average mobility loss:</b> ${s.averageMobilityLoss.toFixed(1)}s</p><p><b>Best terrain:</b> ${result.bestTerrain ? esc(result.bestTerrain.name) : "—"}</p><p><b>Worst terrain:</b> ${result.worstTerrain ? esc(result.worstTerrain.name) : "—"}</p></section></div><h3>Average damage by weapon</h3><div class="report-bars">${result.damagePerWeapon.slice(0, 8).map(r => `<div class="stress-row"><b>${esc(r.name)}</b><span>${Math.round(r.damage)}</span>${bar(r.damage, Math.max(1, result.damagePerWeapon[0]?.damage || 1))}</div>`).join("") || '<p class="hint">No weapon impacts recorded.</p>'}</div><div class="modal-footer"><button data-close>Close report</button><button class="primary" id="stress-deploy">Open the arena</button></div>`, () => { $("#stress-deploy").onclick = () => { closeModal(); arenaView(); }; });
      } catch (error) {
        if (!cancelled) showModal("Build stress test", `<p class="error-message">${esc(error.message || "Stress test failed.")}</p><div class="modal-footer"><button data-close>Close</button><button class="primary" id="stress-retry">Try again</button></div>`, () => { $("#stress-retry").onclick = () => { closeModal(); showStressTest(); }; });
      }
    })();
  });
}
function jumpReplay(target) {
  if (!matchSource) return;
  cancelAnimationFrame(raf);
  battle = new Battle(matchSource.a, matchSource.b, matchSource.arena, matchSource.seed, { mode: matchSource.mode, swapSpawns: !!matchSource.swapSpawns, commands: matchSource.commands || [], observeEvents: true });
  audioDirector.reset();
  while (!battle.result && battle.time + DT / 2 < target) battle.step();
  running = false;
  paused = true;
  musicDirector.hold("battle-paused", true);
  $("#fight-overlay").hidden = true;
  closeModal();
  updateHUD();
  drawArena();
  toast("Replay positioned at " + battle.time.toFixed(1) + "s. Press Replay to continue the exact run.");
}
function showBattleReportEnhancedBase() {
  const report = battleAdvice(battle), summary = combatSummary(battle), v = battle.vehicles[0];
  const formula = "35% core · 25% structure · 15% weapons · 15% mobility · 10% power/cooling";
  const timeline = summary.timeline.filter(e => e.kind !== "status").slice(-18);
  const failures = Object.entries(summary.failures).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  showModal("Battle engineering report", `<div class="report-score"><div><strong>${report.ownIntegrity}%</strong><span>YOUR INTEGRITY</span></div><div><strong>${report.enemyIntegrity}%</strong><span>OPPONENT INTEGRITY</span></div><div><strong>${v.shots} / ${v.hits}</strong><span>SHOTS / IMPACTS</span></div></div><div class="report-callout"><b>Published timeout scoring</b><span>${formula}</span><strong>Your weighted score: ${Math.round(report.score * 100)}%</strong></div><div class="report-grid"><section><h3>Why weapons waited</h3>${failures.map(([key, value]) => `<div class="stress-row"><b>${esc(failureLabel(key))}</b><span>${key === "heat" || key === "power" ? value.toFixed(1) + "s" : Math.round(value) + " events"}</span></div>`).join("") || '<p class="hint">No firing failures recorded.</p>'}</section><section><h3>Resource trace</h3><div class="trace-stat"><span>Peak heat</span><b>${Math.round(v.peakHeat || v.heat)}°</b></div><div class="trace-stat"><span>Final energy</span><b>${Math.round(v.energy)} / ${Math.round(v.maxEnergy)}</b></div><div class="trace-stat"><span>Mobility impaired</span><b>${summary.mobilityLossTime.toFixed(1)}s</b></div></section></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Weapon</th><th>Fitted / left</th><th>Shots</th><th>Damage</th><th>Waits</th></tr></thead><tbody>${report.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.count} / ${r.alive}</td><td>${r.shots}</td><td>${Math.round(r.damage)}</td><td>${Math.round(r.powerWait + r.heatWait)}s</td></tr>`).join("")}</tbody></table></div><h3>Replay timeline</h3><div class="replay-timeline">${timeline.map(e => `<button data-jump-time="${e.t}"><b>${e.t.toFixed(1)}s</b><span>${esc(e.text)}</span></button>`).join("") || '<p class="hint">No milestone events recorded.</p>'}</div><div class="report-advice">${report.notes.map((n) => `<p>↗ ${esc(n)}</p>`).join("")}</div><div class="modal-footer"><button data-close>Back to result</button><button class="primary" id="report-refit">Refit with this in mind</button></div>`, () => { $("#report-refit").onclick = () => { closeModal(); workshop(); }; $$('[data-jump-time]').forEach(b => b.onclick = () => jumpReplay(+b.dataset.jumpTime)); });
}
function showBattleReportEnhanced() {
  showBattleReportEnhancedBase();
  queueMicrotask(() => {
    if (!battle) return;
    const trace = battle.uiTrace || [], maxHeat = Math.max(1, ...trace.map(p => p.heat)), maxEnergy = Math.max(1, ...trace.map(p => p.maxEnergy));
    const chart = (key, max, color) => trace.slice(-90).map(p => `<i style="height:${Math.max(2, Math.min(100, (p[key] / max) * 100)).toFixed(1)}%;background:${color}" title="${p.t.toFixed(1)}s · ${Math.round(p[key])}"></i>`).join("");
    $(".report-grid")?.insertAdjacentHTML("afterend", `<div class="trace-charts"><section><h3>Heat trace</h3><div class="trace-bars">${chart("heat", maxHeat, "#e49b62")}</div><small>Peak ${Math.round(maxHeat)}° · weapons lock at 100°</small></section><section><h3>Power trace</h3><div class="trace-bars">${chart("energy", maxEnergy, "#73c6b2")}</div><small>Reserve ${Math.round(trace.at(-1)?.energy || battle.vehicles[0].energy)} / ${Math.round(maxEnergy)}</small></section></div>`);
    const destroyed = combatSummary(battle).destroyed.slice(-12);
    $(".replay-timeline")?.insertAdjacentHTML("beforebegin", `<section class="destroyed-report"><h3>What disabled each part</h3>${destroyed.length ? `<div class="replay-timeline">${destroyed.map(e => `<div><b>${e.time.toFixed(1)}s</b><span>${esc(e.text)}</span><small>Cause: ${esc(e.cause)}</small></div>`).join("")}</div>` : '<p class="hint">No parts were destroyed in this run.</p>'}</section>`);
  });
}
function syncMusic({ restart = false } = {}) {
  let cue = "general";
  if (view === "arena" && running) cue = "battle";
  else if (view === "arena" && battle?.result?.winner === 0) cue = "victory";
  else if (view === "arena" && battle?.result?.winner === 1) cue = "defeat";
  void musicDirector.play(cue, { restart });
}
async function initAudio() {
  const musicReadyPromise = musicDirector.resumeFromGesture();
  const effectsReady = await audioDirector.resumeFromGesture();
  const musicReady = await musicReadyPromise;
  audioCtx = effectsReady ? audioDirector.context : null;
  return effectsReady || musicReady;
}
function beep(hz, duration, volume, type = "sine") {
  if (!sound || !audioCtx) return;
  try {
    const o = audioCtx.createOscillator(),
      g = audioCtx.createGain(),
      now = audioCtx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, hz), now);
    o.frequency.exponentialRampToValueAtTime(
      Math.max(20, hz * 0.3),
      now + duration,
    );
    g.gain.setValueAtTime(Math.max(0.0001, volume), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(now);
    o.stop(now + duration);
  } catch {
    // Browsers can close an AudioContext when a tab is suspended.
  }
}
function soundReady(kind, cooldown = 0.08) {
  if (!sound || !audioCtx) return false;
  const now = performance.now(), previous = soundCooldowns.get(kind) || 0;
  if (now - previous < cooldown * 1000) return false;
  soundCooldowns.set(kind, now);
  return true;
}
function noise(duration = 0.08, volume = 0.025, cutoff = 1800) {
  if (!sound || !audioCtx) return;
  try {
    const length = Math.max(1, Math.floor(audioCtx.sampleRate * duration)),
      buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate),
      data = buffer.getChannelData(0),
      source = audioCtx.createBufferSource(),
      filter = audioCtx.createBiquadFilter(),
      gain = audioCtx.createGain(),
      now = audioCtx.currentTime;
    for (let i = 0; i < length; i++) {
      const envelope = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, now);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    source.start(now);
    source.stop(now + duration);
  } catch {
    // Sound is optional; a failed effect must never interrupt a match.
  }
}
function playBattleSfx(kind, intensity = 1) {
  const level = clamp(Number(intensity) || 1, 0.5, 2);
  switch (kind) {
    case "fire":
      if (soundReady("fire", 0.055)) {
        beep(150 + level * 70, 0.055, 0.028, "square");
        noise(0.045, 0.016, 2600);
      }
      break;
    case "laser":
      if (soundReady("laser", 0.07)) beep(620 + level * 120, 0.11, 0.024, "sine");
      break;
    case "impact":
      if (soundReady("impact", 0.045)) {
        beep(95, 0.09, 0.032, "triangle");
        noise(0.07, 0.022, 900);
      }
      break;
    case "explosion":
      if (soundReady("explosion", 0.13)) {
        beep(78, 0.26, 0.055, "sawtooth");
        noise(0.24, 0.045, 1200);
      }
      break;
    case "intercept":
      if (soundReady("intercept", 0.1)) {
        beep(980, 0.07, 0.026, "square");
        window.setTimeout(() => beep(1380, 0.06, 0.02, "square"), 45);
      }
      break;
    case "emp":
      if (soundReady("emp", 0.16)) beep(210, 0.24, 0.034, "sine");
      break;
    case "shield":
      if (soundReady("shield", 0.08)) beep(460, 0.12, 0.024, "triangle");
      break;
    case "vent":
      if (soundReady("vent", 0.2)) {
        noise(0.32, 0.028, 2300);
        beep(280, 0.18, 0.018, "sine");
      }
      break;
    case "warning":
      if (soundReady("warning", 0.7)) {
        beep(310, 0.12, 0.03, "square");
        window.setTimeout(() => beep(230, 0.14, 0.025, "square"), 135);
      }
      break;
    case "overheat":
      if (soundReady("overheat", 0.8)) {
        beep(440, 0.13, 0.035, "square");
        window.setTimeout(() => beep(170, 0.22, 0.03, "sawtooth"), 145);
      }
      break;
    case "power":
      if (soundReady("power", 0.8)) beep(120, 0.2, 0.035, "sine");
      break;
    case "capture":
      if (soundReady("capture", 0.35)) beep(520, 0.18, 0.025, "triangle");
      break;
    case "win":
      if (soundReady("result", 0.5)) {
        beep(520, 0.2, 0.04, "triangle");
        window.setTimeout(() => beep(780, 0.28, 0.045, "triangle"), 120);
      }
      break;
    case "loss":
      if (soundReady("result", 0.5)) {
        beep(180, 0.22, 0.04, "triangle");
        window.setTimeout(() => beep(95, 0.35, 0.035, "sawtooth"), 150);
      }
      break;
    case "draw":
      if (soundReady("result", 0.5)) beep(260, 0.3, 0.035, "triangle");
      break;
  }
}
function playWeaponSfx(weapon, intensity = 1) {
  const id = weapon || "cannon";
  const level = clamp(Number(intensity) || 1, 0.5, 2);
  const ready = (gap) => soundReady(`weapon:${id}`, gap);
  switch (id) {
    case "machinegun":
    case "gatling":
      if (ready(id === "gatling" ? 0.045 : 0.065)) {
        beep(id === "gatling" ? 235 : 330, 0.045, 0.018, "square");
        noise(0.025, 0.01, 3200);
      }
      break;
    case "railgun":
      if (ready(0.2)) {
        beep(760, 0.16, 0.035, "sawtooth");
        noise(0.12, 0.022, 4800);
        window.setTimeout(() => beep(180, 0.2, 0.026, "sine"), 50);
      }
      break;
    case "laser":
      if (ready(0.08)) beep(820 + level * 110, 0.12, 0.026, "sine");
      break;
    case "plasma":
      if (ready(0.12)) {
        beep(180, 0.18, 0.04, "sine");
        noise(0.11, 0.015, 700);
        window.setTimeout(() => beep(80, 0.22, 0.03, "sine"), 40);
      }
      break;
    case "rocket":
    case "mortar":
      if (ready(0.18)) {
        beep(id === "mortar" ? 95 : 130, 0.2, 0.045, "sawtooth");
        noise(0.16, 0.038, 650);
      }
      break;
    case "flame":
      if (ready(0.07)) {
        noise(0.1, 0.03, 1800);
        beep(210, 0.1, 0.02, "triangle");
      }
      break;
    case "tesla":
    case "emp":
      if (ready(0.16)) {
        beep(id === "tesla" ? 360 : 210, 0.22, 0.03, "sine");
        beep(id === "tesla" ? 720 : 150, 0.11, 0.018, "triangle");
      }
      break;
    case "cryo":
      if (ready(0.14)) {
        beep(980, 0.22, 0.024, "sine");
        beep(520, 0.16, 0.018, "triangle");
      }
      break;
    case "flak":
    case "shredder":
      if (ready(0.1)) {
        beep(id === "flak" ? 170 : 420, 0.08, 0.03, "square");
        noise(0.07, 0.022, 2600);
      }
      break;
    case "mine":
      if (ready(0.22)) beep(120, 0.16, 0.024, "triangle");
      break;
    default:
      if (ready(0.055)) {
        beep(150 + level * 70, 0.055, 0.028, "square");
        noise(0.045, 0.016, 2600);
      }
      break;
  }
}
function playBattleEventSfx(event) {
  if (!event) return;
  if (event.kind === "overheat") return playBattleSfx("overheat");
  if (event.kind === "power") return playBattleSfx("power");
  if (event.kind === "battery") return playBattleSfx("emp", 1.1);
  if (event.kind === "intercept") return playBattleSfx("intercept");
  if (event.kind === "capture") return playBattleSfx("capture");
  if (event.kind === "core") return playBattleSfx("explosion", 1.4);
}
function syncBattleSound() {
  if (!battle) return;
  const events = typeof battle.combatEventsSince === "function"
    ? battle.combatEventsSince(audioDirector.lastSeq)
    : [];
  audioDirector.ingest(events);
  audioDirector.drain({ speed, hidden: document.hidden });
}
function historyReplace() {
  // Route transitions are committed by the router. This remains for legacy
  // callers that only need to clear a share hash before choosing a screen.
}
function manual() {
  showModal(
    "The machine manual",
    `<div class="manual-grid">
 <section><h3>Build in three dimensions</h3><p>Select a part and tap a socket to install it. Fitted parts are protected from accidental replacement; enable Replace parts to swap them. Build report warnings explain power, cooling, and structural weaknesses. Choose Level 1 or 2 to build upward. Every upper part needs a frame, deck, core, or armor directly underneath. Unsupported columns collapse in battle. The core, wheels, treads, and ram wedges belong on the ground.</p></section>
 <section><h3>Work within the class</h3><p>Standard class allows 1,200 credits, 32 fitted parts plus one required command core, 360 tonnes, and eight weapons. Use Match rules for Skirmish, Heavy, or custom caps. Set a custom cap to zero for no limit. Unlimited removes all four caps. The physical 9×9×3 grid and support rules still apply. Friend challenges lock the same rules and combat mode for both builds. Mirror sparring copies your build, so it fits any class. Upper mounts cost 12 credits per level. Reinforcing adds 35% health, 25% mass, and 30% cost. Overclocking adds 20% weapon or system output, 35% cost, and reduces health 15%. Weapons also produce 30% more heat. The first two copies of a weapon retain normal reload. Each extra matching gun adds 18% reload time from shared fire-control bandwidth. The Build report gives the exact multiplier.</p></section>
 <section><h3>Make it yours</h3><p>Choose a hull, accent, light color, livery, and unit number. The Front selector marks your fighting nose with a lit chevron and headlights; this side faces the opponent in battle. “Turn mounts too” rotates your installed guns and mobility with the new front. Uncheck it to preserve individual firing arcs. Paint mode colors individual parts. Inspect a fitted part to rotate, upgrade, or recolor it. Build mode selects existing parts by default; enable Replace parts when you want to swap equipment. Mirror mode installs or removes matching chassis positions. Use Exploded view to understand a stack, or hide upper levels to work underneath.</p></section>
 <section><h3>Control the camera</h3><p>Drag to orbit and tilt. Scroll or pinch to zoom. Right-drag, Shift-drag, or two-finger drag to pan. Fit restores the view. In battle, follow your machine, follow the opponent, frame both, or explore freely. The fullscreen button gives the arena more room.</p></section>
 <section><h3>Engineer the behavior</h3><p>Choose movement style, preferred range, target priority, and damage response in the workshop. Both machines run those instructions automatically. Pause, inspect, replay, and compare weapon performance to improve the next revision. Camera and playback controls never change the outcome.</p></section>
 <section><h3>Automatic systems</h3><p>Boost trades 25 energy and 12 heat for speed. Coolant purge spends 20 energy to remove 45 heat but locks guns for 1.2 seconds. Brace spends 30 energy for 45% damage reduction and slower movement for three seconds. Smoke needs a Veil launcher and 20 energy; it breaks missile tracking and worsens enemy accuracy for five seconds. Both machines trigger these systems when their sensors detect high heat, incoming damage, or a distant target. Each needs power and has a cooldown. An Afterburner improves automatic boost.</p></section>
 <section><h3>Experimental arsenal</h3><p>Prism lasers hit instantly. Helios plasma bypasses half of armor. Breach sabots ignore 72% of the struck part’s armor resistance, but cannot splash or pass through it and run hot. Storm coils chain through three nearby parts. Rupture scatterguns fire six pellets; Cyclone gatlings spin up during sustained fire. Frost lances slow targets and lower their heat. Widow minelayers drop armed traps behind your marked front, up to three live mines per launcher. Ceramic plating resists thermal weapons; blast cages resist explosives. Fusion reactors power hungry builds but explode when destroyed. Majority-hover builds float above damaging surfaces and ignore poor traction, but still absorb ambient heat.</p></section><section><h3>Layer your defenses</h3><p>Reactive armor reduces the first hit of 35 or more damage by 75%, on top of its armor. Fortress bulkheads reduce damage 52%. Sentinels intercept rockets and mortars for eight energy per shot. Shields recharge after a break in damage; repairs restore damaged connected parts. Batteries can explode into neighboring parts across levels.</p></section>
 <section><h3>Height changes the fight</h3><p>Shots travel through three-dimensional space. Elevated guns can shoot over low obstacles and ground armor. Towers are exposed and reduce steering stability. Mortars arc over cover and explode on impact. Damage to a support can bring every part above it down.</p></section>
 <section><h3>Use the ground</h3><p>Sand and mud slow wheels; treads retain most of their traction. Ice cools systems but reduces grip. Oil also reduces grip. Furnace vents erupt for four seconds in every twelve, starting at eight seconds. Lava and active vents damage parts and add heat. Redline Ridge has raised firing positions. Coolant channels increase cooling by 70% but slow wheels; rubble cuts wheel speed by 35%. Treads preserve most speed on both. Raised terrain also blocks low shots crossing the ridge. Most cover can be destroyed.</p></section>
 <section><h3>Fight for resources</h3><p>Occupy the central ring alone for three seconds to gain eight energy per second. Leave it and you lose control. Green caches restore up to 100 HP across surviving parts and 30 energy, then respawn after 25 seconds. At 55 seconds the containment field starts closing. At 100 seconds the higher percentage of surviving integrity wins; within 2.5 points is a draw.</p></section>
 <section><h3>Test and replay</h3><p>Every match runs automatically from the saved behavior and seed. Exact replay repeats that same experiment. Playback speed and camera movement only change how you watch. Tap a part to inspect it. Weapon status explains reloads, firing arcs, and shortages; Battle report shows damage contribution and refit advice. View the other machine before building your own. Older live-command links still import as automatic matches.</p></section>
 <section><h3>Keep and share your machines</h3><p>Your build autosaves on this device. Save up to eight named blueprints or export JSON files. Previous blueprint files still import. Challenge links contain all parts, layers, upgrades, colors, front direction, arena, seed, and match rules. Host the static game anywhere you choose. Your friend needs access to your host; for large builds or another host, exchange JSON challenge files. Sandbox battles stay on each player’s device. Bounty links use your game server and keep authoritative results there.</p></section><section><h3>Tempo bounties</h3><p>Connect the Tempo wallet that will fund, enter or receive a reward. Creating and entering a bounty each send one transaction that batches the pathUSD approval and direct escrow call. Use local simulations to iterate before paying an entry. The server locks the builds, terrain and rules, then independent signers check the deterministic outcome before the escrow settles the payout. The result is recorded before the challenge can be tried again. A loss, draw, or missed build deadline sends the entry to the bounty creator; creators can close an idle bounty.</p></section></div><div class="modal-footer"><button class="primary" data-close>Back to home</button></div>`,
  );
}
function rulesView() {
  if (!routeRestoring) return go({ name: "rules" });
  restoreReplay();
  cleanupView();
  view = "rules";
  setNav();
  app.innerHTML = `<div class="page-heading rules-heading"><div><span class="eyebrow">FIELD MANUAL / COMBAT RULES</span><h1>HOW MATCHES WORK.</h1><p>Build the machine, choose its behavior, then watch the deterministic simulation resolve the fight.</p></div><div class="heading-actions"><button id="rules-workshop">Open workshop</button><button id="rules-arena" class="primary">Run a test battle</button></div></div>
  <div class="rules-page">
     <section class="panel rules-hero"><div><span class="eyebrow">THE OBJECTIVE</span><h2>Destroy the other machine’s command core.</h2><p>Every match is deterministic. Both machines use their saved parts, front direction, behavior, terrain and the same seed. No hidden player input changes the result.</p></div><div class="rules-hero-stats"><div><strong>100 s</strong><span>match clock</span></div><div><strong>60 Hz</strong><span>simulation</span></div><div><strong>2.5%</strong><span>draw margin</span></div></div></section>
    <div class="rules-jump" aria-label="Rules sections"><span>JUMP TO</span><a href="#rules-result">Result</a><a href="#rules-combat">Combat</a><a href="#rules-systems">Systems</a><a href="#rules-terrain">Terrain</a><a href="#rules-bounties">Bounties</a></div>
    <section class="rules-section panel" id="rules-result"><div class="rules-section-head"><span class="rules-index">01</span><div><span class="eyebrow">RESULT</span><h2>How a winner is decided</h2></div></div><div class="rules-section-body rules-result-grid"><div class="rule-step"><b>01</b><h3>Destroy a core</h3><p>Destroying the opponent command core immediately wins the match. If both cores are destroyed in the same exchange, the result is a draw.</p></div><div class="rule-step"><b>02</b><h3>Survive the clock</h3><p>If both cores are still alive at 100 seconds, the engine compares the percentage of starting module health each machine has left.</p></div><div class="rule-step"><b>03</b><h3>Resolve close calls</h3><p>The higher integrity wins. A difference under 2.5 percentage points is a draw. Integrity is about surviving structure, not just the core.</p></div></div></section>
     <section class="rules-section panel" id="rules-combat"><div class="rules-section-head"><span class="rules-index">02</span><div><span class="eyebrow">DETERMINISTIC COMBAT</span><h2>How machines choose their fight</h2></div></div><div class="rules-section-body rules-two-col"><div><h3>Movement style</h3><ul class="rules-list"><li><b>Balanced</b><span>Hold the configured engagement range.</span></li><li><b>Kite</b><span>Back away while keeping weapons on target.</span></li><li><b>Flank</b><span>Circle to expose weaker sides and change firing angles.</span></li><li><b>Ram</b><span>Close distance and collide at short range.</span></li></ul></div><div><h3>Target priority</h3><ul class="rules-list"><li><b>Weapons</b><span>Strip the other machine’s damage output first.</span></li><li><b>Power</b><span>Attack generators, batteries, cooling and shields.</span></li><li><b>Mobility</b><span>Break wheels, treads and hover systems.</span></li><li><b>Core or nearest</b><span>Focus the command core or the closest valid part.</span></li></ul></div><div class="rules-callout"><h3>Facing and firing arcs</h3><p>The marked front is the machine's fighting nose. Each mount has its own facing and firing arc. A weapon can be in range and still miss its opportunity if it is mounted backwards or the target is outside its arc. The engine leads moving targets and respects smoke, cover, height and projectile travel time.</p></div></div></section>
    <section class="rules-section panel" id="rules-systems"><div class="rules-section-head"><span class="rules-index">03</span><div><span class="eyebrow">POWER, HEAT AND DAMAGE</span><h2>What keeps a machine alive</h2></div></div><div class="rules-section-body rules-card-grid"><article class="rules-card"><span class="rules-card-label">HEAT</span><h3>Firepower has a limit</h3><p>Every shot adds heat. Radiators and cooling systems remove it, while hot terrain and heaters add more. At 85 heat, automatic systems enter thermal retreat: firing pauses and the machine backs away while cooling. At 100 heat, weapons shut down. They return below 35 heat. Automatic coolant purge removes 45 heat, costs 20 energy, and pauses guns for 1.2 seconds.</p></article><article class="rules-card"><span class="rules-card-label">ENERGY</span><h3>Power the machine</h3><p>Energy starts at the machine's capacity and changes every simulation tick from generators, environment drain and reactor control. Weapons, shields, repairs, interceptors and abilities spend it. Boost costs 25 energy and 12 heat; brace costs 30 energy for 45% damage reduction for 3 seconds; interceptors cost 8 energy per shot. At low power, weapons wait and support systems lose their powered benefits.</p></article><article class="rules-card"><span class="rules-card-label">DAMAGE</span><h3>Protect the right layer</h3><p>Armor, shields, thermal and blast resistance, brace systems and reactive armor reduce incoming damage. Damaged weapons reload more slowly, damaged coolers remove less heat, damaged mobility reduces speed and steering, and damaged sensors shorten range and spread aim. Batteries can surge before failure, briefly draining energy and adding heat; destroyed batteries can still explode into nearby parts.</p></article><article class="rules-card"><span class="rules-card-label">STRUCTURE</span><h3>Connections matter</h3><p>Upper parts need support below them. If a frame or deck is destroyed, unsupported parts collapse. Towers improve firing positions but are exposed and make the machine harder to turn.</p></article></div></section>
    <section class="rules-section panel" id="rules-terrain"><div class="rules-section-head"><span class="rules-index">04</span><div><span class="eyebrow">ARENA CONDITIONS</span><h2>Build for the ground you choose</h2></div></div><div class="rules-section-body"><p class="rules-intro">Terrain is sampled at each machine's position, so moving a few metres can change the tradeoff. Hovering avoids most contact hazards but still suffers ambient heat and cold.</p><div class="terrain-rule-grid"><div><b>Road</b><span>Normal traction and speed.</span></div><div><b>Sand and mud</b><span>Slow wheels; treads retain more speed.</span></div><div><b>Oil and ice</b><span>Reduce grip. Ice also improves cooling.</span></div><div><b>Snow</b><span>Slows wheels; winter tires help.</span></div><div><b>Brine</b><span>Drains energy over time.</span></div><div><b>Lava and vents</b><span>Add heat and damage grounded machines.</span></div><div><b>Rubble and coolant</b><span>Slow wheels; coolant increases cooling.</span></div><div><b>Ridges</b><span>Raise firing positions and block low shots.</span></div></div><div class="rules-arena-strip"><div><b>Central reactor</b><span>Hold it alone for 3 seconds to gain 8 energy per second. Leave the ring and control is lost.</span></div><div><b>Repair caches</b><span>Restore up to 100 health and 30 energy. They return after 25 seconds.</span></div><div><b>Containment field</b><span>Starts closing at 55 seconds. Machines outside take core damage as the ring contracts.</span></div></div></div></section>
    <section class="rules-section panel" id="rules-build"><div class="rules-section-head"><span class="rules-index">05</span><div><span class="eyebrow">ENGINEERING LIMITS</span><h2>Build within the class</h2></div></div><div class="rules-section-body rules-build-grid"><div><h3>Know the standard class</h3><p>The default class allows 1,200 credits, 32 fitted parts, 360 tonnes and 8 weapons. The command core is required but does not count toward the fitted-part limit. Custom and unlimited classes can change the caps.</p></div><div><h3>Choose a tradeoff</h3><p>Every fitted part has a credit cost, mass, health and system contribution. More armor adds mass. More weapons add damage but also reload pressure, energy demand and heat. Elevated mounts cost more and still need support.</p></div><div><h3>Make stacking meaningful</h3><p>The grid has three levels. Additional copies of one weapon share fire-control bandwidth and reload more slowly after the first two. A compact, supported design can outperform a taller pile of identical guns.</p></div></div></section>
    <section class="rules-section panel" id="rules-bounties"><div class="rules-section-head"><span class="rules-index">06</span><div><span class="eyebrow">PAID CHALLENGES</span><h2>How a paid challenge works</h2></div></div><div class="rules-section-body rules-bounty-flow"><div class="bounty-flow-step"><b>01</b><span>Creator funds a reward and locks the machine, arena, seed and limits.</span></div><div class="bounty-flow-step"><b>02</b><span>The player joining pays the entry and receives the full opponent plus a timed build window.</span></div><div class="bounty-flow-step"><b>03</b><span>The match runs once. The result is recorded and checked before payout.</span></div><div class="bounty-flow-step"><b>04</b><span>If the joining player wins, they receive 97.5% of the gross reward after the 2.5% platform fee. A loss, draw or missed deadline sends the entry to the creator.</span></div></div><p class="rules-footnote">Payment only handles the reward; it does not change the combat rules. Watch the full simulation in the Arena before the result is finalized.</p></section>
    <div class="rules-actions"><button id="rules-workshop-bottom" class="primary">Build a machine</button><button id="rules-arena-bottom">Run a test battle</button><button id="rules-bounties-bottom">Browse bounties</button></div>
  </div>`;
  $("#rules-result .rules-section-body")?.insertAdjacentHTML("beforeend", '<div class="rules-callout"><h3>Published timeout formula</h3><p>When both cores survive, the deterministic score is <b>35% core survival + 25% structure + 15% weapons + 15% mobility + 10% power and cooling</b>. The higher score wins; a gap under 2.5 points is a draw. This prevents cheap armor walls from winning by raw hit points alone.</p></div>');
  $("#rules-terrain .rules-arena-strip")?.insertAdjacentHTML("beforeend", '<div><b>Escort convoy</b><span>Choose this objective in Proving grounds. Keep your cargo near your machine, stop the opponent from contesting it, and reach the far gate. Cargo progress breaks time-limit ties.</span></div>');
  const timeoutStep = $("#rules-result .rule-step:nth-child(2) p");
  if (timeoutStep) timeoutStep.textContent = "If both cores are still alive at 100 seconds, the engine compares the published weighted timeout score: core, structure, weapons, mobility, and power/cooling.";
  const closeStep = $("#rules-result .rule-step:nth-child(3) p");
  if (closeStep) closeStep.textContent = "The higher weighted score wins. A difference under 2.5 percentage points is a draw. Raw armor alone cannot decide the result.";
  $("#rules-workshop").onclick = workshop;
  $("#rules-arena").onclick = arenaView;
  $("#rules-workshop-bottom").onclick = workshop;
  $("#rules-arena-bottom").onclick = arenaView;
  $("#rules-bounties-bottom").onclick = () => bountyUI.open();
  window.scrollTo(0, 0);
}
$("#modal").addEventListener("close", () => {
  modalCleanup?.();
  modalCleanup = null;
  if ($("#modal").parentElement !== document.body)
    document.body.append($("#modal"));
});
function restoreReplay() {
  if (!replayRestore) return;
  ({
    machine,
    challenge,
    rules,
    arenaId,
    objective,
    seed,
    bountyContext,
    officialAttemptId,
  } = replayRestore);
  replayRestore = null;
  officialReceipt = null;
  battleMode = rules.combat;
}
function prepareContract(b) {
  restoreReplay();
  officialAttemptId = null;
  if (!challenge) preChallengeRules = clone(rules);
  bountyContext = b;
  challenge = unpackChallenge(b.blueprint);
  rules = clone(challenge.rules);
  arenaId = challenge.arena;
  objective = challenge.objective || "reactor";
  seed = crypto.getRandomValues(new Uint32Array(1))[0];
  challenge.seed = seed;
  battleMode = "auto";
  mirrorOpponent = false;
}
function renderTerrainKey(arena) {
  const node = $(".arena-legend");
  if (!node) return;
  const p = document.createElement("p");
  p.className = "terrain-key";
  p.innerHTML =
    (arena.climate
      ? "<span><b>" +
        esc(arena.climate.name) +
        ":</b> " +
        esc(arena.desc) +
        "</span>"
      : "") +
    [...new Set(arena.terrain.map((t) => t.type))]
      .map(
        (t) =>
          "<span><b>" +
          esc(TERRAIN_INFO[t]?.name || t) +
          ":</b> " +
          esc(TERRAIN_INFO[t]?.effect || "") +
          "</span>",
      )
      .join("");
  node.append(p);
}
function renderContractContext() {
  if (!bountyContext) return;
  const friendly = bountyContext.friendly === true;
  clearInterval(bountyClock);
  bountyClock = 0;
  const el = document.createElement("section");
  el.className = "bounty-context";
  const paidAttempt =
    bountyContext.attemptId &&
    !officialReceipt &&
    view === "workshop" &&
    Number(bountyContext.buildDeadline || 0) > 0;
  el.innerHTML =
    "<div><strong>" +
    esc(bountyContext.title) +
    "</strong><p>" +
    (officialReceipt
      ? "Viewing a paid challenge. Replay never changes your balance."
      : view === "arena"
        ? bountyContext.attemptId
          ? "PAID BUILD WINDOW · Submit once before the deadline."
          : friendly
            ? "FRIENDLY MATCH · Free to play. No separate build or submission deadline."
            : "LOCAL TEST · No entry charge or reward. Return to the challenge to pay the entry."
        : "CHALLENGE WORKSHOP · Construction limits are locked to this bounty. Your engineering changes stay in your local draft.") +
    '</p></div><div class="bounty-actions"><button id="return-contract">← Back to ' + (friendly ? "friendly challenges" : "challenge") + '</button>' +
    (!officialReceipt
      ? '<button type="button" id="exit-bounty">× Exit to normal play</button>'
      : "") +
    (bountyContext.attemptId && !officialReceipt && view === "workshop"
      ? '<button class="primary" id="deploy-official-counter">Submit machine</button>'
      : "") +
    "</div>";
  app.prepend(el);
  if (paidAttempt) {
    const clock = document.createElement("span");
    clock.className = "bounty-clock";
    clock.id = "counter-clock";
    clock.setAttribute("role", "timer");
    clock.setAttribute("aria-live", "polite");
    el.querySelector(".bounty-actions")?.prepend(clock);
  }
  $("#return-contract").onclick = () =>
    friendly
      ? friendlyUI.open(bountyContext.id)
      : officialReceipt && officialAttemptId
      ? bountyUI.attempt(officialAttemptId)
      : bountyUI.open(bountyContext.id);
  $("#exit-bounty")?.addEventListener("click", leaveChallenge);
  if ($("#deploy-official-counter"))
    $("#deploy-official-counter").onclick = async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      try {
        await bountyUI.deploy(bountyContext.attemptId);
      } catch (error) {
        toast(error.message || "Could not submit this machine.");
      } finally {
        button.disabled = false;
      }
    };
  if (view === "arena") {
    const button = document.createElement("button");
    button.textContent = friendly ? "← Friendly" : "← Bounty";
    button.onclick = () => friendly ? friendlyUI.open(bountyContext.id) : bountyUI.open(bountyContext.id);
    $(".arena-camera-bar .group")?.append(button);
  }
  if (view === "arena" && bountyContext && !officialReceipt) {
    const small = $(".match-card>small");
    const paidAttempt = !!bountyContext.attemptId;
    if (small) small.textContent = paidAttempt ? "PAID MACHINE SUBMISSION" : friendly ? "FREE FRIENDLY MATCH" : "LOCAL CHALLENGE TEST";
    const p = $(".match-card>p");
    if (p && !matchIssues().length)
      p.textContent = paidAttempt
        ? "Submit your machine before the deadline. The verified result uses the locked seed and settles the entry."
        : friendly
          ? "No entry fee or separate build deadline. Take the time you need, then run your free match under normal arena rules."
        : "Test your machine against the fixed opponent. Local simulations do not affect a bounty.";
  }
  if (paidAttempt) {
    const deadline = Number(bountyContext.buildDeadline);
    const clock = $("#counter-clock");
    const deploy = $("#deploy-official-counter");
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (!seconds) {
        clock.textContent = "BUILD WINDOW CLOSED";
        clock.classList.add("closed");
        if (deploy) {
          deploy.disabled = true;
          deploy.textContent = "Build window closed";
        }
        clearInterval(bountyClock);
        bountyClock = 0;
        return;
      }
      clock.textContent =
        "BUILD WINDOW · " +
        Math.floor(seconds / 60) +
        ":" +
        String(seconds % 60).padStart(2, "0");
    };
    tick();
    if (deadline > Date.now()) bountyClock = setInterval(tick, 1000);
  }
}
bountyUI = createBountyUI({
  navigate: go,
  show() {
    restoreReplay();
    cleanupView();
    closeModal();
    view = "bounties";
    setNav();
  },
  getBuild: () => ({
    machine: clone(machine),
    rules: clone(rules),
    arena: arenaId,
    objective,
  }),
  thumbnail: renderThumbnail,
  toast,
  modal: showModal,
  workshop,
  edit(b) {
    prepareContract(b);
    workshop();
  },
  practice(b) {
    prepareContract(b);
    arenaView();
    startBattle(false);
  },
  scout(b) {
    prepareContract(b);
    arenaView();
    scoutRival();
  },
  replay(a, b) {
    restoreReplay();
    replayRestore = {
      machine: clone(machine),
      challenge,
      rules: clone(rules),
      arenaId,
      objective,
      seed,
      bountyContext,
      officialAttemptId,
    };
    const c = unpackChallenge(a.replay.challenger);
    machine = c.machine;
    rules = c.rules;
    challenge = unpackChallenge(a.replay.defender);
    bountyContext = b;
    arenaId = a.replay.arena;
    objective = challenge.objective || c.objective || "reactor";
    seed = a.replay.seed;
    battleMode = "auto";
    officialReceipt = a;
    officialAttemptId = a.id;
    arenaView();
    matchSource = {
      a: clone(machine),
      b: clone(challenge.machine),
      arena: arenaId,
      objective,
      seed,
      enemy: null,
      mode: "auto",
      rules: clone(rules),
      commands: [],
      swapSpawns: a.replay.swapSpawns,
    };
    startBattle(true);
  },
});
friendlyUI = createFriendlyChallengesUI({
  navigate: go,
  show() {
    restoreReplay();
    cleanupView();
    closeModal();
    bountyContext = null;
    officialReceipt = null;
    officialAttemptId = null;
    view = "friendly";
    setNav();
  },
  getBuild: () => ({
    machine: clone(machine),
    rules: clone(rules),
    arena: arenaId,
    objective,
  }),
  thumbnail: renderThumbnail,
  toast,
  modal: showModal,
  modalClose: closeModal,
  practice(b) {
    prepareContract({ ...b, friendly: true });
    bountyContext.friendly = true;
    arenaView();
    startBattle(false);
  },
});

try {
  const theme = localStorage.getItem("wm-theme");
  if (["forge", "glacier", "ember"].includes(theme))
    document.documentElement.dataset.theme = theme;
} catch {}
portal = createPortal({
  syncRoute(next) {
    if (routeRestoring) return false;
    go({ name: next });
    return true;
  },
  show(next) {
    restoreReplay();
    cleanupView();
    closeModal();
    view = next;
    setNav();
  },
  getBuild: () => ({
    machine: clone(machine),
    rules: clone(rules),
    arena: arenaId,
    objective,
  }),
  workshop,
  arena: arenaView,
  contracts: () => bountyUI.open(),
  account: () => bountyUI.profile(),
  toast,
  tryArena(id) {
    restoreReplay();
    challenge = null;
    bountyContext = null;
    officialReceipt = null;
    if (preChallengeRules) rules = preChallengeRules;
    preChallengeRules = null;
    arenaId = id;
    battleMode = "auto";
    save();
    arenaView();
  },
});
const mobileNavToggle = $("#nav-toggle");
const setMobileNav = (open) => {
  document.body.classList.toggle("nav-open", open);
  mobileNavToggle?.setAttribute("aria-expanded", String(open));
  mobileNavToggle?.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
};
mobileNavToggle?.addEventListener("click", () => {
  setMobileNav(!document.body.classList.contains("nav-open"));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".topbar")) setMobileNav(false);
});
$$("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      setMobileNav(false);
      return b.dataset.view === "workshop"
        ? workshop()
        : b.dataset.view === "friendly"
          ? friendlyUI.open()
        : b.dataset.view === "bounties"
          ? bountyUI.open()
        : b.dataset.view === "meta"
          ? metaView()
        : b.dataset.view === "rules"
            ? rulesView()
          : b.dataset.view === "agents"
            ? portal.agents()
            : arenaView();
    }),
);
$(".brand").onclick = (e) => {
  e.preventDefault();
  setMobileNav(false);
  portal.home();
};
$("#manual-btn").onclick = () => {
  if (running && !paused) togglePause();
  manual();
};
function metaView() {
  if (!routeRestoring) return go({ name: "meta" });
  restoreReplay();
  cleanupView();
  view = "meta";
  setNav();
  app.innerHTML = `<div class="page-heading meta-heading"><div><span class="eyebrow">BALANCE INTELLIGENCE / DAILY BATTLE REPORTS</span><h1>THE META.</h1><p>A transparent, date-by-date view of how real machines perform across the War Machines battlefield.</p></div><div class="meta-controls"><label for="meta-history">REPORT DATE · UTC</label><select id="meta-history" aria-label="Choose a daily battle report" disabled><option>Loading reports…</option></select><button id="meta-refresh" type="button">Refresh latest</button></div></div><section class="panel meta-disclosure"><div class="meta-disclosure-mark" aria-hidden="true">DATA</div><div><strong>Your battles power this report.</strong><p>Completed practice, friendly, challenge, and bounty battles feed these public balance reports. The analysis uses machine part layouts and upgrades, outcomes, weapon fire and hits, damage, heat, power, arena, rules, and engine release. Names and wallet addresses are not included in the report.</p><div class="meta-retention"><span><b>Daily analysis</b><i id="meta-interval">24 hours</i></span><span><b>Raw battle logs</b><i>7 days</i></span><span><b>Published reports</b><i>Up to 365 daily snapshots</i></span></div></div><small id="meta-updated" role="status" aria-live="polite">Loading the latest report…</small></section><div id="meta-content" class="meta-content" aria-live="polite"></div>`;
  const content = $("#meta-content"), status = $("#meta-updated"), refresh = $("#meta-refresh"), history = $("#meta-history");
  let requestSequence = 0, reports = [];
  const sourceLabel = (source) => ({ "server-paid": "Paid bounty", "server-practice": "Server practice", "browser-practice": "Practice", "browser-friendly": "Friendly match", "browser-challenge": "Shared challenge" }[source] || source || "Unknown source");
  const dateLabel = (timestamp) => {
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 10)} UTC` : "Unknown date";
  };
  const clockLabel = (timestamp) => new Date(timestamp).toLocaleTimeString([], { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
  const pct = (value) => `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
  const number = (value, digits = 1) => (Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
  const nameFor = (id) => BY_ID[id]?.name || id;
  const outcomesFor = (item) => item.outcomes || { side0Wins: 0, side1Wins: 0, draws: 0 };
  const percentOf = (part, whole) => whole ? Math.round(part / whole * 100) : 0;
  const meter = (value, label) => `<div class="meta-meter" role="img" aria-label="${esc(label)}"><i style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%"></i></div>`;
  const table = (headings, rows, empty = "No matches in this report.") => `<div class="meta-table-wrap"><table><thead><tr>${headings.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headings.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;

  const renderReport = (selected) => {
    const report = selected.report || {}, sample = report.sample || {}, groups = Array.isArray(report.groups) ? report.groups : [], matches = Number(sample.matches) || 0,
      builds = matches * 2, outcomes = report.outcomes || { side0Wins: 0, side1Wins: 0, draws: 0 }, outcomeTotal = (Number(outcomes.side0Wins) || 0) + (Number(outcomes.side1Wins) || 0) + (Number(outcomes.draws) || 0),
      side0Share = outcomeTotal ? (Number(outcomes.side0Wins) + Number(outcomes.draws) / 2) / outcomeTotal : 0,
      interval = Number(dataInterval) || 24;
    const rollup = () => ({ matches: 0, side0: 0, side1: 0, draws: 0, duration: 0, damage0: 0, damage1: 0, integrity0: 0, integrity1: 0, groups: 0 });
    const sources = new Map(), arenas = new Map(), engines = new Map(), weapons = new Map(), armorBands = new Map(), weaponBands = new Map();
    let resourceBuilds = 0, peakHeatTotal = 0, overheatedBuilds = 0, thermalRetreatTotal = 0, powerLimitedTotal = 0, brownoutTotal = 0;
    const addRollup = (map, key, group) => {
      let value = map.get(key);
      if (!value) map.set(key, value = rollup());
      const count = Number(group.matches) || 0, sides = outcomesFor(group), damage = group.averageDamageBySide || [], integrity = group.averageIntegrityBySide || [];
      value.matches += count; value.side0 += Number(sides.side0Wins) || 0; value.side1 += Number(sides.side1Wins) || 0; value.draws += Number(sides.draws) || 0;
      value.duration += (Number(group.averageDurationSeconds) || 0) * count; value.damage0 += (Number(damage[0]) || 0) * count; value.damage1 += (Number(damage[1]) || 0) * count;
      value.integrity0 += (Number(integrity[0]) || 0) * count; value.integrity1 += (Number(integrity[1]) || 0) * count; value.groups++;
      return value;
    };
    const addBand = (map, band) => {
      const range = String(band.range ?? "unknown");
      let value = map.get(range);
      if (!value) map.set(range, value = { range, builds: 0, wins: 0, losses: 0, draws: 0 });
      value.builds += Number(band.builds) || 0; value.wins += Number(band.wins) || 0; value.losses += Number(band.losses) || 0; value.draws += Number(band.draws) || 0;
    };
    for (const group of groups) {
      addRollup(sources, group.source || "unknown", group);
      addRollup(arenas, group.arena || "unknown", group);
      const engine = String(group.engineHash || "unknown"), currentEngine = addRollup(engines, engine, group), pressure = group.resourcePressure || {}, groupBuilds = (Number(group.matches) || 0) * 2;
      currentEngine.hash = engine;
      resourceBuilds += groupBuilds; peakHeatTotal += (Number(pressure.averagePeakHeat) || 0) * groupBuilds;
      overheatedBuilds += (Number(pressure.overheatingBuildShare) || 0) * groupBuilds;
      thermalRetreatTotal += (Number(pressure.averageThermalRetreatSeconds) || 0) * groupBuilds;
      powerLimitedTotal += (Number(pressure.averagePowerLimitedSeconds) || 0) * groupBuilds;
      brownoutTotal += (Number(pressure.brownoutsPerBuild) || 0) * groupBuilds;
      for (const band of group.armorBands || []) addBand(armorBands, band);
      for (const band of group.weaponCountBands || []) addBand(weaponBands, band);
      for (const weapon of group.weapons || []) {
        const id = String(weapon.weapon || "unknown");
        let value = weapons.get(id);
        if (!value) weapons.set(id, value = { id, builds: 0, instances: 0, wins: 0, losses: 0, draws: 0, shots: 0, hits: 0, damage: 0, heatWait: 0, powerWait: 0, destroyed: 0 });
        for (const key of ["builds", "instances", "wins", "losses", "draws", "shots", "hits", "damage", "heatWait", "powerWait", "destroyed"]) value[key] += Number(weapon[key]) || 0;
      }
    }
    const sortedBands = (map) => [...map.values()].sort((a, b) => ["0", "1–3", "4–7", "8+"].indexOf(a.range) - ["0", "1–3", "4–7", "8+"].indexOf(b.range));
    const bandRows = (map) => sortedBands(map).map((band) => {
      const share = band.builds ? (band.wins + band.draws / 2) / band.builds : 0;
      return `<tr><th>${esc(band.range)}</th><td>${band.builds}</td><td>${band.wins}</td><td>${band.losses}</td><td>${band.draws}</td><td>${pct(share)}</td></tr>`;
    }).join("");
    const summaryRows = (map) => [...map.entries()].map(([key, item]) => {
      const total = item.matches || 0, sideShare = total ? (item.side0 + item.draws / 2) / total : 0;
      return `<tr><th>${esc(key)}</th><td>${total}</td><td>${item.side0}</td><td>${item.side1}</td><td>${item.draws}</td><td>${pct(sideShare)}</td><td>${number(total ? item.duration / total : 0)}s</td><td>${number(total ? item.damage0 / total : 0)} / ${number(total ? item.damage1 / total : 0)}</td><td>${pct(total ? item.integrity0 / total : 0)} / ${pct(total ? item.integrity1 / total : 0)}</td></tr>`;
    }).join("");
    const weaponList = [...weapons.values()].sort((a, b) => b.builds - a.builds || b.damage - a.damage), weaponRows = weaponList.map((weapon) => {
      const share = weapon.builds ? (weapon.wins + weapon.draws / 2) / weapon.builds : 0, hitRate = weapon.shots ? weapon.hits / weapon.shots : null;
      return `<tr><th>${esc(nameFor(weapon.id))}</th><td>${percentOf(weapon.builds, builds)}%</td><td>${weapon.builds} / ${builds}</td><td>${pct(share)}</td><td>${hitRate == null ? "—" : pct(hitRate)}</td><td>${number(weapon.instances ? weapon.damage / weapon.instances : 0, 0)}</td><td>${number(weapon.instances ? weapon.heatWait / weapon.instances : 0)}s</td><td>${number(weapon.instances ? weapon.powerWait / weapon.instances : 0)}s</td><td>${percentOf(weapon.destroyed, weapon.instances)}%</td></tr>`;
    }).join("");
    const pressureRows = [
      ["Average peak heat", `${number(resourceBuilds ? peakHeatTotal / resourceBuilds : 0)} / 100`, "Average maximum heat reached by a build"],
      ["Builds that overheated", `${percentOf(overheatedBuilds, resourceBuilds)}%`, `${Math.round(overheatedBuilds)} of ${resourceBuilds} recorded builds`],
      ["Thermal firing retreat", `${number(resourceBuilds ? thermalRetreatTotal / resourceBuilds : 0)}s`, "Average time weapons waited for heat to recover"],
      ["Power-limited operation", `${number(resourceBuilds ? powerLimitedTotal / resourceBuilds : 0)}s`, "Average time weapons were limited by power"],
      ["Brownouts", `${number(resourceBuilds ? brownoutTotal / resourceBuilds : 0, 2)}`, "Average brownout events per build"],
    ].map(([title, value, note]) => `<article><strong>${esc(value)}</strong><span>${esc(title)}</span><small>${esc(note)}</small></article>`).join("");
    const insights = (report.insights || []).map((item) => {
      const title = item.type === "side-skew" ? "Possible starting-side advantage" : item.type === "weapon-sample" ? `${nameFor(item.weapon)} has a useful sample` : "Pattern to inspect";
      const statistic = item.type === "side-skew" ? `Side 0 scored ${pct(item.side0WinShare)} of wins and draws across ${item.sample} matches.` : item.type === "weapon-sample" ? `${pct(item.winShare)} descriptive win share across ${item.sample} weapon-equipped builds.` : "";
      return `<article><b>${esc(title)}</b><span>${esc(statistic)}</span><small>${esc(item.note || "Treat this as a lead for investigation, not a causal result.")}</small></article>`;
    }).join("");
    const detailedGroups = groups.map((group, index) => {
      const side = outcomesFor(group), pressure = group.resourcePressure || {}, groupWeapons = (group.weapons || []).map((weapon) => `<tr><th>${esc(nameFor(weapon.weapon))}</th><td>${weapon.builds}</td><td>${pct(weapon.pickShare)}</td><td>${pct(weapon.winShare)}</td><td>${weapon.hitRate == null ? "—" : pct(weapon.hitRate)}</td><td>${number(weapon.damagePerGun, 0)}</td><td>${number(weapon.heatWaitPerGunSeconds)}s</td><td>${number(weapon.powerWaitPerGunSeconds)}s</td></tr>`).join(""), ruleText = group.rules ? `${group.rules.combat || "auto"} · ${group.rules.credits ?? "custom"} credits · ${group.rules.parts ?? "custom"} parts · ${group.rules.mass ?? "custom"} t · ${group.rules.weapons ?? "custom"} weapons` : "Rules unavailable";
      return `<details class="panel meta-segment" ${index === 0 && groups.length <= 4 ? "open" : ""}><summary><span><b>${esc(sourceLabel(group.source))} · ${esc(group.arena || "unknown arena")}</b><small>${Number(group.matches) || 0} matches · ENGINE ${esc(String(group.engineHash || "unknown").slice(0, 12))}</small></span><i>${pct((Number(side.side0Wins || 0) + Number(side.draws || 0) / 2) / Math.max(1, Number(group.matches) || 0))} side-0 share</i></summary><div class="meta-segment-body"><p>${esc(ruleText)} · median ${number(group.medianDurationSeconds)}s · avg damage ${number((group.averageDamageBySide || [])[0])} / ${number((group.averageDamageBySide || [])[1])} · avg remaining integrity ${pct((group.averageIntegrityBySide || [])[0])} / ${pct((group.averageIntegrityBySide || [])[1])}</p><div class="meta-pressure-strip"><span>Peak heat <b>${number(pressure.averagePeakHeat)}</b></span><span>Overheated <b>${pct(pressure.overheatingBuildShare)}</b></span><span>Thermal wait <b>${number(pressure.averageThermalRetreatSeconds)}s</b></span><span>Power-limited <b>${number(pressure.averagePowerLimitedSeconds)}s</b></span></div>${table(["Weapon", "Builds", "Pick rate", "Win share", "Hit rate", "Damage / gun", "Heat wait / gun", "Power wait / gun"], groupWeapons, "No weapon events in this segment.")}</div></details>`;
    }).join("");
    const hashMarkup = (report.engineHashes || []).map((hash) => `<code title="${esc(hash)}">${esc(hash)}</code>`).join(" ") || "No engine hash recorded";
    const side0 = Number(outcomes.side0Wins) || 0, side1 = Number(outcomes.side1Wins) || 0, draws = Number(outcomes.draws) || 0;
    const windowStart = Number(selected.windowStart), windowEnd = Number(selected.windowEnd);
    content.innerHTML = `<section class="meta-report-banner"><div><span class="eyebrow">DAILY REPORT / ${esc(dateLabel(selected.generatedAt))}</span><h2>${matches.toLocaleString()} ${matches === 1 ? "verified battle" : "verified battles"}</h2><p>Coverage window: ${esc(Number.isFinite(windowStart) ? new Date(windowStart).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown")} — ${esc(Number.isFinite(windowEnd) ? new Date(windowEnd).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown")}. Report generated at ${esc(clockLabel(selected.generatedAt))} UTC. Daily interval: ${interval} hours.</p></div><span class="meta-report-count">${reports.length} / 365<br><small>saved daily reports</small></span></section><section class="meta-summary"><article class="panel"><strong>${matches.toLocaleString()}</strong><span>VERIFIED MATCHES</span><small>${Number(sample.analyzed) || 0} analyzed from ${Number(sample.storedInWindow) || 0} stored in this interval</small></article><article class="panel"><strong>${number(report.averageDurationSeconds)}s</strong><span>AVERAGE LENGTH</span><small>Median ${number(report.medianDurationSeconds)} seconds</small></article><article class="panel"><strong>${side0.toLocaleString()} / ${side1.toLocaleString()}</strong><span>SIDE 0 / SIDE 1 WINS</span><small>${draws.toLocaleString()} draws · side-0 share ${pct(side0Share)}</small></article><article class="panel"><strong>${(report.engineHashes || []).length}</strong><span>ENGINE RELEASES</span><small>${groups.length} source / arena / rules segments</small></article></section>${sample.truncated ? `<p class="meta-warning">This report analyzed ${Number(sample.analyzed) || 0} of ${Number(sample.storedInWindow) || 0} matches (5,000-match analysis cap). Raw battle logs are retained for seven days.</p>` : ""}<section class="meta-analysis-grid"><article class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">OUTCOME DISTRIBUTION</span><h2>Which side prevailed?</h2></div><small>Draws count as half a win in share metrics.</small></div><div class="meta-outcomes">${[["Side 0 wins", side0, side0Share], ["Side 1 wins", side1, outcomeTotal ? (side1 + draws / 2) / outcomeTotal : 0], ["Draws", draws, outcomeTotal ? draws / outcomeTotal : 0]].map(([label, count, share]) => `<div class="meta-outcome-row"><span><b>${esc(label)}</b><strong>${Number(count).toLocaleString()} · ${pct(share)}</strong></span>${meter(percentOf(count, outcomeTotal), `${label}: ${count} of ${outcomeTotal}`)}</div>`).join("")}</div><p class="meta-note">These are recorded side outcomes, not player win rates. Spawn assignment, mirrored builds, arena, engine release, and selected opponents can all affect the comparison.</p></article><article class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">THERMAL & POWER LOAD</span><h2>How hard did systems work?</h2></div><small>${resourceBuilds.toLocaleString()} build-sides sampled</small></div><div class="meta-pressure-grid">${pressureRows}</div><p class="meta-note">Wait time is time weapons could not fire because the machine needed to cool or restore power; these are aggregated per build.</p></article></section>${insights ? `<section class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">SIGNALS, NOT VERDICTS</span><h2>Patterns worth checking</h2></div><small>Small samples can swing sharply.</small></div><div class="meta-insight-grid">${insights}</div></section>` : ""}<section class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">WEAPON PERFORMANCE</span><h2>Usage, effectiveness & resource cost</h2></div><small>${builds.toLocaleString()} build-sides · ordered by most frequent use</small></div>${table(["Weapon", "Pick share", "Builds / total", "Win share", "Hit rate", "Damage / gun", "Heat wait / gun", "Power wait / gun", "Destroyed"], weaponRows, "No recorded weapon use in this daily interval.")}<p class="meta-note">Pick share is the share of build-sides using the weapon. Win share is observational and is affected by loadout quality, opponent choice, arena, and player behavior. Hit rate is landed hits divided by shots.</p></section><section class="meta-analysis-grid"><article class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">BUILD ARCHETYPES</span><h2>Armor density</h2></div><small>Part-count bands, not a causal test</small></div>${table(["Armor parts", "Builds", "Wins", "Losses", "Draws", "Win share"], bandRows(armorBands), "No armor-band data in this report.")}</article><article class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">BUILD ARCHETYPES</span><h2>Weapon count</h2></div><small>More weapons do not automatically mean more output</small></div>${table(["Weapons fitted", "Builds", "Wins", "Losses", "Draws", "Win share"], bandRows(weaponBands), "No weapon-count data in this report.")}</article></section><section class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">ARENA BREAKDOWN</span><h2>Outcomes by battlefield</h2></div><small>Each report segment is weighted by its battle count</small></div>${table(["Arena", "Matches", "Side 0", "Side 1", "Draws", "Side-0 share", "Avg. duration", "Avg. damage S0 / S1", "Avg. integrity S0 / S1"], summaryRows(arenas), "No arena data in this report.")}</section><section class="panel meta-section"><div class="meta-section-title"><div><span class="eyebrow">DATA MIX</span><h2>Battle source & engine coverage</h2></div><small>All supported match sources are included</small></div><div class="meta-analysis-grid">${table(["Source", "Matches", "Side 0", "Side 1", "Draws", "Side-0 share", "Avg. duration", "Avg. damage S0 / S1", "Avg. integrity S0 / S1"], summaryRows(sources), "No battle sources in this report.")}${table(["Engine hash", "Matches", "Side 0", "Side 1", "Draws", "Side-0 share", "Avg. duration", "Avg. damage S0 / S1", "Avg. integrity S0 / S1"], summaryRows(engines), "No engine releases in this report.")}</div><div class="meta-hashes"><span class="eyebrow">FULL ENGINE HASHES IN THIS REPORT</span><div>${hashMarkup}</div></div></section><section class="meta-section"><div class="meta-section-title"><div><span class="eyebrow">FULL SEGMENT DATA</span><h2>Source × engine × arena × rules</h2></div><small>${groups.length} exact segments</small></div><div class="meta-segments">${detailedGroups || `<section class="panel meta-empty">No verified matches were available in this report window.</section>`}</div></section><section class="panel meta-method"><span class="eyebrow">HOW TO INTERPRET THIS</span><h2>Descriptive telemetry, not a controlled balance trial</h2><p>The worker records completed paid battles and server-replays free practice, friendly, and shared-link battles before accepting their results. Daily reports retain only aggregate statistics; source, engine hash, arena, and exact rules stay separated so unlike battles are not silently combined. The raw match log is kept for seven days to support replay verification and analysis, while up to 365 daily reports remain available here.</p><p>Build comparisons reveal correlations. They cannot prove armor, weapon count, or a particular gun caused a win: skilled users choose stronger builds, opponents differ, and samples may be small. Look for repeated patterns across dates, sources, arenas, and engine hashes before changing balance.</p><p class="meta-caveat">${esc(report.interpretation || "Results describe the matches recorded for the selected interval; they do not represent a controlled experiment.")}</p></section>`;
  };
  const load = async ({ reportId = null, refreshLatest = false } = {}) => {
    const sequence = ++requestSequence;
    refresh.disabled = true;
    history.disabled = true;
    status.textContent = reportId === null ? "Updating and loading the latest daily report…" : "Loading the selected report…";
    try {
      const params = new URLSearchParams();
      if (reportId !== null) params.set("reportId", String(reportId));
      if (refreshLatest) params.set("refresh", "1");
      const query = params.toString();
      const response = await fetch(`/api/meta/reports${query ? `?${query}` : ""}`, { headers: { accept: "application/json" }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "The report service is unavailable.");
      if (sequence !== requestSequence || !content.isConnected) return;
      if (data.available === false) throw Error("Battle reports are temporarily unavailable.");
      reports = Array.isArray(data.reports) ? data.reports : [];
      $("#meta-interval").textContent = `${data.intervalHours || 24} hours`;
      dataInterval = Number(data.intervalHours) || 24;
      history.innerHTML = reports.length ? reports.map((item) => `<option value="${Number(item.reportId)}">${esc(dateLabel(item.generatedAt))} · ${clockLabel(item.generatedAt)} · ${Number(item.battleCount) || 0} matches</option>`).join("") : `<option value="">No daily reports yet</option>`;
      const selected = data.selectedReport;
      history.disabled = reports.length === 0;
      if (!selected) {
        status.textContent = reports.length ? "This saved report is unavailable." : "No battle report has been published yet.";
        content.innerHTML = `<section class="panel meta-empty"><strong>${reports.length ? "Report could not be loaded." : "The first daily report is waiting for completed battles."}</strong><p>Every completed practice, friendly, shared challenge, and bounty battle is eligible for replay-verified aggregate analysis. Reports run every ${Number(data.intervalHours) || 24} hours. The seven-day raw log window gives the worker time to verify and process matches.</p><button class="primary" id="meta-play">Build a machine and fight</button></section>`;
        $("#meta-play").onclick = workshop;
        return;
      }
      history.value = String(selected.reportId);
      status.textContent = `${dateLabel(selected.generatedAt)} · generated ${clockLabel(selected.generatedAt)} UTC · ${reports.length} reports in the archive`;
      renderReport(selected);
    } catch (error) {
      if (sequence !== requestSequence || !content.isConnected) return;
      status.textContent = "Could not load the battle meta report.";
      history.disabled = true;
      content.innerHTML = `<section class="panel meta-empty"><strong>${esc(error.message || "Report unavailable")}</strong><p>Battle recording is best-effort; the match itself still works if analytics are offline.</p><button id="meta-retry">Try again</button></section>`;
      $("#meta-retry").onclick = () => load({ refreshLatest: true });
    } finally {
      if (sequence === requestSequence && content.isConnected) refresh.disabled = false;
    }
  };
  history.onchange = () => { const value = Number(history.value); if (Number.isSafeInteger(value) && value > 0) load({ reportId: value }); };
  refresh.onclick = () => load({ refreshLatest: true });
  let dataInterval = 24;
  load({ refreshLatest: true });
}
function setSoundUI(ready = false) {
  const state = sound ? (ready ? "ON" : "BLOCKED") : "OFF";
  $("#sound-state").textContent = state;
  $("#sound-btn").setAttribute(
    "aria-label",
    sound
      ? ready
        ? "Disable music and sound effects"
        : "Audio is blocked; click to enable music and sound effects"
      : "Enable music and sound effects",
  );
}
function audioIsPlaying() {
  return audioDirector.status === "listening" || musicDirector.status === "playing";
}
$("#sound-btn").onclick = () => {
  if (sound && !audioIsPlaying()) {
    initAudio().then((ready) => {
      setSoundUI(ready);
      if (ready) beep(400, 0.1, 0.06);
    });
    return;
  }
  sound = !sound;
  audioDirector.setPreference({ enabled: sound });
  musicDirector.setPreference({ enabled: sound });
  if (sound) initAudio().then((ready) => {
    syncMusic();
    setSoundUI(ready);
    if (ready) beep(400, 0.1, 0.06);
  });
  setSoundUI(false);
};
setSoundUI(false);
const unlockAudio = () => {
  document.removeEventListener("pointerdown", unlockAudio, true);
  document.removeEventListener("keydown", unlockAudio, true);
  if (sound) initAudio().then(setSoundUI);
};
document.addEventListener("pointerdown", unlockAudio, true);
document.addEventListener("keydown", unlockAudio, true);
document.addEventListener("visibilitychange", () => {
  musicDirector.hold("hidden", document.hidden);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#builder-focus")?.classList.contains("theater")) {
    e.preventDefault();
    $("#builder-focus").classList.remove("theater");
    invalidateBench();
    return;
  }
  if (e.target.matches("input,textarea,select") || $("#modal").open) return;
  if (view === "workshop") {
    if (e.key.toLowerCase() === "r") rotate();
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      undo();
    }
  } else if (e.code === "Space" && !e.target.matches("button")) {
    e.preventDefault();
    togglePause();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running && !paused) togglePause();
});
window.addEventListener("resize", () => {
  invalidateBench();
  drawArena();
});
document.addEventListener("fullscreenchange", () => {
  if ($("#builder-focus")) invalidateBench();
  const stage = $("#combat-stage");
  if (stage) {
    if (document.fullscreenElement !== stage) theaterFallback = false;
    syncArenaTheater();
    drawArena();
  }
});
function renderRoute(route) {
  routeRestoring = true;
  try {
    if (route.name === "home") return portal.home();
    if (route.name === "agents") return portal.agents();
    if (route.name === "workshop") return workshop();
    if (route.name === "arena") return arenaView();
    if (route.name === "rules") return rulesView();
    if (route.name === "meta") return metaView();
    if (route.name === "friendly") return void friendlyUI.open(undefined, { restore: true });
    if (route.name === "friendlyChallenge") return void friendlyUI.open(route.value, { restore: true });
    if (route.name === "anchor") {
      if (view !== "rules") rulesView();
      requestAnimationFrame(() => document.getElementById(route.value)?.scrollIntoView());
      return;
    }
    if (route.name === "bounties") return void bountyUI.open(undefined, { restore: true });
    if (route.name === "bounty") return void bountyUI.open(route.value, { restore: true });
    if (route.name === "challenge") {
      try {
        return loadChallenge(decodeChallenge(route.value));
      } catch (error) {
        toast(error.message || "That challenge link is invalid.");
        return go({ name: "workshop" }, { replace: true });
      }
    }
    if (route.name === "build") {
      try {
        const imported = decodeChallenge(route.value);
        machine = imported.machine;
        rules = imported.rules;
        arenaId = imported.arena;
        seed = imported.seed;
        battleMode = rules.combat;
        save();
        return workshop();
      } catch (error) {
        toast(error.message || "That build link is invalid.");
        return go({ name: "workshop" }, { replace: true });
      }
    }
    app.innerHTML = '<section class="panel empty"><h1>Route not found</h1><p>This link is not a War Machines screen.</p><button id="route-home" class="primary">Return home</button></section>';
    $("#route-home").onclick = () => go({ name: "home" }, { replace: true });
  } finally {
    routeRestoring = false;
  }
}
routeRouter = createHashRouter({ render: renderRoute });
routeRouter.start();
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const toolList = [
    {
      name: "read_machine",
      title: "Read machine blueprint",
      description:
        "Read the current machine, 3D part coordinates, engineering limits, and deployment issues.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        return {
          machine: clone(machine),
          stats: stats(machine),
          limits: { ...rules, levels: LEVELS, sockets: MAX_MODULES },
          challengeLocked: !!challenge,
          issues: validate(machine, rules),
          view,
        };
      },
    },
    {
      name: "configure_machine_modules",
      title: "Configure machine modules",
      description:
        "Install or remove parts on the three-level workshop grid with the same budget, support, save, and undo actions as the workshop.",
      inputSchema: {
        type: "object",
        properties: {
          modules: {
            type: "array",
            maxItems: 40,
            items: {
              type: "object",
              properties: {
                x: { type: "integer", minimum: 0, maximum: 8 },
                y: { type: "integer", minimum: 0, maximum: 8 },
                z: { type: "integer", minimum: 0, maximum: 2 },
                part: {
                  type: "string",
                  enum: PARTS.filter((p) => p.id !== "core")
                    .map((p) => p.id)
                    .concat("remove"),
                },
                rotation: { type: "integer", minimum: 0, maximum: 3 },
                grade: { type: "string", enum: Object.keys(GRADES) },
              },
              required: ["x", "y", "part"],
              additionalProperties: false,
            },
          },
        },
        required: ["modules"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (
          !input ||
          !Array.isArray(input.modules) ||
          input.modules.length > 40
        )
          throw Error("Invalid module list.");
        const next = clone(machine);
        for (const op of input.modules) {
          const z = op.z || 0;
          if (
            ![op.x, op.y, z, op.rotation || 0].every(Number.isInteger) ||
            op.x < 0 ||
            op.x > 8 ||
            op.y < 0 ||
            op.y > 8 ||
            z < 0 ||
            z > 2 ||
            (op.rotation || 0) < 0 ||
            (op.rotation || 0) > 3 ||
            (!BY_ID[op.part] && op.part !== "remove") ||
            op.part === "core" ||
            (op.grade && !Object.hasOwn(GRADES, op.grade))
          )
            throw Error("Invalid module operation.");
          const old = next.modules.find(
            (m) => m.x === op.x && m.y === op.y && (m.z || 0) === z,
          );
          if (old?.id === "core") throw Error("Cannot replace the core.");
          if (
            op.part !== "remove" &&
            z &&
            (BY_ID[op.part].ground ||
              !next.modules.some(
                (m) =>
                  m.x === op.x &&
                  m.y === op.y &&
                  (m.z || 0) === z - 1 &&
                  BY_ID[m.id].support,
              ))
          )
            throw Error(
              "Upper parts require a supporting part directly below.",
            );
          next.modules = next.modules.filter((m) => m !== old);
          if (op.part !== "remove")
            next.modules.push({
              id: op.part,
              x: op.x,
              y: op.y,
              r: op.rotation || 0,
              ...(z ? { z } : {}),
              ...(op.grade && op.grade !== "stock" ? { u: op.grade } : {}),
            });
        }
        const error = budgetError(next);
        if (error) throw Error(error);
        snapshot();
        machine = next;
        save();
        workshop();
        return {
          modules: machine.modules.length,
          cost: stats(machine).cost,
          issues: validate(machine, rules),
        };
      },
    },
  ];
  for (const tool of toolList) {
    try {
      Promise.resolve(
        document.modelContext.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {}
  }
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}
