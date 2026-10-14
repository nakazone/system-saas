/**
 * Public referral signup — no session.
 *
 *   GET  /r/:slug/:code          → branded form
 *   POST /r/:slug/:code          → register lead + particular customer
 *   GET  /api/public/referral/:slug/:code → JSON for the form (optional)
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity } from "../../lib/activity/record.js";
import { notifyNewLeadPush } from "../../lib/push/notify.js";
import { formatUsPhone } from "../../lib/phone.js";
import { formatPersonName } from "../../lib/name.js";
import { HOUR, takeRate } from "../../lib/security/db-rate-limit.js";
import { parseReferralSettings } from "../../lib/referrals/settings.js";
import { param } from "../../lib/http/params.js";

export const publicReferralRouter = Router();

async function resolveReferral(slug: string, code: string) {
  const org = await prisma.organization.findFirst({
    where: { slug: slug.toLowerCase() },
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
      accentColor: true,
      referralSettings: true,
      status: true,
    },
  });
  if (!org || ["suspended", "canceled"].includes(String(org.status || ""))) return null;

  const settings = parseReferralSettings(org.referralSettings);
  if (!settings.enabled) return { org, settings, referrer: null as null, disabled: true as const };

  const referrer = await withTenantTransaction(org.id, (tx) =>
    tx.customer.findFirst({
      where: {
        referralCode: { equals: code, mode: "insensitive" },
        customerType: "particular",
      },
      select: { id: true, name: true, referralCode: true },
    }),
  );
  if (!referrer) return null;
  return { org, settings, referrer, disabled: false as const };
}

function firstName(name: string) {
  return String(name || "").trim().split(/\s+/)[0] || name;
}

publicReferralRouter.get("/r/:slug/:code", async (req, res, next) => {
  try {
    const slug = param(req, "slug");
    const code = param(req, "code");
    const resolved = await resolveReferral(slug, code);
    if (!resolved) {
      res.status(404).render("referrals/public", {
        title: "Link inválido",
        mode: "invalid",
        organization: null,
        referrer: null,
        settings: null,
        error: "Este link de indicação não é válido ou expirou.",
      });
      return;
    }
    if (resolved.disabled || !resolved.referrer) {
      res.status(404).render("referrals/public", {
        title: "Indicações pausadas",
        mode: "disabled",
        organization: resolved.org,
        referrer: null,
        settings: resolved.settings,
        error: "O programa de indicações não está ativo no momento.",
      });
      return;
    }
    res.render("referrals/public", {
      title: `Indicação · ${resolved.org.name}`,
      mode: "form",
      organization: resolved.org,
      referrer: { id: resolved.referrer.id, name: resolved.referrer.name, first_name: firstName(resolved.referrer.name) },
      settings: resolved.settings,
      error: null,
      success: null,
    });
  } catch (error) {
    next(error);
  }
});

const registerSchema = z.object({
  name: z.string().min(2).max(255),
  phone: z.string().min(7).max(40),
  email: z.string().email().max(255).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

publicReferralRouter.post("/r/:slug/:code", async (req, res, next) => {
  try {
    const slug = param(req, "slug");
    const code = param(req, "code");
    const resolved = await resolveReferral(slug, code);

    const renderErr = (status: number, error: string, mode = "form") => {
      res.status(status).render("referrals/public", {
        title: resolved?.org ? `Indicação · ${resolved.org.name}` : "Indicação",
        mode,
        organization: resolved?.org || null,
        referrer: resolved?.referrer
          ? {
              id: resolved.referrer.id,
              name: resolved.referrer.name,
              first_name: firstName(resolved.referrer.name),
            }
          : null,
        settings: resolved?.settings || null,
        error,
        success: null,
        form: req.body || {},
      });
    };

    if (!resolved || resolved.disabled || !resolved.referrer) {
      renderErr(404, "Este link de indicação não é válido ou o programa está pausado.", "invalid");
      return;
    }

    const ip = String(req.ip || req.headers["x-forwarded-for"] || "unknown").slice(0, 80);
    const ok = await takeRate([
      { key: `referral-reg:ip:${ip}`, max: 8, windowMs: HOUR },
      { key: `referral-reg:org:${resolved.org.id}`, max: 40, windowMs: HOUR },
    ]);
    if (!ok) {
      renderErr(429, "Muitas tentativas. Aguarde um pouco e tente de novo.");
      return;
    }

    const parsed = registerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      renderErr(400, "Revise nome e telefone (obrigatórios) e o e-mail, se informado.");
      return;
    }

    const name = formatPersonName(parsed.data.name);
    const phone = formatUsPhone(parsed.data.phone) || String(parsed.data.phone).trim();
    const email = String(parsed.data.email || "").trim().toLowerCase() || null;
    const address = String(parsed.data.address || "").trim() || null;
    const extraNotes = String(parsed.data.notes || "").trim() || null;
    const digits = phone.replace(/\D/g, "");

    const result = await withTenantTransaction(resolved.org.id, async (tx) => {
      const existingCustomer = await tx.customer.findFirst({
        where: {
          OR: [
            ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
            ...(digits.length >= 10 ? [{ phone: { contains: digits.slice(-10) } }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
      });

      if (existingCustomer) {
        if (!existingCustomer.referredByCustomerId && existingCustomer.id !== resolved.referrer!.id) {
          await tx.customer.update({
            where: { id: existingCustomer.id },
            data: { referredByCustomerId: resolved.referrer!.id },
          });
        }
        return {
          kind: "existing_customer" as const,
          customerId: existingCustomer.id,
          leadId: existingCustomer.leadId,
          name: existingCustomer.name,
        };
      }

      const existingLead = await tx.lead.findFirst({
        where: {
          OR: [
            ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
            ...(digits.length >= 10 ? [{ phone: { contains: digits.slice(-10) } }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
      });

      const stage =
        (await tx.pipelineStage.findFirst({
          where: { slug: "new", isActive: true },
          orderBy: { order: "asc" },
        })) ||
        (await tx.pipelineStage.findFirst({
          where: { isActive: true },
          orderBy: { order: "asc" },
        }));

      const meta: Record<string, unknown> = {
        referred_by_customer_id: resolved.referrer!.id,
        referral_code: resolved.referrer!.referralCode,
        referrer_name: resolved.referrer!.name,
        form_type: "referral_link",
        address,
      };

      const noteParts = [
        `Indicação de ${resolved.referrer!.name} (código ${resolved.referrer!.referralCode})`,
        address ? `Endereço: ${address}` : null,
        extraNotes,
      ].filter(Boolean);

      let leadId = existingLead?.id || null;
      if (!existingLead) {
        const lead = await tx.lead.create({
          data: {
            organizationId: resolved.org.id,
            name,
            email,
            phone,
            source: "Referral",
            status: stage?.slug || "new",
            pipelineStageId: stage?.id ?? null,
            notes: noteParts.join("\n"),
            metadata: meta as Prisma.InputJsonValue,
          },
        });
        leadId = lead.id;
      } else {
        const prev =
          existingLead.metadata && typeof existingLead.metadata === "object" && !Array.isArray(existingLead.metadata)
            ? { ...(existingLead.metadata as Record<string, unknown>) }
            : {};
        await tx.lead.update({
          where: { id: existingLead.id },
          data: {
            source: existingLead.source || "Referral",
            metadata: { ...prev, ...meta } as Prisma.InputJsonValue,
            notes: [existingLead.notes, ...noteParts].filter(Boolean).join("\n"),
          },
        });
        const fromLead = await tx.customer.findFirst({ where: { leadId: existingLead.id } });
        if (fromLead) {
          if (!fromLead.referredByCustomerId && fromLead.id !== resolved.referrer!.id) {
            await tx.customer.update({
              where: { id: fromLead.id },
              data: { referredByCustomerId: resolved.referrer!.id },
            });
          }
          return {
            kind: "existing_customer" as const,
            customerId: fromLead.id,
            leadId: existingLead.id,
            name: fromLead.name,
          };
        }
      }

      const customer = await tx.customer.create({
        data: {
          organizationId: resolved.org.id,
          leadId,
          name,
          email,
          phone,
          address,
          notes: noteParts.join("\n"),
          customerType: "particular",
          pricingMode: "table",
          referredByCustomerId: resolved.referrer!.id,
        },
      });

      if (address) {
        await tx.property.create({
          data: {
            organizationId: resolved.org.id,
            customerId: customer.id,
            label: "Primary",
            line1: address,
            city: "",
            state: "",
            postalCode: "",
            country: "US",
          },
        });
      }

      await recordActivity(tx, {
        organizationId: resolved.org.id,
        entityType: "customer",
        entityId: customer.id,
        actorType: "customer",
        action: "referral.registered",
        changes: {
          referredByCustomerId: { from: null, to: resolved.referrer!.id },
          leadId: { from: null, to: leadId },
        },
      });

      return {
        kind: "created" as const,
        customerId: customer.id,
        leadId,
        name: customer.name,
        newLead: !existingLead,
      };
    });

    if (result.kind === "created" && result.newLead && result.leadId) {
      notifyNewLeadPush(resolved.org.id, { id: result.leadId, name: result.name });
    }

    const wantsJson = String(req.headers.accept || "").includes("application/json") || req.query.format === "json";
    if (wantsJson) {
      res.status(result.kind === "created" ? 201 : 200).json({
        success: true,
        data: {
          customer_id: result.customerId,
          lead_id: result.leadId,
          existing: result.kind === "existing_customer",
        },
      });
      return;
    }

    res.render("referrals/public", {
      title: `Obrigado · ${resolved.org.name}`,
      mode: "success",
      organization: resolved.org,
      referrer: {
        id: resolved.referrer.id,
        name: resolved.referrer.name,
        first_name: firstName(resolved.referrer.name),
      },
      settings: resolved.settings,
      error: null,
      success:
        result.kind === "created"
          ? "Cadastro recebido! A equipe vai entrar em contato em breve."
          : "Você já estava no sistema — registramos a indicação. Obrigado!",
      form: {},
    });
  } catch (error) {
    next(error);
  }
});
