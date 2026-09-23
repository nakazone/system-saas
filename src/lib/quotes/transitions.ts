export type QuoteStatus =
  | "draft"
  | "sent"
  | "changes_requested"
  | "approved"
  | "converted"
  | "archived"
  | "expired";

export type QuoteEvent =
  | "send"
  | "request_changes"
  | "resend"
  | "approve"
  | "convert"
  | "archive"
  | "expire"
  | "renew";

/** Normalize legacy CRM statuses to Phase 2 vocabulary. */
export function normalizeQuoteStatus(status: string): QuoteStatus {
  if (status === "accepted" || status === "invoiced") return "approved";
  if (status === "rejected") return "archived";
  return status as QuoteStatus;
}

const TRANSITIONS: Record<QuoteStatus, Partial<Record<QuoteEvent, QuoteStatus>>> = {
  draft: {
    send: "sent",
  },
  sent: {
    request_changes: "changes_requested",
    approve: "approved",
    archive: "archived",
    expire: "expired",
  },
  changes_requested: {
    resend: "sent",
    send: "sent",
    approve: "approved",
    archive: "archived",
    expire: "expired",
  },
  approved: {
    convert: "converted",
    archive: "archived",
  },
  converted: {},
  archived: {},
  expired: {
    renew: "sent",
  },
};

export type TransitionResult =
  | { ok: true; next: QuoteStatus }
  | { ok: false; error: string };

/**
 * Pure quote status machine. Callers persist the result and record ActivityEvent.
 */
export function transitionQuote(current: string, event: QuoteEvent): TransitionResult {
  const from = normalizeQuoteStatus(current);
  const next = TRANSITIONS[from]?.[event];
  if (!next) {
    return {
      ok: false,
      error: `Invalid transition: cannot ${event} from status "${from}"`,
    };
  }
  if (event === "archive" && from === "draft") {
    return { ok: false, error: "Draft quotes cannot be archived; delete or send them" };
  }
  return { ok: true, next };
}

export function canTransition(current: string, event: QuoteEvent): boolean {
  return transitionQuote(current, event).ok;
}
