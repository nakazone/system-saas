/**
 * Prints a one-time access link for the platform Master (48 h).
 * Opening it lets the Master set a new password and a new 2FA — use it when
 * the password or the authenticator phone is lost.
 *
 *   railway run npm run master:link
 *   npm run master:link -- someone@example.com   (makes that account the Master if none exists)
 */
import { prisma } from "../src/lib/prisma.js";
import { issueActivation, sendActivationEmail, ensureMaster } from "../src/master/auth.js";

async function main() {
  const emailArg = (process.argv[2] || "").trim().toLowerCase();
  if (emailArg) process.env.MASTER_EMAIL = emailArg;
  await ensureMaster();
  const master = await prisma.platformAdmin.findFirst({ where: { role: "MASTER" } });
  if (!master) {
    console.error("No Master account. Run again with the e-mail: npm run master:link -- you@example.com");
    process.exit(1);
  }
  const link = await issueActivation(master.id);
  await sendActivationEmail(master.email, master.name, link, master.status === "invited" ? "master" : "reset");
  console.log(`Master: ${master.email}`);
  console.log(`Access link (48 h, one use): ${link}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
