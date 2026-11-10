import bcrypt from "bcryptjs";

/**
 * Checks a typed password against a stored hash. Leading/trailing spaces are ignored
 * (new passwords are saved trimmed); the exact text is tried second, so a password
 * set before trimming existed, with spaces at its ends, still works.
 */
export async function passwordMatches(input: string, hash: string) {
  const trimmed = input.trim();
  if (await bcrypt.compare(trimmed, hash)) return true;
  return trimmed !== input && bcrypt.compare(input, hash);
}
