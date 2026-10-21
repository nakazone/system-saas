import { env } from "../../config/env.js";

/** Mate Voice is available only in staging or production when explicitly opted in. */
export function isMateVoiceEnabled(
  appEnv: string = env.APP_ENV,
  enabled: boolean = env.MATE_VOICE_ENABLED,
): boolean {
  return (appEnv === "staging" || appEnv === "production") && enabled;
}
