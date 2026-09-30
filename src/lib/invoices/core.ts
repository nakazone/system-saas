/**
 * Invoice module — pure helpers (no DB). Amounts are handled in cents to avoid float drift.
 */

export type InvoiceKind = "deposit" | "progress" | "final" | "full" | "custom" | "other";

/** Status shown in the UI. `overdue` is derived (never stored). */
export type InvoiceDisplayStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "partially_paid"
  | "overdue"
  | "paid"
  | "void";

const cents = (n: unknown): number => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) : 0;
};
const money = (c: number): number => Math.round(c) / 100;

export type InvoiceMoneyInput = {
  status: string;
  amount: unknown;
  dueDate?: Date | string | null;
  viewedAt?: Date | string | null;
  receipts: { amount: unknown }[];
};

export type InvoiceMoney = {
  amount: number;
  paid: number;
  balance: number;
  /** 0–100 */
  percentPaid: number;
  isOverdue: boolean;
  daysOverdue: number;
  displayStatus: InvoiceDisplayStatus;
};

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function computeInvoiceMoney(inv: InvoiceMoneyInput, now: Date = new Date()): InvoiceMoney {
  const amountC = cents(inv.amount);
  const paidC = inv.receipts.reduce((s, r) => s + cents(r.amount), 0);
  const balanceC = Math.max(0, amountC - paidC);
  const stored = String(inv.status || "draft").toLowerCase();

  let displayStatus: InvoiceDisplayStatus;
  if (stored === "void") displayStatus = "void";
  else if (amountC > 0 && paidC >= amountC) displayStatus = "paid";
  else if (stored === "paid" && amountC === 0) displayStatus = "paid";
  else if (paidC > 0) displayStatus = "partially_paid";
  else if (stored === "draft") displayStatus = "draft";
  else if (inv.viewedAt) displayStatus = "viewed";
  else displayStatus = "sent";

  let isOverdue = false;
  let daysOverdue = 0;
  if (inv.dueDate && balanceC > 0 && displayStatus !== "void" && displayStatus !== "draft") {
    const due = startOfUtcDay(new Date(inv.dueDate));
    const today = startOfUtcDay(now);
    if (today > due) {
      isOverdue = true;
      daysOverdue = Math.round((today - due) / 86400000);
    }
  }
  if (isOverdue) displayStatus = "overdue";

  return {
    amount: money(amountC),
    paid: money(paidC),
    balance: money(balanceC),
    percentPaid: amountC > 0 ? Math.min(100, Math.round((paidC / amountC) * 100)) : 0,
    isOverdue,
    daysOverdue,
    displayStatus,
  };
}

/** Stored status after payments change (never returns `overdue`). */
export function storedStatusAfterPayments(params: {
  currentStatus: string;
  amount: unknown;
  paidTotal: unknown;
}): "draft" | "sent" | "partially_paid" | "paid" | "void" {
  const s = String(params.currentStatus || "draft");
  if (s === "void") return "void";
  const a = cents(params.amount);
  const p = cents(params.paidTotal);
  if (a > 0 && p >= a) return "paid";
  if (p > 0) return "partially_paid";
  // Payment removed: an invoice that had been paid/partial was already with the client.
  if (s === "paid" || s === "partially_paid") return "sent";
  return s === "draft" ? "draft" : "sent";
}

export type NewInvoiceAmountInput = {
  kind: string;
  quoteTotal: number;
  /** Sum of non-void invoices already issued for the quote. */
  invoicedTotal: number;
  depositPct?: number | null;
  customAmount?: number | null;
  /** What is being billed — only changes the wording of errors. Default: quote. */
  source?: "quote" | "job";
};

export type NewInvoiceAmount =
  | { ok: true; amount: number; kind: InvoiceKind; label: string }
  | { ok: false; error: string };

/** Amount for a new invoice issued from an approved quote. Never exceeds what is left to invoice. */
export function computeNewInvoiceAmount(input: NewInvoiceAmountInput): NewInvoiceAmount {
  const totalC = cents(input.quoteTotal);
  const remainingC = Math.max(0, totalC - cents(input.invoicedTotal));
  const isJob = input.source === "job";
  if (totalC <= 0) {
    return {
      ok: false,
      error: isJob
        ? "O job não tem valor — adicione os serviços (Tabela de Valores) antes de faturar."
        : "O orçamento não tem valor total.",
    };
  }
  if (remainingC <= 0) {
    return { ok: false, error: isJob ? "Todo o valor deste job já foi faturado." : "Todo o valor deste orçamento já foi faturado." };
  }

  const kind = String(input.kind || "").toLowerCase();
  let amountC: number;
  let finalKind: InvoiceKind;
  let label: string;

  switch (kind) {
    case "deposit": {
      const pct = Number(input.depositPct ?? 50);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return { ok: false, error: "Percentual do depósito deve estar entre 1 e 100." };
      }
      amountC = Math.round((totalC * pct) / 100);
      finalKind = "deposit";
      label = `Deposit (${Number(pct.toFixed(2))}%)`;
      break;
    }
    case "final":
      amountC = remainingC;
      finalKind = "final";
      label = "Final balance";
      break;
    case "full":
      if (remainingC !== totalC) {
        return {
          ok: false,
          error: `Já existem faturas neste ${isJob ? "job" : "orçamento"} — use "Saldo restante".`,
        };
      }
      amountC = totalC;
      finalKind = "full";
      label = "Full payment";
      break;
    case "progress":
    case "custom":
    case "other": {
      amountC = cents(input.customAmount);
      if (amountC <= 0) return { ok: false, error: "Informe o valor da fatura." };
      finalKind = kind === "progress" ? "progress" : "custom";
      label = kind === "progress" ? "Progress payment" : "Payment";
      break;
    }
    default:
      return { ok: false, error: "Tipo de fatura inválido." };
  }

  if (amountC > remainingC) {
    return {
      ok: false,
      error: `Valor acima do que falta faturar ($${money(remainingC).toFixed(2)}).`,
    };
  }
  return { ok: true, amount: money(amountC), kind: finalKind, label };
}

export type PaymentAmountInput = {
  mode?: string | null;
  amount?: unknown;
  balance: number;
};

/** Resolve the amount of a payment. `mode: "full"` always settles the open balance. */
export function resolvePaymentAmount(
  input: PaymentAmountInput,
): { ok: true; amount: number; settles: boolean } | { ok: false; error: string } {
  const balC = cents(input.balance);
  if (balC <= 0) return { ok: false, error: "Esta fatura não tem saldo em aberto." };
  if (String(input.mode || "").toLowerCase() === "full") {
    return { ok: true, amount: money(balC), settles: true };
  }
  const aC = cents(input.amount);
  if (aC <= 0) return { ok: false, error: "Informe o valor recebido." };
  if (aC > balC) {
    return { ok: false, error: `Valor acima do saldo em aberto ($${money(balC).toFixed(2)}).` };
  }
  return { ok: true, amount: money(aC), settles: aC === balC };
}

export const PAYMENT_METHOD_LABELS: Record<string, { pt: string; en: string }> = {
  check: { pt: "Cheque", en: "Check" },
  zelle: { pt: "Zelle", en: "Zelle" },
  venmo: { pt: "Venmo", en: "Venmo" },
  ach: { pt: "ACH / transferência", en: "Bank transfer (ACH)" },
  bank_transfer: { pt: "Transferência", en: "Bank transfer" },
  credit_card: { pt: "Cartão", en: "Card" },
  card: { pt: "Cartão", en: "Card" },
  cash: { pt: "Dinheiro", en: "Cash" },
  financing: { pt: "Financiamento", en: "Financing" },
  other: { pt: "Outro", en: "Other" },
};

export function paymentMethodLabel(method: string | null | undefined, lang: "pt" | "en" = "en"): string {
  const k = String(method || "").toLowerCase();
  return PAYMENT_METHOD_LABELS[k]?.[lang] || (method ? String(method) : lang === "pt" ? "—" : "—");
}

export function invoiceKindLabel(kind: string | null | undefined, lang: "pt" | "en" = "en"): string {
  const map: Record<string, { pt: string; en: string }> = {
    deposit: { pt: "Depósito", en: "Deposit" },
    progress: { pt: "Parcela", en: "Progress payment" },
    final: { pt: "Saldo final", en: "Final balance" },
    full: { pt: "Valor total", en: "Full payment" },
    custom: { pt: "Personalizada", en: "Invoice" },
    other: { pt: "Fatura", en: "Invoice" },
  };
  return map[String(kind || "other")]?.[lang] || map.other![lang];
}
