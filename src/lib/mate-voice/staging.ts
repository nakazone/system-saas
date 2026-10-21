import { env } from "../../config/env.js";

/** The Mate Voice feature only exists in the explicitly opted-in staging lane. */
export function isMateVoiceStagingEnabled(
  appEnv: string = env.APP_ENV,
  enabled: boolean = env.MATE_VOICE_ENABLED,
): boolean {
  return appEnv === "staging" && enabled;
}
