// Firm-wide schedule configuration — edited in Master ("Schedule" tab) and
// consumed by the per-project schedule on Project Detail. localStorage-backed
// so it works without a backend; a backend later just syncs the same shape.

const KEY = "scheduleConfig";

// Bump when the default presets change shape/meaning so saved blobs migrate.
// v2 = scope-based presets (one schedule per static Item Master scope) replacing
// the old room/category presets.
// v5 = shift planning removed — each scope carries only its duration in `days`.
// Saved configs are migrated by dropping any legacy `shiftsPerDay` / `shifts`
// field; durations, timelines and possession math stay in DAYS.
export const SCHEDULE_CONFIG_VERSION = 5;

export const DEFAULT_CONFIG = {
  version: SCHEDULE_CONFIG_VERSION,
  // How many days BEFORE the planned end a task turns amber ("due soon").
  amberWindowDays: 2,
  // Escalation ladder. A task that is `minDaysOverdue` (or more) past its
  // planned end escalates to `role`. Highest matching tier wins.
  escalationTiers: [
    { minDaysOverdue: 1, role: "Task Owner" },
    { minDaysOverdue: 3, role: "Project Manager" },
    { minDaysOverdue: 6, role: "Studio Head" },
  ],
  // Scope presets. The Schedule Master is scope-based: one schedule per static
  // scope (work item) from the Item Master. Each scope carries its default
  // `days` duration — it auto-fills the proposal scope & seeds the project
  // timeline / possession math.
  // Kept under the `rooms` key so existing consumers stay unchanged.
  // Mirrors the static scopes in `DEFAULT_LIBRARY` (data/itemLibrary.js).
  rooms: [
    { name: "False Ceiling — gypsum board with cove groove", days: 4 },
    { name: "TV Unit — paneling with storage", days: 5 },
    { name: "Accent Wall Paneling — veneer / laminate", days: 3 },
    { name: "Cove / Profile Lighting", days: 2 },
    { name: "Crockery Unit — glass shutters + lighting", days: 5 },
    { name: "Modular Kitchen Base Unit", days: 6 },
    { name: "Modular Kitchen Wall Unit", days: 5 },
    { name: "Kitchen Counter — granite / quartz", days: 2 },
    { name: "Wardrobe — laminate, soft-close", days: 6 },
    { name: "Wardrobe — premium veneer finish", days: 6 },
    { name: "Bed Back Panel — upholstered", days: 4 },
    { name: "Dresser Unit — with mirror", days: 3 },
    { name: "Study / Work Desk — built-in", days: 4 },
    { name: "Shoe Rack — with bench top", days: 3 },
    { name: "Bathroom Vanity — marine ply + counter", days: 3 },
    { name: "Shower Glass Partition — 8mm toughened", days: 2 },
    { name: "Foyer Console — with mirror", days: 2 },
    { name: "Wall Mirror Panel", days: 1 },
    { name: "Site Supervision & Project Management", days: 0 },
    { name: "Design & 3D Visualization", days: 0 },
  ],
  // Task status options.
  statuses: ["Not Started", "In Progress", "Done", "Blocked"],
};

// Coerce rooms to [{ name, days }] — tolerates the old string-array format and
// partial blobs (missing days) so existing saved configs keep working. Any
// legacy `shiftsPerDay` / `shifts` field is dropped.
function normalizeRooms(rooms) {
  if (!Array.isArray(rooms)) return DEFAULT_CONFIG.rooms;
  return rooms
    .map((r) =>
      typeof r === "string"
        ? { name: r.trim(), days: "" }
        : {
            name: (r?.name || "").trim(),
            days: r?.days ?? "",
          },
    )
    .filter((r) => r.name);
}

export function getScheduleConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const saved = JSON.parse(raw);
    // Merge over defaults so a partial/old saved blob never drops keys.
    const merged = { ...DEFAULT_CONFIG, ...saved };
    const savedVersion = Number(saved.version) || 0;
    if (savedVersion < 2) {
      // Pre-v2 (room/category-based) configs predate the scope presets entirely.
      merged.rooms = DEFAULT_CONFIG.rooms;
    }
    // v2/v3/v4 → v5: scope presets already exist with their `days`; keeping the
    // user's durations and dropping any legacy shift field is handled by
    // normalizeRooms below, so no per-version remap is needed.
    if (savedVersion < SCHEDULE_CONFIG_VERSION) merged.version = SCHEDULE_CONFIG_VERSION;
    merged.rooms = normalizeRooms(merged.rooms);
    return merged;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveScheduleConfig(config) {
  // Strip headings array from being persisted to database
  const rest = { ...config };
  delete rest.headings;
  localStorage.setItem(KEY, JSON.stringify(rest));
  window.dispatchEvent(new Event("scheduleConfigChanged"));
}

export function resetScheduleConfig() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("scheduleConfigChanged"));
}

// Append a new room/category to the canonical list and persist. Returns the
// updated rooms array. No-op (returns current) if the name already exists.
export function addRoomCategory(name, days = "") {
  const trimmed = (name || "").trim();
  const cfg = getScheduleConfig();
  if (!trimmed || cfg.rooms.some((r) => r.name === trimmed)) return cfg.rooms;
  const rooms = [...cfg.rooms, { name: trimmed, days }];
  saveScheduleConfig({ ...cfg, rooms });
  return rooms;
}

// Default duration (days) configured for a category, or "" if none/unknown.
export function getRoomDefaultDays(name, config = getScheduleConfig()) {
  const cleanName = (name || "").replace(/\s+\d+$/g, "").trim().toUpperCase();
  const r = config.rooms.find((x) => (x.name || "").trim().toUpperCase() === cleanName);
  return r && r.days !== "" && r.days != null ? r.days : "";
}

// Given a positive days-overdue count, return the matching escalation role
// (the highest tier whose threshold is met), or null if none apply.
export function getEscalationRole(daysOverdue, config = getScheduleConfig()) {
  if (!daysOverdue || daysOverdue <= 0) return null;
  return [...config.escalationTiers]
    .sort((a, b) => a.minDaysOverdue - b.minDaysOverdue)
    .reduce((role, t) => (daysOverdue >= t.minDaysOverdue ? t.role : role), null);
}

// ── Heading helpers (consumed by Proposal Master) ─────────────────────────

// Get all headings, optionally filtered by category name. Case-insensitive
// matching on category. Returns [{ name, category }].
// Mapped solely from Room / Category Presets (rooms).
export function getScheduleHeadings(category = null, config = getScheduleConfig()) {
  const rooms = config.rooms || [];
  if (!category) {
    return rooms.map((r) => ({ name: r.name, category: r.name }));
  }
  const cat = category.trim().toUpperCase();
  const matched = rooms.filter((r) => r.name.trim().toUpperCase() === cat);
  if (matched.length > 0) {
    return matched.map((r) => ({ name: r.name, category: r.name }));
  }
  return [{ name: category.trim(), category: category.trim() }];
}

// Extract the parent category from a heading name. Uses the rooms list as
// the source of known categories: the longest room name that is a prefix of
// the heading is the category. Falls back to the heading itself.
export function getCategoryFromHeading(headingName, config = getScheduleConfig()) {
  if (!headingName) return "";
  const upper = headingName.trim().toUpperCase();
  const rooms = (config.rooms || [])
    .map((r) => r.name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first
  for (const room of rooms) {
    if (upper === room.toUpperCase() || upper.startsWith(room.toUpperCase() + " - ")) {
      return room;
    }
  }
  return headingName.trim();
}

// No-op for heading creation, to maintain signature compatibility.
export function addScheduleHeading(_name, _category = null) {
  return [];
}

// Get all room/category names (used as parent categories for heading grouping).
// This is the SINGLE SOURCE OF TRUTH for heading values — all headings must
// map back to one of these room/category presets.
export function getRoomCategories(config = getScheduleConfig()) {
  return (config.rooms || []).map((r) => r.name.trim()).filter(Boolean);
}

// Get room/category presets as heading options (rooms as the single source).
// Returns [{ name, days }] — directly from Schedule Master rooms.
export function getRoomCategoryPresets(config = getScheduleConfig()) {
  return (config.rooms || [])
    .map((r) => ({
      name: (r.name || "").trim(),
      days: r.days ?? "",
    }))
    .filter((r) => r.name);
}
