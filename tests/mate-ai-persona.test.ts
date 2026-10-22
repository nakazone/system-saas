import { describe, expect, it } from "vitest";
import { buildAgentPrompt, personaLocalReply, type AgentPersona } from "../src/lib/mate-ai/agent.js";

const marina: AgentPersona = {
  name: "Marina",
  title: "Assistente financeira",
  department: "Financeiro",
  description: "Acompanha invoices e recebimentos.",
  manager: false,
  company: "Naka Flooring",
  colleagues: ["Lara (Assistente comercial, Comercial)"],
  desk: ["$4,800.00 vencidos em 2 invoice(s) (Ortiz Homes)"],
};

describe("virtual office persona", () => {
  it("speaks as the employee, with colleagues and desk", () => {
    const prompt = buildAgentPrompt({ actions: [], catalog: [], today: "2026-10-22", weekday: "Thursday", timezone: "America/Denver", screen: null, memory: [], userName: "Naka Nakazone", persona: marina });
    expect(prompt).toContain("You are Marina, Assistente financeira (Financeiro)");
    expect(prompt).toContain("Naka Flooring");
    expect(prompt).toContain("The user is Naka");
    expect(prompt).toContain("Lara (Assistente comercial, Comercial)");
    expect(prompt).toContain("$4,800.00 vencidos");
    expect(prompt).toContain("AI assistant");
    expect(prompt).not.toContain("You are Mate AI");
  });

  it("keeps the Mate prompt without a persona", () => {
    const prompt = buildAgentPrompt({ actions: [], catalog: [], today: "2026-10-22", weekday: "Thursday", timezone: "America/Denver", screen: null, memory: [] });
    expect(prompt).toContain("You are Mate AI");
  });

  it("answers small talk offline in character", () => {
    expect(personaLocalReply("oi Marina, tudo bem?", marina, "Naka Nakazone")).toMatch(/^Oi, Naka! Tudo certo por aqui\. Por aqui tem \$4,800/);
    expect(personaLocalReply("valeu!", marina, "Naka")).toContain("Imagina, Naka");
    expect(personaLocalReply("você é uma pessoa?", marina)).toContain("assistente de IA");
    expect(personaLocalReply("emitir a invoice do job 4", marina)).toBeNull();
  });
});
