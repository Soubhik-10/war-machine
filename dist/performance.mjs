const TIERS = Object.freeze(["balanced", "high"]);

export const GRAPHICS_PROFILES = Object.freeze({
  balanced: Object.freeze({
    tier: "balanced",
    maxPixelRatio: 1.1,
    renderHz: 50,
    effects: "reduced",
    ventParticles: 5,
    trailParticles: 5,
    damageSmokeParticles: 3,
    smokeParticles: 10,
    shieldRings: 5,
    shieldSegments: 6,
    debrisLimit: 96,
    ringSegments: 40,
  }),
  high: Object.freeze({
    tier: "high",
    maxPixelRatio: 1.5,
    renderHz: 60,
    effects: "full",
    ventParticles: 7,
    trailParticles: 8,
    damageSmokeParticles: 3,
    smokeParticles: 16,
    shieldRings: 6,
    shieldSegments: 7,
    debrisLimit: Infinity,
    ringSegments: 64,
  }),
});

const validTier = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  // Keep old local overrides and bookmarked test URLs working after the
  // policy was reduced to balanced plus absolute-high.
  return normalized === "low"
    ? "balanced"
    : TIERS.includes(normalized)
      ? normalized
      : null;
};

const numberOrNull = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : null;

export function classifyGraphicsTier({
  hardwareConcurrency,
  deviceMemory,
  saveData = false,
  renderer = "",
  userAgent = "",
} = {}) {
  const cores = numberOrNull(hardwareConcurrency);
  const memory = numberOrNull(deviceMemory);
  const gpu = String(renderer || "");
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(String(userAgent));
  const knownHardware = cores !== null && memory !== null && gpu.trim().length > 0;
  const software =
    /swiftshader|llvmpipe|software renderer|software rasterizer|microsoft basic render|angle \(.*warp/i.test(
      gpu,
    );
  if (
    saveData ||
    software ||
    (cores !== null && cores <= 2) ||
    (memory !== null && memory <= 2) ||
    (mobile && cores !== null && cores <= 4 && memory !== null && memory <= 4)
  )
    return "balanced";

  // Missing hardware telemetry is common in privacy-focused browsers. Keep
  // the safer profile until the device is explicitly identified as capable.
  return knownHardware ? "high" : "balanced";
}

function webglRenderer(env) {
  try {
    const document = env?.document;
    if (!document?.createElement) return "";
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext?.("webgl2", {
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    });
    if (!gl) return "";
    const debug = gl.getExtension?.("WEBGL_debug_renderer_info");
    return debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) || "")
      : "";
  } catch {
    return "";
  }
}

export function detectGraphicsTier(env = globalThis) {
  const navigator = env?.navigator || {};
  return classifyGraphicsTier({
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    saveData: Boolean(navigator.connection?.saveData),
    renderer: webglRenderer(env),
    userAgent: navigator.userAgent,
  });
}

function storedTier(env) {
  try {
    const query = env?.location?.search;
    const fromQuery = query
      ? validTier(new URLSearchParams(query).get("graphics"))
      : null;
    if (fromQuery) return fromQuery;
    return validTier(env?.localStorage?.getItem("wm-graphics-tier"));
  } catch {
    return null;
  }
}

export function getGraphicsProfile(env = globalThis) {
  const tier = storedTier(env) || detectGraphicsTier(env);
  return GRAPHICS_PROFILES[tier] || GRAPHICS_PROFILES.balanced;
}

export function setGraphicsTier(tier, env = globalThis) {
  const normalized = validTier(tier);
  try {
    if (normalized) env?.localStorage?.setItem("wm-graphics-tier", normalized);
    else env?.localStorage?.removeItem("wm-graphics-tier");
  } catch {
    // Storage may be disabled in private or embedded contexts.
  }
  return getGraphicsProfile(env);
}

export function powerProfile(profile, battery) {
  if (!battery || battery.charging || battery.level > 0.2)
    return profile;
  return profile.tier === "high" ? GRAPHICS_PROFILES.balanced : profile;
}

export function watchPowerState(profile, onChange, env = globalThis) {
  const getBattery = env?.navigator?.getBattery;
  if (typeof getBattery !== "function" || typeof onChange !== "function")
    return () => {};

  let battery = null;
  let stopped = false;
  let current = profile;
  const refresh = () => {
    if (stopped || !battery) return;
    const next = powerProfile(profile, battery);
    if (next.tier !== current.tier) {
      current = next;
      onChange(next);
    }
  };
  const attach = (value) => {
    if (stopped || !value) return;
    battery = value;
    battery.addEventListener?.("chargingchange", refresh);
    battery.addEventListener?.("levelchange", refresh);
    refresh();
  };
  Promise.resolve(getBattery.call(env.navigator)).then(attach).catch(() => {});
  return () => {
    stopped = true;
    battery?.removeEventListener?.("chargingchange", refresh);
    battery?.removeEventListener?.("levelchange", refresh);
  };
}
