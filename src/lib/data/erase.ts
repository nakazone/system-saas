import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { inTenant } from "./tables.js";

/**
 * Excluir os dados de uma pessoa (cliente final, funcionário, usuário) dentro de uma empresa.
 * Finds the person by e-mail and/or phone and anonymizes them: names become "Removed person",
 * contact data and free-text notes are cleared. Money records (quotes, jobs, invoices, pay)
 * stay — the company may have to keep them for taxes — but no longer say who it was.
 */

export const REMOVED = "Removed person";

export type Subject = { email: string | null; phone: string | null };

export function normalizeSubject(email?: string | null, phone?: string | null): Subject | { error: string } {
  const e = String(email || "").trim().toLowerCase();
  const digits = String(phone || "").replace(/\D/g, "");
  const p = digits.length >= 10 ? digits.slice(-10) : digits.length >= 7 ? digits : "";
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: "E-mail inválido." };
  if (String(phone || "").trim() && !p) return { error: "Telefone precisa de pelo menos 7 dígitos." };
  if (!e && !p) return { error: "Informe o e-mail ou o telefone da pessoa." };
  return { email: e || null, phone: p || null };
}

export function maskSubject(s: Subject): string {
  const parts: string[] = [];
  if (s.email) {
    const [u, d] = s.email.split("@");
    parts.push(`${u.slice(0, 1)}***@${d}`);
  }
  if (s.phone) parts.push(`***-${s.phone.slice(-4)}`);
  return parts.join(" · ");
}

export function subjectHash(s: Subject): string {
  return crypto.createHash("sha256").update(`${s.email || ""}|${s.phone || ""}`).digest("hex");
}

/** SQL fragment matching an e-mail column and/or a phone column (last digits). */
function match(s: Subject, emailCol: string | null, phoneCol: string | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (s.email && emailCol) parts.push(Prisma.sql`lower(trim(${Prisma.raw(emailCol)})) = ${s.email}`);
  if (s.phone && phoneCol) parts.push(Prisma.sql`right(regexp_replace(coalesce(${Prisma.raw(phoneCol)}, ''), '\\D', '', 'g'), ${s.phone.length}) = ${s.phone}`);
  if (!parts.length) return Prisma.sql`false`;
  return Prisma.join(parts, " OR ", "(", ")");
}

export type Category = {
  key: string;
  label: string;
  what: string;
  count: number;
  samples: string[];
  blocked?: string;
};

type Found = { leads: string[]; customers: string[]; users: string[] };

async function findIds(tx: Prisma.TransactionClient, org: string, s: Subject): Promise<Found> {
  const ids = async (sql: Prisma.Sql) => (await tx.$queryRaw<{ id: string }[]>(sql)).map((r) => r.id);
  return {
    leads: await ids(Prisma.sql`SELECT id::text FROM "Lead" WHERE "organizationId" = ${org}::uuid AND ${match(s, '"email"', '"phone"')}`),
    customers: await ids(Prisma.sql`SELECT id::text FROM "Customer" WHERE "organizationId" = ${org}::uuid AND ${match(s, '"email"', '"phone"')}`),
    users: s.email ? await ids(Prisma.sql`SELECT id::text FROM "User" WHERE "organizationId" = ${org}::uuid AND lower("email") = ${s.email}`) : [],
  };
}

const uuids = (a: string[]) => Prisma.sql`ARRAY[${Prisma.join(a.length ? a : ["00000000-0000-0000-0000-000000000000"])}]::uuid[]`;

/** What would be anonymized, by category (preview before confirming). */
export async function findPerson(organizationId: string, s: Subject): Promise<Category[]> {
  return inTenant(organizationId, async (tx) => {
    const f = await findIds(tx, organizationId, s);
    const names = async (sql: Prisma.Sql) => (await tx.$queryRaw<{ n: string | null }[]>(sql)).map((r) => r.n || "—");
    const cnt = async (sql: Prisma.Sql) => Number((await tx.$queryRaw<{ c: bigint }[]>(sql))[0]?.c ?? 0);
    const org = Prisma.sql`"organizationId" = ${organizationId}::uuid`;
    const out: Category[] = [];

    const leadNames = await names(Prisma.sql`SELECT name AS n FROM "Lead" WHERE id = ANY(${uuids(f.leads)}) LIMIT 4`);
    out.push({ key: "leads", label: "Leads", what: "Nome, e-mail, telefone, notas e histórico do lead", count: f.leads.length, samples: leadNames });
    const custNames = await names(Prisma.sql`SELECT name AS n FROM "Customer" WHERE id = ANY(${uuids(f.customers)}) LIMIT 4`);
    out.push({ key: "customers", label: "Clientes", what: "Nome, contato, endereço e notas do cliente + endereços cadastrados", count: f.customers.length, samples: custNames });
    out.push({
      key: "field_quotes",
      label: "Field Quotes",
      what: "Nome, contato e endereço do cliente",
      count: await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "FieldQuote" WHERE ${org} AND (${match(s, '"clientEmail"', '"clientPhone"')} OR "leadId" = ANY(${uuids(f.leads)}))`),
      samples: [],
    });
    out.push({
      key: "jobs",
      label: "Jobs e orçamentos ligados",
      what: "Endereço da obra, origem; no orçamento, nome, IP e local de quem aprovou (valores ficam)",
      count:
        (await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "WorkOrder" WHERE ${org} AND "customerId" = ANY(${uuids(f.customers)})`)) +
        (await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "Quote" WHERE ${org} AND ("customerId" = ANY(${uuids(f.customers)}) OR "leadId" = ANY(${uuids(f.leads)})) `)),
      samples: [],
    });
    out.push({
      key: "builders",
      label: "Builders / parceiros",
      what: "Nome, contato, endereço e notas",
      count: await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "Builder" WHERE ${org} AND ${match(s, '"email"', '"phone"')}`),
      samples: await names(Prisma.sql`SELECT trim(coalesce("firstName",'') || ' ' || coalesce("lastName",'')) AS n FROM "Builder" WHERE ${org} AND ${match(s, '"email"', '"phone"')} LIMIT 3`),
    });
    out.push({
      key: "employees",
      label: "Funcionários (folha)",
      what: "Nome, e-mail e telefone (pagamentos ficam)",
      count: await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "PayrollEmployee" WHERE ${org} AND ${match(s, '"email"', '"phone"')}`),
      samples: await names(Prisma.sql`SELECT name AS n FROM "PayrollEmployee" WHERE ${org} AND ${match(s, '"email"', '"phone"')} LIMIT 3`),
    });
    out.push({
      key: "temp_workers",
      label: "Temporários de jobs",
      what: "Nome, contato, notas e link do ticket",
      count: await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "WorkOrderTempWorker" WHERE ${org} AND ${match(s, '"email"', '"phone"')}`),
      samples: [],
    });
    const lastAdmin =
      f.users.length > 0 &&
      (await cnt(
        Prisma.sql`SELECT count(*)::bigint AS c FROM "User" u JOIN "Role" r ON r.id = u."roleId" WHERE u."organizationId" = ${organizationId}::uuid AND u.status = 'active' AND r.key = 'admin' AND NOT (u.id = ANY(${uuids(f.users)}))`,
      )) === 0;
    out.push({
      key: "users",
      label: "Login no ObraMate",
      what: "Conta desativada, nome e e-mail apagados, sessões encerradas",
      count: f.users.length,
      samples: await names(Prisma.sql`SELECT name AS n FROM "User" WHERE id = ANY(${uuids(f.users)})`),
      blocked: lastAdmin ? "É o único administrador ativo da empresa. Transfira a administração antes." : undefined,
    });
    out.push({
      key: "messages",
      label: "Registro de mensagens e e-mails",
      what: "Destinatário e texto das mensagens enviadas a essa pessoa; convites pendentes",
      count:
        (await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "CommunicationLog" WHERE ${org} AND (${match(s, '"toAddress"', '"toAddress"')} OR "customerId" = ANY(${uuids(f.customers)}))`)) +
        (await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "ScheduledMessage" WHERE ${org} AND ${match(s, '"toAddress"', '"toAddress"')}`)) +
        (s.email ? await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "PlatformEmailLog" WHERE "organizationId" = ${organizationId}::uuid AND lower("toEmail") LIKE ${"%" + s.email + "%"}`) : 0) +
        (s.email ? await cnt(Prisma.sql`SELECT count(*)::bigint AS c FROM "Invitation" WHERE ${org} AND lower("email") = ${s.email}`) : 0),
      samples: [],
    });
    return out;
  });
}

/** Anonymizes the chosen categories. Returns rows changed per table. */
export async function erasePerson(organizationId: string, s: Subject, categories: string[]): Promise<Record<string, number>> {
  const want = new Set(categories);
  const preview = await findPerson(organizationId, s);
  const blocked = preview.find((c) => want.has(c.key) && c.blocked);
  if (blocked) throw new Error(blocked.blocked);
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => {
    if (n) counts[k] = (counts[k] ?? 0) + n;
  };
  await inTenant(
    organizationId,
    async (tx) => {
      const f = await findIds(tx, organizationId, s);
      const org = Prisma.sql`"organizationId" = ${organizationId}::uuid`;
      const L = uuids(f.leads);
      const C = uuids(f.customers);
      if (want.has("leads")) {
        add("Lead", await tx.$executeRaw`UPDATE "Lead" SET name = ${REMOVED}, email = NULL, phone = NULL, notes = NULL, metadata = '{}'::jsonb, "updatedAt" = now() WHERE id = ANY(${L})`);
      }
      if (want.has("customers")) {
        add("Customer", await tx.$executeRaw`UPDATE "Customer" SET name = ${REMOVED}, email = NULL, phone = NULL, address = NULL, "contactName" = NULL, company = NULL, notes = NULL, "dumpsterNotes" = NULL, "storageNotes" = NULL, "marketingConsent" = false, "updatedAt" = now() WHERE id = ANY(${C})`);
        add("Property", await tx.$executeRaw`UPDATE "Property" SET label = NULL, line1 = ${REMOVED}, line2 = NULL, city = '', state = '', "postalCode" = '', notes = NULL, "updatedAt" = now() WHERE ${org} AND "customerId" = ANY(${C})`);
      }
      if (want.has("field_quotes")) {
        add("FieldQuote", await tx.$executeRaw`UPDATE "FieldQuote" SET "clientName" = ${REMOVED}, "clientPhone" = NULL, "clientEmail" = NULL, address = NULL, "updatedAt" = now() WHERE ${org} AND (${match(s, '"clientEmail"', '"clientPhone"')} OR "leadId" = ANY(${L}))`);
      }
      if (want.has("jobs")) {
        add("WorkOrder", await tx.$executeRaw`UPDATE "WorkOrder" SET address = NULL, "sourceName" = NULL, "updatedAt" = now() WHERE ${org} AND "customerId" = ANY(${C})`);
        add("Quote", await tx.$executeRaw`UPDATE "Quote" SET "signedByName" = CASE WHEN "signedByName" IS NULL THEN NULL ELSE ${REMOVED} END, "approvedIp" = NULL, "approvedUserAgent" = NULL, "approvedLat" = NULL, "approvedLng" = NULL, "approvedGpsAccuracyM" = NULL WHERE ${org} AND ("customerId" = ANY(${C}) OR "leadId" = ANY(${L}))`);
      }
      if (want.has("builders")) {
        add("Builder", await tx.$executeRaw`UPDATE "Builder" SET "firstName" = 'Removed', "lastName" = 'person', email = NULL, phone = NULL, address = NULL, notes = NULL, "updatedAt" = now() WHERE ${org} AND ${match(s, '"email"', '"phone"')}`);
      }
      if (want.has("employees")) {
        add("PayrollEmployee", await tx.$executeRaw`UPDATE "PayrollEmployee" SET name = ${REMOVED}, email = NULL, phone = NULL, "updatedAt" = now() WHERE ${org} AND ${match(s, '"email"', '"phone"')}`);
      }
      if (want.has("temp_workers")) {
        add("WorkOrderTempWorker", await tx.$executeRaw`UPDATE "WorkOrderTempWorker" SET name = ${REMOVED}, phone = NULL, email = NULL, notes = NULL, "shareToken" = NULL, "shareTokenExpiresAt" = NULL, "updatedAt" = now() WHERE ${org} AND ${match(s, '"email"', '"phone"')}`);
      }
      if (want.has("users") && f.users.length) {
        for (const id of f.users) {
          const n = await tx.$executeRaw`UPDATE "User" SET name = 'Removed user', email = ${`removed-${id}@deleted.obramate.invalid`}, phone = NULL, "avatarUrl" = NULL, "passwordHash" = ${crypto.randomBytes(32).toString("hex")}, status = 'disabled', "routeStartAddress" = NULL, "updatedAt" = now() WHERE id = ${id}::uuid`;
          add("User", n);
        }
        await tx.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ANY(${f.users}::text[])`.catch(() => 0);
      }
      if (want.has("messages")) {
        add("CommunicationLog", await tx.$executeRaw`UPDATE "CommunicationLog" SET "toAddress" = 'removed', subject = NULL, body = '' WHERE ${org} AND (${match(s, '"toAddress"', '"toAddress"')} OR "customerId" = ANY(${C}))`);
        add("ScheduledMessage", await tx.$executeRaw`DELETE FROM "ScheduledMessage" WHERE ${org} AND ${match(s, '"toAddress"', '"toAddress"')}`);
        if (s.email) {
          add("PlatformEmailLog", await tx.$executeRaw`UPDATE "PlatformEmailLog" SET "toEmail" = 'removed', subject = '(removed)' WHERE "organizationId" = ${organizationId}::uuid AND lower("toEmail") LIKE ${"%" + s.email + "%"}`);
          add("Invitation", await tx.$executeRaw`DELETE FROM "Invitation" WHERE ${org} AND lower("email") = ${s.email}`);
        }
      }
    },
    300_000,
  );
  return counts;
}
