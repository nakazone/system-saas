export type AutomationSettings = {
  quoteFollowUpEnabled: boolean;
  /** Days after quote send before follow-up email */
  quoteFollowUpDays: number;
  /**
   * After quoteFollowUpDays in quote_sent, move the lead to follow_up_1
   * (same timer as the follow-up email; also sweeps email-less leads).
   */
  quoteSentAutoFollowUpStageEnabled: boolean;
  visitReminderEnabled: boolean;
  /** Hours before visit start for reminder */
  visitReminderHours: number;
  /** Push the job team before scheduledStart */
  jobStartReminderEnabled: boolean;
  /** Minutes before scheduledStart for the reminder push */
  jobStartReminderMinutesBefore: number;
  /** Push again when scheduledStart arrives */
  jobStartAtTimeNudgeEnabled: boolean;
  /**
   * At scheduledStart, set office status scheduled → in_progress.
   * Does not change Campo fieldStatus (crew still confirms en_route / on_site).
   */
  jobStartAutoOfficeStatus: boolean;
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  quoteFollowUpEnabled: true,
  quoteFollowUpDays: 3,
  quoteSentAutoFollowUpStageEnabled: true,
  visitReminderEnabled: true,
  visitReminderHours: 24,
  jobStartReminderEnabled: true,
  jobStartReminderMinutesBefore: 30,
  jobStartAtTimeNudgeEnabled: true,
  jobStartAutoOfficeStatus: true,
};

export function parseAutomationSettings(raw: unknown): AutomationSettings {
  const base = { ...DEFAULT_AUTOMATION_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.quoteFollowUpEnabled === "boolean") base.quoteFollowUpEnabled = o.quoteFollowUpEnabled;
  if (typeof o.quoteFollowUpDays === "number" && o.quoteFollowUpDays >= 0) {
    base.quoteFollowUpDays = Math.min(90, Math.floor(o.quoteFollowUpDays));
  }
  if (typeof o.quoteSentAutoFollowUpStageEnabled === "boolean") {
    base.quoteSentAutoFollowUpStageEnabled = o.quoteSentAutoFollowUpStageEnabled;
  }
  if (typeof o.visitReminderEnabled === "boolean") base.visitReminderEnabled = o.visitReminderEnabled;
  if (typeof o.visitReminderHours === "number" && o.visitReminderHours >= 0) {
    base.visitReminderHours = Math.min(168, Math.floor(o.visitReminderHours));
  }
  if (typeof o.jobStartReminderEnabled === "boolean") {
    base.jobStartReminderEnabled = o.jobStartReminderEnabled;
  }
  if (typeof o.jobStartReminderMinutesBefore === "number" && o.jobStartReminderMinutesBefore >= 0) {
    base.jobStartReminderMinutesBefore = Math.min(24 * 60, Math.floor(o.jobStartReminderMinutesBefore));
  }
  if (typeof o.jobStartAtTimeNudgeEnabled === "boolean") {
    base.jobStartAtTimeNudgeEnabled = o.jobStartAtTimeNudgeEnabled;
  }
  if (typeof o.jobStartAutoOfficeStatus === "boolean") {
    base.jobStartAutoOfficeStatus = o.jobStartAutoOfficeStatus;
  }
  return base;
}

/** Injectable clock for tests. */
export const automationClock = {
  now: (): Date => new Date(),
};
