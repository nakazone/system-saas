import { prisma } from "../prisma.js";
import { currentLegalVersions, legalDocument, LEGAL_KEYS, type LegalKey } from "./documents.js";

export type AcceptanceActor = { id?: string | null; name?: string | null; email?: string | null };

/** Records acceptance of the current version of every legal document for a company. */
export async function recordLegalAcceptance(
  organizationId: string,
  actor: AcceptanceActor,
  meta: { source: "signup" | "in_app" | "master"; ip?: string | null; userAgent?: string | null; versions?: Partial<Record<LegalKey, string>> },
  db: Pick<typeof prisma, "legalAcceptance"> = prisma,
): Promise<void> {
  const current = currentLegalVersions();
  await db.legalAcceptance.createMany({
    data: LEGAL_KEYS.map((document) => ({
      organizationId,
      userId: actor.id || null,
      userName: actor.name || null,
      userEmail: actor.email || null,
      document,
      version: meta.versions?.[document] || current[document],
      source: meta.source,
      ip: meta.ip ? String(meta.ip).slice(0, 80) : null,
      userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 300) : null,
    })),
  });
}

export type LegalStatusRow = {
  document: LegalKey;
  title: string;
  current: string;
  accepted: string | null;
  acceptedAt: Date | null;
  by: string | null;
  source: string | null;
  ip: string | null;
  upToDate: boolean;
};

/** Latest acceptance of each document for a company, compared with the current version. */
export async function legalStatus(organizationId: string): Promise<LegalStatusRow[]> {
  const rows = await prisma.legalAcceptance.findMany({
    where: { organizationId },
    orderBy: { acceptedAt: "desc" },
    take: 60,
  });
  const current = currentLegalVersions();
  return LEGAL_KEYS.map((document) => {
    const last = rows.find((r) => r.document === document && r.version === current[document]) || rows.find((r) => r.document === document) || null;
    return {
      document,
      title: legalDocument(document).title,
      current: current[document],
      accepted: last?.version || null,
      acceptedAt: last?.acceptedAt || null,
      by: last ? last.userName || last.userEmail || null : null,
      source: last?.source || null,
      ip: last?.ip || null,
      upToDate: !!last && last.version === current[document],
    };
  });
}

/** Documents whose current version this company has not accepted yet. */
export async function pendingLegal(organizationId: string): Promise<LegalKey[]> {
  return (await legalStatus(organizationId)).filter((r) => !r.upToDate).map((r) => r.document);
}

/* In-app prompt for companies that already exist (off until the Master turns it on in Cadastros). */
const PROMPT_KEY = "platform.legal_prompt";

export async function legalPromptEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PROMPT_KEY } }).catch(() => null);
  try {
    return row ? (JSON.parse(row.value) as { enabled?: boolean }).enabled === true : false;
  } catch {
    return false;
  }
}

export async function setLegalPrompt(enabled: boolean): Promise<void> {
  const value = JSON.stringify({ enabled });
  await prisma.systemSetting.upsert({ where: { key: PROMPT_KEY }, create: { key: PROMPT_KEY, value }, update: { value } });
}
