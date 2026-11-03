import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const fail = (message) => Object.assign(new Error(message), { status: 400 });
const equal = (a, b) => {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

export function validatePassword(value, label = "Password") {
  const password = String(value ?? "");
  if (password.length < 8 || password.length > 128 || /[\x00-\x20\x7f]/.test(password)) {
    throw fail(`${label} must contain 8–128 characters with no spaces or control characters.`);
  }
  return password;
}

export async function hashPassword(value) {
  const password = validatePassword(value);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function verifyPassword(value, stored) {
  const password = String(value ?? "");
  if (!password || password.length > 128 || !stored) return false;
  const [algorithm, salt, digest] = String(stored).split("$");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(digest || "")) return false;
  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(digest, "hex"));
}

/** Legacy compatibility is verification-only. Successful login upgrades the hash. */
export function verifyLegacyPassword(value, hash) {
  return equal(crypto.createHash("sha256").update(String(value ?? "")).digest("hex"), hash);
}
export const needsPasswordUpgrade = (stored) => !String(stored || "").startsWith("scrypt$");

export function validateUsername(value, label = "Username") {
  const username = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) throw fail(`${label} must be 3–24 characters: lowercase letters, numbers or underscore, starting with a letter.`);
  if (["admin", "owner", "public", "support", "mizanora", "root", "system"].includes(username)) throw fail(`${label} is reserved.`);
  return username;
}
