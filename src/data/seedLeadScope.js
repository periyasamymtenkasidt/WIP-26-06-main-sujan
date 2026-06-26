// ── Seed scope-of-work data for existing leads ────────────────────────────
// Runs once at app startup. For every Interiors lead that carries a preset +
// grade but NO saved `quoteScopeItems`, this computes the scope items from
// the master preset configuration, maps them to the lead's quality grade,
// and persists the result. After seeding, every lead has a
// `quoteScopeItems` array so the proposal / BOQ / survey / schedule flows
// all reference the lead's own scope data instead of the generic master.

import { getConfigForType } from "./QuotePresets";
import { mapScopeItemsToGrade } from "./gradeMapping";
import { normalizeScopeItem } from "../utils/scopeNaming";
import { toSingleSize } from "../utils/sizeRangeValidation";
import { TableData } from "./TableData";

/**
 * For a single lead, compute `quoteScopeItems` from the master preset
 * mapped to the lead's quality grade.  Returns `null` if the lead has
 * no preset or is an Architecture lead.
 */
const buildScopeForLead = (lead) => {
  const preset = lead.quotePreset;
  const grade = lead.quoteGrade || "economy";
  const propertyType = lead.propertyType || lead.location || "";

  // Architecture and leads without a package preset are skipped.
  if (!preset) return null;
  if (lead.serviceTrack === "Architecture") return null;

  const cfg = getConfigForType(preset, propertyType);
  if (!cfg || !cfg.scopeItems || cfg.scopeItems.length === 0) return null;

  // Deep-clone, normalize, then map to the lead's grade.
  let items = cfg.scopeItems.map((s) =>
    normalizeScopeItem({
      ...s,
      materials: s.materials ? s.materials.map((m) => ({ ...m })) : [],
    }),
  );
  items = mapScopeItemsToGrade(items, grade);
  return items;
};

// One-time migration so Economy is the default quality grade everywhere.
// Leads seeded under an earlier release persisted their scope-of-work data
// (and `quoteGrade`) mapped to Premium/Luxury; bumping this version forces a
// single re-map of every lead's grade + scope items back to Economy.
const SCOPE_GRADE_VERSION_KEY = "leadScopeGradeVersion";
const SCOPE_GRADE_VERSION = "economy-default-v1";

// One-time migration so the Size Range is a whole number everywhere. Leads
// seeded under an earlier release persisted a range / open band (e.g.
// "800-1100", "2400+") in `quoteSizeRange`; bumping this version collapses each
// to its single representative number to match the digits-only Size Range rule.
const SIZE_RANGE_VERSION_KEY = "leadScopeSizeRangeVersion";
const SIZE_RANGE_VERSION = "digits-only-v1";

/**
 * Seed quoteScopeItems onto every lead that doesn't already have them.
 * Writes to localStorage so this is a one-time operation per browser.
 */
export const seedLeadScopeData = () => {
  try {
    // Read existing localStorage leads
    let storedLeads = [];
    try {
      const raw = localStorage.getItem("newLeadsData");
      if (raw) storedLeads = JSON.parse(raw);
    } catch {
      storedLeads = [];
    }

    const storedById = new Map(
      storedLeads.map((l) => [l.proposalId, l]),
    );

    // Merge: localStorage takes priority, then static TableData
    let allLeads = [
      ...storedLeads,
      ...TableData.filter((td) => !storedById.has(td.proposalId)),
    ];

    let changed = false;

    // Grade migration: one-time pass that forces every lead — and its already
    // persisted scope-of-work data — onto the Economy grade so the proposal
    // form opens in Economy by default. Runs once per browser per version.
    const gradeMigrated =
      localStorage.getItem(SCOPE_GRADE_VERSION_KEY) === SCOPE_GRADE_VERSION;
    if (!gradeMigrated) {
      allLeads = allLeads.map((lead) => {
        let next = lead;
        if (next.quoteGrade && next.quoteGrade !== "economy") {
          next = { ...next, quoteGrade: "economy" };
          changed = true;
        }
        if (Array.isArray(next.quoteScopeItems) && next.quoteScopeItems.length > 0) {
          next = {
            ...next,
            quoteScopeItems: mapScopeItemsToGrade(next.quoteScopeItems, "economy"),
          };
          changed = true;
        }
        return next;
      });
    }

    // Size Range migration: one-time pass that collapses any persisted range /
    // open band on a lead's `quoteSizeRange` to a single whole number.
    const sizeMigrated =
      localStorage.getItem(SIZE_RANGE_VERSION_KEY) === SIZE_RANGE_VERSION;
    if (!sizeMigrated) {
      allLeads = allLeads.map((lead) => {
        const single = toSingleSize(lead.quoteSizeRange);
        if (single !== (lead.quoteSizeRange || "")) {
          changed = true;
          return { ...lead, quoteSizeRange: single };
        }
        return lead;
      });
    }

    const updatedLeads = [];

    for (const lead of allLeads) {
      // Skip if already has scope data — keep it unchanged
      if (
        lead.quoteScopeItems &&
        Array.isArray(lead.quoteScopeItems) &&
        lead.quoteScopeItems.length > 0
      ) {
        updatedLeads.push(lead);
        continue;
      }

      // Try to build scope items from the master preset
      const scopeItems = buildScopeForLead(lead);
      if (scopeItems) {
        updatedLeads.push({ ...lead, quoteScopeItems: scopeItems });
        changed = true;
      } else {
        // No scope could be built (Architecture / no preset) — keep as-is
        updatedLeads.push(lead);
        changed = changed || !storedById.has(lead.proposalId);
      }
    }

    if (changed) {
      localStorage.setItem("newLeadsData", JSON.stringify(updatedLeads));
    }
    // Mark the migrations done so they never re-run on later loads.
    localStorage.setItem(SCOPE_GRADE_VERSION_KEY, SCOPE_GRADE_VERSION);
    localStorage.setItem(SIZE_RANGE_VERSION_KEY, SIZE_RANGE_VERSION);
  } catch (err) {
    console.error("[seedLeadScopeData] Failed to seed lead scope data:", err);
  }
};
