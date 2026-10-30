/**
 * Job phases ("sectors" in payroll, calendars and the field app) from the trade pack.
 * Phase 0: every organization runs Hardwood, so these are installation / sand_finish, and
 * "both" for a job that runs them in sequence — exactly the values the app always used.
 */
import { getPack } from "./index.js";
import type { PhaseDef, PhaseDoneField } from "./types.js";

const pack = getPack();

/** Phase keys in order (hardwood: installation, sand_finish). */
export const PHASE_KEYS: readonly string[] = pack.phases.map((p) => p.key);

/** The key a job uses when it runs every phase in sequence (hardwood: "both"). */
export const COMBINED_PHASE: string = pack.combinedPhaseKey;

/** The phase a job without one belongs to (hardwood: installation). */
export const DEFAULT_PHASE: string = PHASE_KEYS[0]!;

/** Phases in order, with the column that records when each closed. */
export const PHASES: readonly PhaseDef[] = pack.phases;

/** Done-at columns in phase order (hardwood: installationDoneAt, sandDoneAt). */
export const PHASE_DONE_FIELDS: readonly PhaseDoneField[] = pack.phases.map((p) => p.doneAtField);

/** True for a single phase key (not the combined key, not "all"). */
export function isPhaseKey(v: unknown): boolean {
  return typeof v === "string" && PHASE_KEYS.includes(v);
}

/** A single phase, falling back to the first one (the old `sectorKey`). */
export function phaseOrDefault(v: unknown): string {
  return isPhaseKey(v) ? (v as string) : DEFAULT_PHASE;
}

export function phaseLabel(key: string, locale: keyof PhaseDef["label"] = "pt-BR"): string {
  return pack.phases.find((p) => p.key === key)?.label[locale] ?? key;
}
