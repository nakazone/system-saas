export type AutomationSettings = {
  quoteFollowUpEnabled: boolean;
  /** Days after quote send before follow-up email */
  quoteFollowUpDays: number;
  visitReminderEnabled: boolean;
  /** Hours before visit start for reminder */
  visitReminderHours: number;
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  quoteFollowUpEnabled: true,
  quoteFollowUpDays: 3,
  visitReminderEnabled: true,
  visitReminderHours: 24,
};

export function parseAutomationSettings(raw: unknown): AutomationSettings {
  const base = { ...DEFAULT_AUTOMATION_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.quoteFollowUpEnabled === "boolean") base.quoteFollowUpEnabled = o.quoteFollowUpEnabled;
  if (typeof o.quoteFollowUpDays === "number" && o.quoteFollowUpDays >= 0) {
    base.quoteFollowUpDays = Math.min(90, Math.floor(o.quoteFollowUpDays));
  }
  if (typeof o.visitReminderEnabled === "boolean") base.visitReminderEnabled = o.visitReminderEnabled;
  if (typeof o.visitReminderHours === "number" && o.visitReminderHours >= 0) {
    base.visitReminderHours = Math.min(168, Math.floor(o.visitReminderHours));
  }
  return base;
}

/** Injectable clock for tests. */
export const automationClock = {
  now: (): Date => new Date(),
};
