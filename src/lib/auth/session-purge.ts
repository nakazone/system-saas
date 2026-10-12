import { prisma } from "../prisma.js";

/**
 * Ends every stored session of a user (express-session / connect-pg-simple table "session"),
 * optionally keeping the session that made the request. Used after a password change or reset,
 * so a stolen session or a device left logged in stops working.
 */
export async function purgeUserSessions(userId: string, exceptSid?: string | null): Promise<number> {
  if (!userId) return 0;
  try {
    if (exceptSid) {
      return await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ${userId} AND sid <> ${exceptSid}`;
    }
    return await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ${userId}`;
  } catch (error) {
    // The table is created by connect-pg-simple on first use; never fail the main action.
    console.error("[auth] could not purge sessions", error);
    return 0;
  }
}
