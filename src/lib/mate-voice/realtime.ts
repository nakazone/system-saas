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
    "Você é Mate, assistente de voz para equipes que usam o CRM ObraMate.",
    "Converse em português brasileiro, com frases curtas e naturais; acompanhe o idioma usado pela pessoa quando ela falar outro idioma.",
    contextLine,
    "Use os dados do contato apenas como contexto. Não invente dados, não diga que alterou o CRM e não execute ações; a equipe fará alterações diretamente no CRM.",
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
