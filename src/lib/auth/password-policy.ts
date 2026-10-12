import bcrypt from "bcryptjs";

/**
 * Passwords that were written in plain text in this (public) repository — seed, demo and
 * migration scripts. Anyone who reads the code knows them, so they must never open an account.
 * Login with one of them is refused even when it matches the stored hash; the admin (or the
 * platform Master, "senha temporária") sets a new one.
 */
const LEAKED_DEFAULT_PASSWORDS = new Set([
  "SeniorMigrate2026!",
  "changeme-platform-admin",
  "password12345",
  "@@Senior123",
]);

/** Too common to accept as a new password (existing accounts using them still sign in). */
const WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "changeme",
  "changeme123",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "qwerty123",
  "senha123",
  "senha1234",
  "obramate",
  "obramate123",
]);

export function isLeakedDefaultPassword(password: string): boolean {
  const p = String(password || "");
  return LEAKED_DEFAULT_PASSWORDS.has(p) || LEAKED_DEFAULT_PASSWORDS.has(p.trim());
}

function isWeakPassword(password: string): boolean {
  return WEAK_PASSWORDS.has(String(password || "").trim().toLowerCase());
}

export const LEAKED_PASSWORD_LOGIN_MESSAGE =
  "Esta senha padrão foi bloqueada por segurança. Peça ao administrador da empresa uma senha nova.";

/** Returns an error message (pt-BR) when the new password is not acceptable, else null. */
export function newPasswordProblem(password: string, opts?: { email?: string | null }): string | null {
  const p = String(password || "");
  if (p.length < 8) return "A nova senha deve ter pelo menos 8 caracteres.";
  if (p.length > 128) return "A nova senha pode ter no máximo 128 caracteres.";
  if (isLeakedDefaultPassword(p) || isWeakPassword(p)) {
    return "Escolha outra senha — essa é muito conhecida e não é segura.";
  }
  const email = String(opts?.email || "").toLowerCase();
  if (email && p.toLowerCase() === email) return "A senha não pode ser igual ao e-mail.";
  return null;
}

// Precomputed bcrypt hash (cost 12) of a random string. Comparing against it when the account
// does not exist keeps "unknown e-mail" and "wrong password" equally slow, so response time
// does not reveal which e-mails have an account.
const DUMMY_HASH = bcrypt.hashSync(`dummy-${Math.random()}-${Date.now()}`, 12);

export async function burnPasswordCheck(password: string): Promise<void> {
  await bcrypt.compare(String(password || ""), DUMMY_HASH);
}
