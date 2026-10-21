import { z } from "zod";

export const createConversationSchema = z.object({
  crmType: z.enum(["lead", "customer"]).nullable().optional(),
  crmId: z.string().uuid().nullable().optional(),
}).refine((body) => Boolean(body.crmType) === Boolean(body.crmId), {
  message: "Selecione um registro completo do CRM.",
});

export const transcriptMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(10_000),
});
