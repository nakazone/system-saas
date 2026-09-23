/** Default org payment schedule templates (percent-based). */
export type PaymentTemplateItemInput = {
  label: string;
  percent?: number | null;
  fixedAmount?: number | null;
  trigger: "manual" | "on_send" | "on_approve" | "on_phase_start" | "on_phase_complete";
  phaseKey?: string | null;
  sortOrder: number;
};

export const DEFAULT_PAYMENT_TEMPLATES: {
  name: string;
  description: string;
  sortOrder: number;
  items: PaymentTemplateItemInput[];
}[] = [
  {
    name: "50 / 50",
    description: "Deposit on approval, balance on completion",
    sortOrder: 1,
    items: [
      { label: "Deposit", percent: 50, trigger: "on_approve", sortOrder: 1 },
      { label: "Final", percent: 50, trigger: "manual", sortOrder: 2 },
    ],
  },
  {
    name: "30 / 40 / 30",
    description: "Deposit, progress, final",
    sortOrder: 2,
    items: [
      { label: "Deposit", percent: 30, trigger: "on_approve", sortOrder: 1 },
      { label: "Progress", percent: 40, trigger: "on_phase_start", phaseKey: "installation", sortOrder: 2 },
      { label: "Final", percent: 30, trigger: "on_phase_complete", phaseKey: "final_walkthrough", sortOrder: 3 },
    ],
  },
  {
    name: "100% on approval",
    description: "Full payment invoice when quote is approved",
    sortOrder: 3,
    items: [{ label: "Full payment", percent: 100, trigger: "on_approve", sortOrder: 1 }],
  },
];
