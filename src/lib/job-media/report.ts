/**
 * Job field reports from photo proof (Phase 2).
 */
import {
  aiChatJson,
  estimateCostUsd,
  isAiConfigured,
} from "../ai/client.js";

export const JOB_REPORT_TEMPLATES = [
  "site_visit",
  "delivery",
  "progress",
  "maintenance",
] as const;
export type JobReportTemplate = (typeof JOB_REPORT_TEMPLATES)[number];

export type ReportBullet = {
  text: string;
  photo_ids: string[];
};

export type JobReportDraft = {
  title: string;
  summary: string;
  observations: ReportBullet[];
  issues: ReportBullet[];
  recommendations: string[];
  next_steps: string[];
};

export type JobReportRow = {
  id: string;
  workOrderId: string;
  authorId?: string | null;
  templateKey: string;
  title: string;
  status: string;
  summary?: string | null;
  observationsJson?: unknown;
  issuesJson?: unknown;
  recommendationsJson?: unknown;
  nextStepsJson?: unknown;
  photoIds: unknown;
  isPublic: boolean;
  source: string;
  modelUsed?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: unknown;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author?: { name: string } | null;
};

export function isJobReportAiEnabled(featureFlags: unknown): boolean {
  if (!isAiConfigured()) return false;
  if (featureFlags == null) return true;
  if (typeof featureFlags !== "object" || Array.isArray(featureFlags)) return true;
  const flags = featureFlags as Record<string, unknown>;
  if (flags.job_media_ai === false || flags.jobMediaAi === false) return false;
  return true;
}

function asBulletList(v: unknown): ReportBullet[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === "string") return { text: item, photo_ids: [] as string[] };
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const text = String(o.text || o.body || "").trim();
      if (!text) return null;
      const ids = Array.isArray(o.photo_ids)
        ? o.photo_ids.map(String)
        : Array.isArray(o.photoIds)
          ? o.photoIds.map(String)
          : [];
      return { text, photo_ids: ids };
    })
    .filter((x): x is ReportBullet => Boolean(x));
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

function asIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).filter(Boolean);
}

export function mapJobReport(row: JobReportRow) {
  const cost =
    row.costUsd == null
      ? null
      : typeof row.costUsd === "object" && row.costUsd !== null && "toNumber" in row.costUsd
        ? (row.costUsd as { toNumber: () => number }).toNumber()
        : Number(row.costUsd);
  return {
    id: row.id,
    work_order_id: row.workOrderId,
    author_id: row.authorId || null,
    author_name: row.author?.name?.split(/\s+/)[0] || null,
    template_key: row.templateKey,
    title: row.title,
    status: row.status,
    summary: row.summary || "",
    observations: asBulletList(row.observationsJson),
    issues: asBulletList(row.issuesJson),
    recommendations: asStringList(row.recommendationsJson),
    next_steps: asStringList(row.nextStepsJson),
    photo_ids: asIdList(row.photoIds),
    is_public: Boolean(row.isPublic),
    source: row.source,
    model_used: row.modelUsed || null,
    tokens_in: row.tokensIn ?? null,
    tokens_out: row.tokensOut ?? null,
    cost_usd: Number.isFinite(cost) ? cost : null,
    published_at: row.publishedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export type PhotoContext = {
  id: string;
  url: string;
  caption?: string | null;
  stage?: string | null;
  address?: string | null;
  taken_at?: string | null;
  author_name?: string | null;
};

const SYSTEM = `You write concise field job photo reports for US flooring / construction crews.
Return ONLY JSON with keys:
- title: string (short)
- summary: string (2-4 sentences)
- observations: array of { text: string, photo_ids: string[] }
- issues: array of { text: string, photo_ids: string[] }
- recommendations: string[]
- next_steps: string[]
Use American English. Cite photo ids from the provided list when possible.
If photos lack captions, infer carefully from stage labels and say when uncertain.
Do not invent customer names or addresses not in the input.`;

export function buildReportUserPrompt(input: {
  jobTitle: string;
  jobNumber: number | null;
  client: string;
  address: string | null;
  templateKey: JobReportTemplate;
  photos: PhotoContext[];
}): string {
  const lines = input.photos.map((p, i) => {
    const bits = [
      `#${i + 1} id=${p.id}`,
      p.stage ? `stage=${p.stage}` : null,
      p.caption ? `caption=${p.caption}` : null,
      p.address ? `address=${p.address}` : null,
      p.taken_at ? `taken=${p.taken_at}` : null,
      p.author_name ? `by=${p.author_name}` : null,
    ].filter(Boolean);
    return `- ${bits.join(" | ")}`;
  });
  return [
    `Template: ${input.templateKey}`,
    `Job: #${input.jobNumber ?? "—"} ${input.jobTitle}`,
    `Client: ${input.client}`,
    `Site: ${input.address || "n/a"}`,
    `Photos (${input.photos.length}):`,
    ...lines,
    "Write the structured report now.",
  ].join("\n");
}

export async function generateJobReportDraft(input: {
  jobTitle: string;
  jobNumber: number | null;
  client: string;
  address: string | null;
  templateKey: JobReportTemplate;
  photos: PhotoContext[];
}): Promise<
  | {
      ok: true;
      draft: JobReportDraft;
      model: string;
      tokensIn: number | null;
      tokensOut: number | null;
      costUsd: number | null;
    }
  | { ok: false; error: string }
> {
  if (!input.photos.length) {
    return { ok: false, error: "Add at least one photo before generating a report" };
  }

  const imageUrls = input.photos
    .map((p) => p.url)
    .filter((u) => u.startsWith("http") || u.startsWith("data:image/"))
    .slice(0, 6);

  const result = await aiChatJson({
    system: SYSTEM,
    user: buildReportUserPrompt(input),
    imageUrls,
    timeoutMs: 75_000,
  });

  if (!result.ok) return { ok: false, error: result.error };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "AI returned invalid JSON" };
  }

  const draft: JobReportDraft = {
    title: String(parsed.title || `${input.jobTitle} field report`).slice(0, 200),
    summary: String(parsed.summary || "").trim(),
    observations: asBulletList(parsed.observations),
    issues: asBulletList(parsed.issues),
    recommendations: asStringList(parsed.recommendations),
    next_steps: asStringList(parsed.next_steps),
  };

  if (!draft.summary && !draft.observations.length) {
    return { ok: false, error: "AI draft was empty" };
  }

  return {
    ok: true,
    draft,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: estimateCostUsd(result.tokensIn, result.tokensOut),
  };
}

export function parseReportPatch(body: Record<string, unknown>) {
  return {
    title: body.title != null ? String(body.title).slice(0, 200) : undefined,
    summary: body.summary != null ? String(body.summary).slice(0, 8000) : undefined,
    observations:
      body.observations !== undefined ? asBulletList(body.observations) : undefined,
    issues: body.issues !== undefined ? asBulletList(body.issues) : undefined,
    recommendations:
      body.recommendations !== undefined ? asStringList(body.recommendations) : undefined,
    next_steps:
      body.next_steps !== undefined
        ? asStringList(body.next_steps)
        : body.nextSteps !== undefined
          ? asStringList(body.nextSteps)
          : undefined,
    isPublic:
      body.is_public === true || body.isPublic === true
        ? true
        : body.is_public === false || body.isPublic === false
          ? false
          : undefined,
    status:
      body.status === "draft" || body.status === "published"
        ? (body.status as "draft" | "published")
        : undefined,
  };
}
