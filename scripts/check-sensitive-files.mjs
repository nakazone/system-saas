#!/usr/bin/env node
/**
 * CI guard: fails when the repository contains files that must never be committed —
 * database dumps/backups (customer data), .env files, private keys, or live secrets.
 * Runs on every push/PR (see .github/workflows/ci.yml). Local: node scripts/check-sensitive-files.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

// SQL that is schema (migrations / legacy schema scripts) is fine; dumps with data are not.
const SQL_ALLOWED = [/^prisma\/migrations\//, /^crm\/database\/.*(schema|add-|create-|ensure-|migrate-|bootstrap-|migrations\/)/];

const BAD_NAME = [
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, ".env file"],
  [/\.(pem|key|p12|pfx|dump|bak|sqlite|db)$/i, "key / binary dump"],
  [/\.sql\.gz$/i, "compressed dump"],
  [/(^|\/)(backups?|exports?)\//i, "backup/export folder"],
];

const SECRET = [
  [/sk_live_[A-Za-z0-9]{16,}/, "Stripe live key"],
  [/rk_live_[A-Za-z0-9]{16,}/, "Stripe restricted key"],
  [/whsec_[A-Za-z0-9]{20,}/, "Stripe webhook secret"],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/, "Resend API key"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/postgres(ql)?:\/\/[^:\s'"]+:[^@\s'"$<{]{8,}@[a-z0-9.-]+\.(rlwy\.net|railway\.app|railway\.internal|amazonaws\.com)/, "database URL with password"],
];

const problems = [];
for (const f of files) {
  for (const [re, why] of BAD_NAME) if (re.test(f)) problems.push(`${f}: ${why}`);
  if (/\.sql$/i.test(f) && !SQL_ALLOWED.some((re) => re.test(f))) {
    const head = fs.readFileSync(f, "utf8").slice(0, 400_000);
    if (/INSERT INTO/i.test(head) || /--\s*(MySQL|PostgreSQL) dump|phpMyAdmin/i.test(head)) {
      problems.push(`${f}: looks like a database dump (contains data)`);
    }
  }
  let size = 0;
  try { size = fs.statSync(f).size; } catch { continue; }
  if (size > 2_000_000 || /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip)$/i.test(f)) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const [re, why] of SECRET) if (re.test(text)) problems.push(`${f}: ${why}`);
}

if (problems.length) {
  console.error("Sensitive files or secrets found in the repository:\n  " + problems.join("\n  "));
  console.error("\nRemove them (and rotate any secret that was pushed). See .gitignore.");
  process.exit(1);
}
console.log(`[check-sensitive-files] ${files.length} files OK`);
