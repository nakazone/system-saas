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

export const TRADE_IDS = ["hardwood"] as const;
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

/** A job phase that has its own crew, calendar and payroll period (hardwood: Instalação / Lixa). */
export type PhaseDef = {
  key: string;
  label: { "pt-BR": string; "en-US": string };
};

export type TradePack = {
  id: TradeId;
  label: string;
  services: readonly PackService[];
  quote: {
    /** Default PDF tagline under the company name. */
    tagline: string;
    sections: readonly QuoteSectionDef[];
  };
  /**
   * Job phases. The first is the default phase; `combinedKey` is the value a job uses when
   * it runs all phases in sequence (hardwood: "both").
   */
  phases: readonly PhaseDef[];
  combinedPhaseKey: string;
  ai: {
    /** How the assistant describes the product's customers, e.g. "flooring installation companies". */
    companyKind: string;
  };
};
