import bcrypt from "bcryptjs";

/** bcrypt cost for every stored password (OWASP minimum; higher costs made sign-in visibly slow on serverless CPUs). */
export const BCRYPT_COST = 10;

/**
 * Checks a typed password against a stored hash. Leading/trailing spaces are ignored
 * (new passwords are saved trimmed); the exact text is tried second, so a password
 * set before trimming existed, with spaces at its ends, still works.
 * Returns the text that matched, or null.
 */
export async function passwordMatches(input: string, hash: string): Promise<string | null> {
  const trimmed = input.trim();
  if (await bcrypt.compare(trimmed, hash)) return trimmed;
  if (trimmed !== input && (await bcrypt.compare(input, hash))) return input;
  return null;
}

/** True when a stored hash uses a different cost than BCRYPT_COST and should be re-saved after a successful sign-in. */
export function needsRehash(hash: string) {
  try {
    return bcrypt.getRounds(hash) !== BCRYPT_COST;
  } catch {
    return false;
  }
}
