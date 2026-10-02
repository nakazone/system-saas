/**
 * Configurações › Dados da empresa — validation, serialization and the
 * "Configuração da empresa" setup checklist shown on the settings overview.
 */
import { z } from "zod";
import { formatUsPhone } from "../phone.js";

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export type DayHours = { open: boolean; start: string; end: string };
export type BusinessHours = Record<WeekDay, DayHours>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { open: true, start: "07:00", end: "17:00" },
  tue: { open: true, start: "07:00", end: "17:00" },
  wed: { open: true, start: "07:00", end: "17:00" },
  thu: { open: true, start: "07:00", end: "17:00" },
  fri: { open: true, start: "07:00", end: "17:00" },
  sat: { open: false, start: "08:00", end: "12:00" },
  sun: { open: false, start: "08:00", end: "12:00" },
};

export const LOCALES = ["pt-BR", "en", "es"] as const;
export const AREA_UNITS = ["sq_ft", "m2"] as const;
export const WEEK_STARTS = ["monday", "sunday"] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Normalize whatever is stored (or missing) into a full 7-day schedule. */
export function parseBusinessHours(raw: unknown): BusinessHours {
  const out: BusinessHours = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_HOURS));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const day of WEEK_DAYS) {
    const d = o[day];
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    if (typeof r.open === "boolean") out[day].open = r.open;
    if (typeof r.start === "string" && TIME_RE.test(r.start)) out[day].start = r.start;
    if (typeof r.end === "string" && TIME_RE.test(r.end)) out[day].end = r.end;
  }
  return out;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

const optUrl = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (!v) return null;
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withScheme);
      if (!u.hostname.includes(".")) throw new Error("host");
      return u.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "Endereço de site inválido" });
      return z.NEVER;
    }
  });

const optDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      ctx.addIssue({ code: "custom", message: "Data inválida" });
      return z.NEVER;
    }
    return new Date(`${v}T00:00:00Z`);
  });

const dayHoursSchema = z
  .object({
    open: z.boolean(),
    start: z.string().regex(TIME_RE, "Horário inválido"),
    end: z.string().regex(TIME_RE, "Horário inválido"),
  })
  .refine((d) => !d.open || d.start < d.end, { message: "O fechamento precisa ser depois da abertura" });

/** PATCH body (snake_case, every field optional — only sent fields change). */
export const organizationSettingsPatchSchema = z
  .object({
    name: z.string().trim().min(2, "Nome muito curto").max(120).optional(),
    legal_name: optText(160),
    contact_phone: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return undefined;
        if (!v) return null;
        const digits = v.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 15) {
          ctx.addIssue({ code: "custom", message: "Telefone precisa ter DDD e número" });
          return z.NEVER;
        }
        let d = digits;
        if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
        if (d.length === 10) {
          return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
        }
        return v;
      }),
    contact_email: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return undefined;
        if (!v) return null;
        if (!z.string().email().safeParse(v).success) {
          ctx.addIssue({ code: "custom", message: "E-mail inválido" });
          return z.NEVER;
        }
        return v.toLowerCase();
      }),
    website: optUrl,
    address_line1: optText(200),
    address_line2: optText(200),
    city: optText(120),
    state: optText(60),
    postal_code: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return undefined;
        if (!v) return null;
        if (!/^[A-Za-z0-9 -]{3,10}$/.test(v)) {
          ctx.addIssue({ code: "custom", message: "CEP/ZIP inválido" });
          return z.NEVER;
        }
        return v.toUpperCase();
      }),
    country: z.string().trim().length(2).toUpperCase().optional(),
    address_private: z.boolean().optional(),
    license_number: optText(60),
    license_state: optText(60),
    license_expires_on: optDate,
    show_license_on_documents: z.boolean().optional(),
    insurance_carrier: optText(120),
    insurance_policy: optText(80),
    insurance_expires_on: optDate,
    business_hours: z
      .object(Object.fromEntries(WEEK_DAYS.map((d) => [d, dayHoursSchema])) as Record<WeekDay, typeof dayHoursSchema>)
      .optional(),
    timezone: z
      .string()
      .trim()
      .optional()
      .refine((v) => v === undefined || isValidTimeZone(v), "Fuso horário inválido"),
    default_locale: z.enum(LOCALES).optional(),
    area_unit: z.enum(AREA_UNITS).optional(),
    week_start: z.enum(WEEK_STARTS).optional(),
    google_review_url: optUrl,
  })
  .strict();

export type OrganizationSettingsPatch = z.infer<typeof organizationSettingsPatchSchema>;

/** snake_case body key → Prisma column. */
export const PATCH_FIELD_MAP: Record<keyof OrganizationSettingsPatch, string> = {
  name: "name",
  legal_name: "legalName",
  contact_phone: "contactPhone",
  contact_email: "contactEmail",
  website: "website",
  address_line1: "addressLine1",
  address_line2: "addressLine2",
  city: "city",
  state: "state",
  postal_code: "postalCode",
  country: "country",
  address_private: "addressPrivate",
  license_number: "licenseNumber",
  license_state: "licenseState",
  license_expires_on: "licenseExpiresOn",
  show_license_on_documents: "showLicenseOnDocuments",
  insurance_carrier: "insuranceCarrier",
  insurance_policy: "insurancePolicy",
  insurance_expires_on: "insuranceExpiresOn",
  business_hours: "businessHours",
  timezone: "timezone",
  default_locale: "defaultLocale",
  area_unit: "areaUnit",
  week_start: "weekStart",
  google_review_url: "googleReviewUrl",
};

/** Flatten zod issues into { field: message } for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export type OrganizationSettingsRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  legalName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  addressPrivate: boolean;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiresOn: Date | null;
  showLicenseOnDocuments: boolean;
  insuranceCarrier: string | null;
  insurancePolicy: string | null;
  insuranceExpiresOn: Date | null;
  insuranceCertificateUrl: string | null;
  businessHours: unknown;
  timezone: string;
  defaultLocale: string;
  areaUnit: string;
  weekStart: string;
  googleReviewUrl: string | null;
  updatedAt: Date;
};

export const ORGANIZATION_SETTINGS_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  legalName: true,
  contactPhone: true,
  contactEmail: true,
  website: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  addressPrivate: true,
  licenseNumber: true,
  licenseState: true,
  licenseExpiresOn: true,
  showLicenseOnDocuments: true,
  insuranceCarrier: true,
  insurancePolicy: true,
  insuranceExpiresOn: true,
  insuranceCertificateUrl: true,
  businessHours: true,
  timezone: true,
  defaultLocale: true,
  areaUnit: true,
  weekStart: true,
  googleReviewUrl: true,
  updatedAt: true,
} as const;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function serializeOrganizationSettings(o: OrganizationSettingsRow) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    logo_url: o.logoUrl,
    legal_name: o.legalName,
    contact_phone: formatUsPhone(o.contactPhone),
    contact_email: o.contactEmail,
    website: o.website,
    address_line1: o.addressLine1,
    address_line2: o.addressLine2,
    city: o.city,
    state: o.state,
    postal_code: o.postalCode,
    country: o.country,
    address_private: o.addressPrivate,
    license_number: o.licenseNumber,
    license_state: o.licenseState,
    license_expires_on: isoDate(o.licenseExpiresOn),
    show_license_on_documents: o.showLicenseOnDocuments,
    insurance_carrier: o.insuranceCarrier,
    insurance_policy: o.insurancePolicy,
    insurance_expires_on: isoDate(o.insuranceExpiresOn),
    insurance_certificate_url: o.insuranceCertificateUrl,
    business_hours: parseBusinessHours(o.businessHours),
    timezone: o.timezone,
    default_locale: o.defaultLocale,
    area_unit: o.areaUnit,
    week_start: o.weekStart,
    google_review_url: o.googleReviewUrl,
    updated_at: o.updatedAt.toISOString(),
  };
}

/** One-line address for documents, or null when private/incomplete. */
export function documentAddressLine(o: {
  addressPrivate: boolean;
  addressLine1: string | null;
  addressLine2?: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}): string | null {
  if (o.addressPrivate || !o.addressLine1) return null;
  const street = [o.addressLine1, o.addressLine2].filter(Boolean).join(", ");
  const cityLine = [o.city, [o.state, o.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, cityLine].filter(Boolean).join(" · ");
}

export function documentLicenseLine(o: {
  showLicenseOnDocuments: boolean;
  licenseNumber: string | null;
  licenseState: string | null;
}): string | null {
  if (!o.showLicenseOnDocuments || !o.licenseNumber) return null;
  return `License ${o.licenseState ? `${o.licenseState} ` : ""}#${o.licenseNumber}`;
}

// ---------------------------------------------------------------------------
// Setup checklist ("Configuração da empresa · 6 de 8")

export type SetupFacts = {
  hasLogo: boolean;
  hasContact: boolean;
  hasAddress: boolean;
  hasLicense: boolean;
  hasQuoteTerms?: boolean;
  pricingCount: number;
  activeUsers: number;
  quoteCount: number;
  viewerHasPush: boolean;
};

export type SetupStep = { key: string; label: string; done: boolean; href: string; perm: string | null };

export function buildSetupSteps(f: SetupFacts): SetupStep[] {
  return [
    { key: "logo", label: "Logo e cores", done: f.hasLogo, href: "configuracoes.html#marca", perm: "settings.manage" },
    { key: "contact", label: "Telefone e e-mail", done: f.hasContact, href: "configuracoes.html#empresa", perm: "settings.manage" },
    { key: "address", label: "Endereço", done: f.hasAddress, href: "configuracoes.html#empresa", perm: "settings.manage" },
    { key: "license", label: "Licença de contratante", done: f.hasLicense, href: "configuracoes.html#empresa", perm: "settings.manage" },
    { key: "terms", label: "Termos do orçamento", done: Boolean(f.hasQuoteTerms), href: "configuracoes.html#orcamentos", perm: "settings.manage" },
    { key: "pricing", label: "Tabela de preços", done: f.pricingCount > 0, href: "builder-pricing-admin.html", perm: "builders.view" },
    { key: "team", label: "Convidar a equipe", done: f.activeUsers > 1, href: "equipe.html", perm: "users.view" },
    { key: "quote", label: "Primeiro orçamento", done: f.quoteCount > 0, href: "quote-builder.html", perm: "quotes.create" },
    { key: "push", label: "Alertas no celular", done: f.viewerHasPush, href: "configuracoes.html#app", perm: null },
  ];
}

export type ExpiryAlert = { key: "license" | "insurance"; label: string; expires_on: string; days_left: number };

/** License / insurance that expire within `withinDays` (or already expired). */
export function expiryAlerts(
  o: { licenseExpiresOn: Date | null; insuranceExpiresOn: Date | null },
  now: Date,
  withinDays = 30,
): ExpiryAlert[] {
  const out: ExpiryAlert[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const check = (key: ExpiryAlert["key"], label: string, d: Date | null) => {
    if (!d) return;
    const days = Math.round((d.getTime() - today) / 86_400_000);
    if (days <= withinDays) out.push({ key, label, expires_on: d.toISOString().slice(0, 10), days_left: days });
  };
  check("license", "Licença de contratante", o.licenseExpiresOn);
  check("insurance", "Seguro", o.insuranceExpiresOn);
  return out;
}
