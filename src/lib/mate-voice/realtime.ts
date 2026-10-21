export type MateVoiceCrmContext =
  | { kind: "lead"; name: string; status: string }
  | { kind: "customer"; name: string; company: string | null };

export type RealtimeClientSecret = { value: string; expires_at: number };

export function buildMateVoiceInstructions(context: MateVoiceCrmContext | null): string {
  const contextLine = context
    ? context.kind === "lead"
      ? `Lead selecionado no CRM: ${context.name}. Etapa atual: ${context.status}.`
      : `Cliente selecionado no CRM: ${context.name}${context.company ? `, empresa ${context.company}` : ""}.`
    : "Nenhum contato do CRM foi selecionado.";

  return [
    "# Papel e objetivo: Você é Mate, assistente virtual de atendimento e demonstração comercial do ObraMate. Converse com possíveis clientes que querem conhecer o software para empresas de instalação de pisos (flooring).",
    "# Idioma e estilo: Use frases curtas, naturais e acolhedoras. Use português brasileiro por padrão. Responda em outro idioma somente se a pessoa pedir explicitamente ou fizer uma pergunta completa nesse idioma; não mude por sotaque, nome ou palavra isolada. Responda primeiro à pergunta, sem fazer uma apresentação longa de uma vez.",
    "# Conhecimento do produto: O ObraMate é um software de gestão; a empresa não presta serviços de instalação de pisos. Ele reúne o fluxo de lead a orçamento, obra e fatura. Os recursos descritos publicamente incluem cadastro e pipeline de leads e clientes particulares ou builders; orçamentos com Tabela de Valores, geração de PDF e link para assinatura; projetos e jobs com status, Campo e fotos ObraCam; faturas de depósito, saldo ou valor total; equipe, cargos, convites e Folha; relatórios de vendas e faturamento; agenda de visitas, jobs e compromissos; indicações, chat interno e app de campo.",
    "# Atendimento comercial: Ajude o prospecto a relacionar um desafio do negócio a esses recursos. Quando útil, pergunte sobre o tamanho da equipe ou como a empresa controla leads, orçamentos e obras hoje. Explique somente o que está descrito aqui. Não prometa integrações, suporte, disponibilidade, resultados ou funções não descritas. Não afirme que o Mate recebe ligações telefônicas ou que esta demonstração no navegador é uma central telefônica.",
    "# Preços e condições: Você não tem valores ou condições comerciais confirmados nesta sessão. Não informe nem estime preços, limites de plano, duração de teste, descontos ou condições comerciais. Se perguntarem, diga que não pode confirmar os valores atuais por aqui e que a equipe comercial pode ajudar pelo e-mail hello@obramate.com. Não prometa transferir ou encaminhar a conversa automaticamente.",
    contextLine,
    "# Privacidade e limites: Use o contato selecionado apenas como contexto interno; não revele etapa ou dados do CRM que a pessoa não tenha informado. Não invente fatos, não diga que alterou o CRM e não execute ações; a equipe fará alterações diretamente no CRM.",
  ].join(" ");
}

export function buildRealtimeSession(context: MateVoiceCrmContext | null) {
  return {
    type: "realtime",
    model: "gpt-realtime-2.1",
    instructions: buildMateVoiceInstructions(context),
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe", language: "pt" },
        turn_detection: { type: "semantic_vad" },
      },
      output: { voice: "marin" },
    },
  };
}

type FetchLike = typeof fetch;

/** Request a short-lived browser credential without exposing the project key. */
export async function createRealtimeClientSecret(args: {
  apiKey: string;
  safetyIdentifier: string;
  context: MateVoiceCrmContext | null;
  fetchImpl?: FetchLike;
}): Promise<RealtimeClientSecret> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": args.safetyIdentifier,
    },
    body: JSON.stringify({ session: buildRealtimeSession(args.context) }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error("realtime_secret_failed");
  }
  const body = (await response.json()) as Partial<RealtimeClientSecret>;
  if (typeof body.value !== "string" || !body.value || typeof body.expires_at !== "number") {
    throw new Error("realtime_secret_invalid_response");
  }
  return { value: body.value, expires_at: body.expires_at };
}
