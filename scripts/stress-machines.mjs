import { BY_ID, clone, DEFAULT_RULES, PRESETS, stats, validate } from '../dist/data.mjs';

// Deliberately kept outside the shipped factory/enemy catalog. These fixtures
// exercise dense armor, supported towers, weapon mixes, and resource pressure
// without changing the signed combat data used by deployed challenges.
const PROFILES = [
  ['Aegis Bastion', 'cannon', 'mortar', 'bulkhead', 'track', 'balanced', 2, 'armored tower'],
  ['Granite Longbow', 'railgun', 'cannon', 'armor', 'track', 'kite', 1, 'armored rail tower'],
  ['Rocket Redoubt', 'rocket', 'mortar', 'bulkhead', 'track', 'balanced', 2, 'missile tower'],
  ['Plasma Monolith', 'plasma', 'cannon', 'ceramic', 'hover', 'balanced', 2, 'energy tower'],
  ['Stormwall Keep', 'tesla', 'emp', 'reactive', 'track', 'flank', 1, 'chain defense'],
  ['Blackout Spire', 'emp', 'rocket', 'insulator', 'hover', 'kite', 2, 'disruption tower'],
  ['Flak Cathedral', 'flak', 'cannon', 'cage', 'track', 'balanced', 2, 'anti-missile tower'],
  ['Cyclone Foundry', 'gatling', 'shredder', 'bulkhead', 'track', 'balanced', 1, 'sustained-fire tower'],
  ['Needle Watch', 'shredder', 'sabot', 'ceramic', 'wheel', 'kite', 2, 'precision tower'],
  ['Sabot Citadel', 'sabot', 'railgun', 'bulkhead', 'track', 'balanced', 2, 'armor-piercing tower'],
  ['Frost Bastion', 'cryo', 'flak', 'insulator', 'winterwheel', 'flank', 1, 'cold-weather armor'],
  ['Cinder Keep', 'flame', 'cannon', 'reactive', 'track', 'ram', 1, 'close-range armor'],
  ['Widow Fortress', 'mine', 'rocket', 'cage', 'dunewheel', 'flank', 1, 'minelayer redoubt'],
  ['Reactive Crown', 'cannon', 'emp', 'reactive', 'track', 'balanced', 3, 'stacked reactive tower'],
  ['Ceramic Needle', 'laser', 'sabot', 'ceramic', 'hover', 'kite', 2, 'anti-energy tower'],
  ['Blast-Cage Battery', 'mortar', 'rocket', 'cage', 'track', 'balanced', 3, 'stacked blast defense'],
  ['Brinebreaker', 'emp', 'tesla', 'insulator', 'dunewheel', 'balanced', 2, 'floodplain tower'],
  ['Siege Furnace', 'gatling', 'plasma', 'armor', 'track', 'balanced', 2, 'high-output heat tower'],
  ['Four-Spire Crown', 'mortar', 'railgun', 'bulkhead', 'track', 'kite', 4, 'four maximum-height towers'],
  ['Iron Orchard', 'cannon', 'flak', 'bulkhead', 'track', 'ram', 3, 'wide armored battery'],
];

const ANCHORS = [[4, 3], [5, 4], [4, 5], [3, 4]];
const MOBILITY_SLOTS = [[3, 3], [5, 3], [5, 5], [3, 5]];
const RESOURCE_SLOTS = [[6, 4], [4, 6], [2, 4], [4, 2], [6, 5], [5, 6], [2, 5], [3, 6]];
const TOWER_SLOTS = [[4, 3], [5, 4], [4, 5], [3, 4]];
// Keep physical caps from normal matches while raising the credit ceiling so
// the fixtures can reach the part/mass limits and exercise dense simulations.
export const STRESS_RULES = Object.freeze({ ...DEFAULT_RULES, mode: 'custom', credits: 5000 });
const MODULE_CAP = STRESS_RULES.parts + 1; // The core is excluded from the parts limit.

function part(id, x, y, z = 0, r = 0) {
  return { id, x, y, z, r };
}

function tryAdd(machine, additions) {
  if (machine.modules.length + additions.length > MODULE_CAP) return false;
  const modules = [...machine.modules, ...additions];
  if (validate({ ...machine, modules }, STRESS_RULES).length) return false;
  machine.modules = modules;
  return true;
}

function openGroundSlots(machine) {
  const occupied = new Set(machine.modules.filter(m => !(m.z || 0)).map(m => `${m.x},${m.y}`));
  return Array.from({ length: 81 }, (_, i) => [i % 9, Math.floor(i / 9)])
    .filter(([x, y]) => !occupied.has(`${x},${y}`))
    .sort((a, b) => Math.abs(a[0] - 4) + Math.abs(a[1] - 4) - Math.abs(b[0] - 4) - Math.abs(b[1] - 4));
}

function build(profile, index) {
  const [name, primary, secondary, armor, mobility, tactic, towers, focus] = profile;
  const machine = {
    ...clone(PRESETS[0]),
    name,
    number: 20 + index,
    paint: ['#586773', '#71624b', '#4b6263', '#655a70'][index % 4],
    accent: ['#e8bd70', '#d9a477', '#8ed5c5', '#d08d76'][index % 4],
    glow: ['#79d5c4', '#edac68', '#a8d4e4', '#f0c47c'][index % 4],
    pattern: index % 2 ? 'hazard' : 'camo',
    tactic,
    target: index % 3 ? 'weapons' : 'power',
    range: Math.max(90, Math.min(570, ({ mine: 500, mortar: 570, railgun: 530, laser: 480, rocket: 510, flame: 180, tesla: 230 })[primary] || 370)),
    stance: index % 2 ? 'guarded' : 'steady',
    front: index % 4,
    stressFocus: focus,
    modules: [part('core', 4, 4)],
  };

  // A connected four-sided support ring leaves room for diagonal mobility.
  const armorMix = [armor, index % 3 === 0 ? 'bulkhead' : armor, index % 3 === 1 ? 'reactive' : armor, index % 3 === 2 ? 'ceramic' : armor];
  ANCHORS.forEach(([x, y], i) => machine.modules.push(part(armorMix[i], x, y)));
  MOBILITY_SLOTS.forEach(([x, y], i) => machine.modules.push(part(mobility, x, y, 0, (index + i) % 4)));

  // Every candidate starts with working mobility, a weapon, and basic power
  // and cooling; only the credit cap is raised for these stress fixtures.
  machine.modules.push(part(primary, 4, 2, 0, index % 4));
  machine.modules.push(part('battery', 6, 4));
  machine.modules.push(part(index % 2 ? 'radiator' : 'cooler', 4, 6));
  const initialIssues = validate(machine, STRESS_RULES);
  if (initialIssues.length) throw new Error(`${name}: invalid starter chassis: ${initialIssues.join(' ')}`);

  // Add up to four supported towers. Each barrel is rooted in a ground-level
  // support and has a deck immediately beneath it, so it can be used to probe
  // both stacked collision and support-collapse behavior.
  let builtTowers = 0;
  for (let offset = 0; offset < TOWER_SLOTS.length && builtTowers < towers; offset++) {
    const [x, y] = TOWER_SLOTS[(offset + index) % TOWER_SLOTS.length];
    const foundation = machine.modules.find(m => m.x === x && m.y === y && !(m.z || 0));
    if (!foundation || !BY_ID[foundation.id]?.support) continue;
    const requestedWeapon = offset % 2 ? secondary : primary;
    const weapon = BY_ID[requestedWeapon]?.ground ? secondary : requestedWeapon;
    if (tryAdd(machine, [part('deck', x, y, 1), part(weapon, x, y, 2, (index + offset + 1) % 4)])) builtTowers++;
  }

  // Give each machine a distinct secondary system and weapon mix where its
  // budget allows, then pack legal armor around the connected core.
  const systems = index % 4 === 0 ? ['shield', 'reactor', 'radiator', 'repair']
    : index % 4 === 1 ? ['interceptor', 'capacitor', 'cooler', 'sensor']
      : index % 4 === 2 ? ['reactor', 'cooler', 'shield', 'smoke']
        : ['battery', 'radiator', 'gyro', 'repair'];
  let slotCursor = 0;
  for (const id of systems) {
    while (slotCursor < RESOURCE_SLOTS.length) {
      const [x, y] = RESOURCE_SLOTS[slotCursor++];
      if (machine.modules.some(m => m.x === x && m.y === y && !(m.z || 0))) continue;
      if (tryAdd(machine, [part(id, x, y)])) break;
    }
  }

  for (const [x, y] of [[6, 4], [4, 6], [2, 4], [4, 2], [6, 5], [5, 6], [2, 5], [3, 6]]) {
    if (machine.modules.some(m => m.x === x && m.y === y && !(m.z || 0))) continue;
    tryAdd(machine, [part(secondary, x, y, 0, (index + x + y) % 4)]);
  }

  const defenses = [armor, index % 2 ? 'ceramic' : 'reactive', index % 3 ? 'cage' : 'insulator', 'armor'];
  for (const [slot, [x, y]] of openGroundSlots(machine).entries()) {
    if (machine.modules.length >= MODULE_CAP) break;
    tryAdd(machine, [part(defenses[slot % defenses.length], x, y, 0, (slot + index) % 4)]);
  }

  const issues = validate(machine, STRESS_RULES);
  if (issues.length) throw new Error(`${name}: invalid generated chassis: ${issues.join(' ')}`);
  const totals = stats(machine);
  machine.stressMeta = { focus, rules: 'custom · 5,000 credits · standard part, mass and weapon caps', parts: totals.parts, modules: machine.modules.length, cost: totals.cost, mass: totals.mass, weapons: totals.weapons, height: totals.height, towers: builtTowers };
  return machine;
}

export const STRESS_MACHINES = PROFILES.map(build);
export const STRESS_MACHINE_COUNT = STRESS_MACHINES.length;
