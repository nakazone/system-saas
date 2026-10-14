import { prisma } from "../prisma.js";
import { sendPlatformEmail, templateDef, dateVar, type Vars, type VarValue } from "../email/templates.js";
import { daysUntil, ymdInTz, planLabel, cyclePriceCents, money } from "../../master/lib.js";
import { plans } from "../../master/plans.js";
import { workspacePage } from "./stripe.js";
import { systemAudit } from "./audit.js";

/**
 * Billing ladder (régua de cobrança), run once a day.
 *
 * Every step is relative to the company's due date (trial end, or end of the paid
 * period) and is recorded in DunningStep, so it happens once per due date; paying
 * moves the due date and the ladder starts over. Status only ever moves down here
 * (trial/active → past_due → read_only → suspended → canceled); paying or the
 * Master moves it back up.
 */

export type LadderConfig = {
  enabled: boolean;
  /** E-mails before the trial ends (days before). */
  trialReminders: number[];
  /** E-mails before a renewal, for companies paying outside Stripe (days before). */
  renewReminders: number[];
  /** Days after the due date. */
  pastDueAt: number;
  overdueReminders: number[];
  readOnlyAt: number;
  suspendAt: number;
  cancelAt: number;
  /** Extra days for companies with a card in Stripe (Stripe retries first). */
  stripeGraceDays: number;
};

export const DEFAULT_LADDER: LadderConfig = {
  enabled: false, // off until the Master turns it on (Vencimentos › Configurar)
  trialReminders: [7, 3, 1],
  renewReminders: [7],
  pastDueAt: 1,
  overdueReminders: [3],
  readOnlyAt: 7,
  suspendAt: 14,
  cancelAt: 90,
  stripeGraceDays: 3,
};

const SETTING_KEY = "platform.billing_ladder";

export async function loadLadder(): Promise<LadderConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  if (!row) return { ...DEFAULT_LADDER };
  try {
    return { ...DEFAULT_LADDER, ...(JSON.parse(row.value) as Partial<LadderConfig>) };
  } catch {
    return { ...DEFAULT_LADDER };
  }
}

export async function saveLadder(cfg: LadderConfig): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: JSON.stringify(cfg) }, update: { value: JSON.stringify(cfg) } });
}

/** The ladder as human steps, for the Master screen. */
export function ladderSteps(cfg: LadderConfig): { group: "trial" | "paid"; when: string; what: string; kind: "email" | "state" }[] {
  type Row = { group: "trial" | "paid"; when: string; what: string; kind: "email" | "state"; sort: number };
  const out: Row[] = [];
  for (const d of cfg.trialReminders) out.push({ group: "trial", when: `D-${d}`, what: "E-mail: teste acaba", kind: "email", sort: -d });
  out.push({ group: "trial", when: "D0", what: "Só leitura + e-mail", kind: "state", sort: 0 });
  out.push({ group: "trial", when: `D+${cfg.suspendAt}`, what: "Suspensa + e-mail", kind: "state", sort: cfg.suspendAt });
  out.push({ group: "trial", when: `D+${cfg.cancelAt}`, what: "Cancelada", kind: "state", sort: cfg.cancelAt });
  for (const d of cfg.renewReminders) out.push({ group: "paid", when: `D-${d}`, what: "E-mail: renova em breve (sem cartão)", kind: "email", sort: -d });
  out.push({ group: "paid", when: `D+${cfg.pastDueAt}`, what: "Atrasado + e-mail", kind: "state", sort: cfg.pastDueAt });
  for (const d of cfg.overdueReminders) out.push({ group: "paid", when: `D+${d}`, what: "E-mail: em atraso", kind: "email", sort: d });
  out.push({ group: "paid", when: `D+${cfg.readOnlyAt}`, what: "Só leitura + e-mail", kind: "state", sort: cfg.readOnlyAt });
  out.push({ group: "paid", when: `D+${cfg.suspendAt}`, what: "Suspensa + e-mail", kind: "state", sort: cfg.suspendAt });
  out.push({ group: "paid", when: `D+${cfg.cancelAt}`, what: "Cancelada", kind: "state", sort: cfg.cancelAt });
  return out.sort((a, b) => (a.group === b.group ? a.sort - b.sort : a.group === "trial" ? -1 : 1)).map(({ sort: _s, ...r }) => r);
}

type Step = { key: string; offset: number; action: "email" | "state"; to?: string; template: Template };
type Template = "trial_ending" | "trial_ended" | "renewal_soon" | "past_due" | "overdue" | "read_only" | "suspended" | "none";

function stepsFor(kind: "trial" | "paid", cfg: LadderConfig): Step[] {
  if (kind === "trial") {
    return [
      ...cfg.trialReminders.map((d) => ({ key: `trial-${d}`, offset: -d, action: "email" as const, template: "trial_ending" as const })),
      { key: "trial+0", offset: 0, action: "state", to: "read_only", template: "trial_ended" },
      { key: `trial+${cfg.suspendAt}`, offset: cfg.suspendAt, action: "state", to: "suspended", template: "suspended" },
      { key: `trial+${cfg.cancelAt}`, offset: cfg.cancelAt, action: "state", to: "canceled", template: "none" },
    ];
  }
  return [
    ...cfg.renewReminders.map((d) => ({ key: `due-${d}`, offset: -d, action: "email" as const, template: "renewal_soon" as const })),
    { key: `due+${cfg.pastDueAt}`, offset: cfg.pastDueAt, action: "state", to: "past_due", template: "past_due" },
    ...cfg.overdueReminders.map((d) => ({ key: `due+${d}r`, offset: d, action: "email" as const, template: "overdue" as const })),
    { key: `due+${cfg.readOnlyAt}`, offset: cfg.readOnlyAt, action: "state", to: "read_only", template: "read_only" },
    { key: `due+${cfg.suspendAt}`, offset: cfg.suspendAt, action: "state", to: "suspended", template: "suspended" },
    { key: `due+${cfg.cancelAt}`, offset: cfg.cancelAt, action: "state", to: "canceled", template: "none" },
  ];
}

const RANK: Record<string, number> = { trial: 0, active: 0, past_due: 1, read_only: 2, suspended: 3, canceled: 4 };

type OrgRow = Awaited<ReturnType<typeof candidates>>[number];

async function candidates() {
  return prisma.organization.findMany({
    where: { status: { in: ["trial", "active", "past_due", "read_only", "suspended"] } },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      billingCycle: true,
      planPriceCents: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      stripeSubscriptionId: true,
      cancelAtPeriodEnd: true,
      dunningPausedUntil: true,
      billingContactEmail: true,
      readOnlySince: true,
      suspendedAt: true,
    },
  });
}

async function recipient(org: OrgRow): Promise<{ email: string; name: VarValue } | null> {
  if (org.billingContactEmail) return { email: org.billingContactEmail, name: { en: "there", pt: "equipe" } };
  const owner = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { key: "admin" }, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { email: true, name: true },
  });
  return owner ? { email: owner.email, name: owner.name.split(" ")[0] || owner.name } : null;
}

const TEMPLATE_KEY: Record<Exclude<Template, "none">, string> = {
  trial_ending: "trial_ending",
  trial_ended: "trial_ended",
  renewal_soon: "renewal_soon",
  past_due: "payment_overdue",
  overdue: "payment_overdue",
  read_only: "account_read_only",
  suspended: "account_suspended",
};

/** Template + values for a ladder step (text lives in Master › Comunicação › Modelos de e-mail). */
export function ladderEmail(t: Template, org: OrgRow, due: Date, name: VarValue): { key: string; vars: Vars } | null {
  if (t === "none") return null;
  const cycle = org.billingCycle === "annual";
  const amount = money(cyclePriceCents(org));
  const left = Math.max(0, daysUntil(due) ?? 0);
  const trialNoSub = org.status === "trial" || !org.currentPeriodEnd;
  const vars: Vars = {
    name,
    company: org.name,
    date: dateVar(due),
    link: workspacePage(org.slug),
    plan: planLabel(org.plan),
    price: { en: `${amount}/${cycle ? "year" : "month"}`, pt: `${amount}/${cycle ? "ano" : "mês"}` },
    ends_in: left <= 1 ? { en: "tomorrow", pt: "amanhã" } : { en: `in ${left} days`, pt: `em ${left} dias` },
    reason: trialNoSub
      ? { en: "the trial ended without a subscription", pt: "o teste acabou sem assinatura" }
      : { en: "the payment is still open", pt: "o pagamento continua em aberto" },
  };
  return { key: TEMPLATE_KEY[t], vars };
}

export type LadderResult = { checked: number; emails: number; changes: { org: string; to: string }[]; skipped: number };

/** Runs the ladder for every company. `now` is injectable for tests. */
export async function runBillingLadder(now = new Date(), opts: { dryRun?: boolean } = {}): Promise<LadderResult> {
  const cfg = await loadLadder();
  const result: LadderResult = { checked: 0, emails: 0, changes: [], skipped: 0 };
  if (!cfg.enabled) return result;
  await plans(); // prices for the e-mails
  for (const org of await candidates()) {
    if (org.dunningPausedUntil && org.dunningPausedUntil > now) {
      result.skipped++;
      continue;
    }
    // Trial without a paid period → trial ladder; otherwise the paid period ladder.
    const isTrial = org.status === "trial" || (!org.currentPeriodEnd && !!org.trialEndsAt);
    const due = isTrial ? org.trialEndsAt : org.currentPeriodEnd;
    if (!due) continue;
    result.checked++;
    const days = daysUntil(due, now)!;
    const cardOnFile = !!org.stripeSubscriptionId && !org.cancelAtPeriodEnd;
    const grace = cardOnFile ? cfg.stripeGraceDays : 0;
    const dueKey = ymdInTz(due);
    const done = new Set(
      (await prisma.dunningStep.findMany({ where: { organizationId: org.id, dueKey }, select: { step: true } })).map((s) => s.step),
    );
    const applicable = stepsFor(isTrial ? "trial" : "paid", cfg)
      .map((s) => ({ ...s, offset: s.action === "state" && s.offset >= 0 ? s.offset + grace : s.offset }))
      .sort((a, b) => a.offset - b.offset)
      .filter((s) => -days >= s.offset && !done.has(s.key));
    if (!applicable.length) continue;
    // The status goes to the deepest state reached (never up).
    let status = org.status;
    for (const s of applicable) if (s.action === "state" && s.to && (RANK[s.to] ?? 0) > (RANK[status] ?? 0)) status = s.to;
    // One e-mail per run, for the most recent step: a late run never sends a pile of old e-mails.
    const last = applicable[applicable.length - 1];
    for (const s of applicable) {
      let action = s.action === "state" && s.to === status && status !== org.status ? "state" : "skipped";
      let detail: string | null = action === "state" ? `${org.status} → ${status}` : null;
      const sendable =
        s === last &&
        s.template !== "none" &&
        !(s.template === "renewal_soon" && cardOnFile) &&
        // A state step only e-mails when it changed the status; reminders only while the account is not further down.
        (s.action === "state" ? action === "state" : (RANK[status] ?? 0) <= RANK.past_due);
      if (sendable && !opts.dryRun) {
        const to = await recipient(org);
        const msg = to ? ladderEmail(s.template, org, due, to.name) : null;
        if (to && msg) {
          const out = await sendPlatformEmail(msg.key, { to: to.email, organizationId: org.id, vars: msg.vars }).catch((e) => {
            console.error("[ladder] email failed", e);
            return null;
          });
          result.emails++;
          if (action !== "state") action = "email";
          const name = templateDef(msg.key)?.name ?? msg.key;
          detail = `${detail ? detail + " · " : ""}${name} → ${to.email}${out?.skipped ? " (bloqueado)" : ""}`;
        }
      }
      if (!opts.dryRun) {
        await prisma.dunningStep.create({ data: { organizationId: org.id, dueKey, step: s.key, action, detail } }).catch(() => undefined);
      }
    }
    if (status !== org.status) {
      result.changes.push({ org: org.name, to: status });
      if (!opts.dryRun) {
        await prisma.organization.update({
          where: { id: org.id },
          data: {
            status,
            ...(status === "read_only" && !org.readOnlySince ? { readOnlySince: now } : {}),
            ...(status === "suspended" ? { suspendedAt: now } : {}),
            ...(status === "canceled" ? { canceledAt: now, cancelReason: isTrial ? "Teste terminou sem assinatura" : "Pagamento não feito" } : {}),
          },
        });
        if (status === "canceled") {
          await prisma.cancellationEvent
            .create({ data: { organizationId: org.id, orgName: org.name, source: "system", reasonKey: isTrial ? "trial_ended" : "not_paid", mrrCents: 0, byName: "Régua de cobrança" } })
            .catch(() => undefined);
        }
        if (status === "suspended" || status === "canceled") {
          await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'organizationId' = ${org.id}`.catch(() => 0);
        }
        await systemAudit(`ladder.${status}`, { type: "organization", id: org.id, label: org.name, meta: { from: org.status, to: status, due: dueKey, daysAfterDue: -days } });
      }
    }
  }
  return result;
}
