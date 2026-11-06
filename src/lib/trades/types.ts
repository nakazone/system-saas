/**
 * Trade Packs: everything that changes from one trade to another.
 *
 * The core (leads, customers, calendar, jobs, invoices, finance, chat, Master, Mate engine)
 * stays shared. A pack declares the trade-specific data the core reads: the default service
 * catalog, the customer quote sections, the job phases (today's payroll "sectors") and the
 * words the AI uses to describe the company.
 *
 * Phase 0: only the Hardwood pack exists and it reproduces today's behavior exactly.
 * The full design (measurement models, evidence, waste engines…) lives in labs/trades/.
 */

export const TRADE_IDS = ["hardwood", "tile", "countertops"] as const;
export type TradeId = (typeof TRADE_IDS)[number];

/** A default Tabela de Valores row. Rates always start at 0. */
export type PackService = {
  name: string;
  /** Pricing category; for hardwood: installation | sand_finish | supply | custom. */
  category: "installation" | "sand_finish" | "supply" | "custom";
  unit: string;
  description: string;
  sortOrder: number;
};

/** A section of the customer-facing quote, in print order. */
export type QuoteSectionDef = { key: string; label: string };

/** WorkOrder columns that record when a phase was closed. */
export type PhaseDoneField = "installationDoneAt" | "sandDoneAt";

/** Something a phase must have recorded before it can close (flood test, photo, signature…). */
export type PhaseRequirement = {
  key: string;
  kind: "photo" | "test" | "signature" | "checklist";
  label: { "pt-BR": string; "en-US": string };
};

/** A job phase that has its own crew, calendar and payroll period (hardwood: Instalação / Lixa). */
export type PhaseDef = {
  key: string;
  label: { "pt-BR": string; "en-US": string };
  /**
   * Column that stores when this phase was closed (packs that keep phases on WorkOrder columns,
   * i.e. Hardwood). Packs that store phases in the JobPhase table leave it out.
   */
  doneAtField?: PhaseDoneField;
  /** Hours the next phase must wait after this one closes (cure time, flood test…). */
  waitAfterHours?: number;
  /** Evidence required to close this phase. */
  requires?: readonly PhaseRequirement[];
  /**
   * Shop lead time: this phase should not happen before `businessDays` (Mon–Fri) after phase
   * `after` closed (Countertops: install ≥ N business days after the slab layout is approved).
   * Shown as the earliest date and a warning when the job is scheduled earlier; it does not block.
   */
  leadTime?: { after: string; businessDays: number };
  /**
   * Only for jobs with this variant on (Tile: "stone" adds receiving, dry-lay and stone sealing).
   * The row exists on every job; it is "skipped" while the variant is off.
   */
  variant?: string;
};

/** A kind of job inside a trade that adds phases (Tile → natural stone). */
export type PackVariant = {
  key: string;
  label: { "pt-BR": string; "en-US": string };
  /** Words in the job's title or service lines that turn it on when the phases are first opened. */
  words: readonly string[];
};

/** What the ObraBuilder plan takeoff measures for this trade (keys are plan legend kinds). */
export type PackTakeoff = {
  /** Legend kinds counted as jobs of this trade. */
  measuredKinds: readonly string[];
  /** Product details each kind asks for, in print order. */
  specFields: Readonly<Record<string, readonly string[]>>;
  specLabels: Readonly<Record<string, string>>;
  /** Default waste % per kind. */
  waste: Readonly<Record<string, number>>;
  /** Suggestions per product field; "field:kind" keys override "field". */
  specSuggestions: Readonly<Record<string, readonly string[]>>;
};

/** One thing a production employee is paid for, counted per job at the end of the day. */
export type PieceItem = {
  key: string;
  label: Record<"pt-BR" | "en-US", string>;
  unit: "sf" | "lf" | "each";
  /** Counts toward the day's square feet (reports, the SF column of the payroll). */
  countsSqft?: boolean;
};

export type TradePack = {
  id: TradeId;
  label: string;
  services: readonly PackService[];
  quote: {
    /** Default PDF tagline under the company name. */
    tagline: string;
    sections: readonly QuoteSectionDef[];
    /**
     * How lines are sorted into sections: the line's name is checked against the rules first, then
     * its service type, then its description; the first rule with a matching word wins and the
     * rest go to `fallbackSection`. Hardwood leaves this out and
     * keeps the original classifier in src/lib/quotes/pdf.ts.
     */
    match?: readonly { section: string; words: readonly string[] }[];
    fallbackSection?: string;
    /** "What's included" on the quote when the company hasn't written its own list. */
    inclusions: readonly string[];
  };
  /**
   * Job phases. The first is the default phase; `combinedKey` is the value a job uses when
   * it runs all phases in sequence (hardwood: "both").
   */
  phases: readonly PhaseDef[];
  /**
   * Where a job's phases live: "columns" = WorkOrder.installationDoneAt / sandDoneAt (Hardwood, as
   * the app always did); "table" = one JobPhase row per phase (trades with more phases).
   */
  phaseStorage: "columns" | "table";
  takeoff: PackTakeoff;
  /**
   * Production pay by item (Tile: floor SF, wall SF, shower pan, niche…). Each item has a company
   * rate and an optional rate per employee. Hardwood leaves this out and keeps SF × one rate.
   */
  payroll?: { pieceItems: readonly PieceItem[] };
  /**
   * ObraBuilder measurement tabs for this trade, in order. Hardwood leaves this out (Stairs, Vents,
   * Plan, Summary); Tile measures showers instead of stairs and vents.
   */
  /** Job variants that add phases (phaseStorage "table" only). */
  variants?: readonly PackVariant[];
  /**
   * Pieces made again on a job (Countertops remakes): the reasons and who answers for them, in the
   * pack's words. Trades without remakes leave this out.
   */
  rework?: {
    reasons: readonly { key: string; label: { "pt-BR": string; "en-US": string } }[];
    responsible: readonly { key: string; label: { "pt-BR": string; "en-US": string } }[];
  };
  /**
   * Stock the company keeps per piece (Countertops: slabs and remnants in the yard). `usedAtPhase`:
   * closing that phase marks the job's reserved slabs as used.
   */
  inventory?: { slabs?: boolean; usedAtPhase?: string };
  measurement?: { tabs: readonly ("stairs" | "vents" | "showers" | "countertops" | "floors" | "summary")[] };
  combinedPhaseKey: string;
  ai: {
    /** How the assistant describes the product's customers, e.g. "flooring installation companies". */
    companyKind: string;
    /** The trade word used inside prompts: "flooring contractor", "flooring jobs", "empresa de flooring". */
    tradeNoun: string;
    /** System prompt for reading a builder's work order / PO / schedule screen into a job request. */
    workOrderPrompt: string;
  };
};
