import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
export async function temporaryPasswordDigest(password: string, salt = randomBytes(16).toString("hex")) {
  const digest = await derive(password, salt, 64) as Buffer;
  return { salt, digest: digest.toString("hex") };
}
export async function isTemporaryPassword(password: string, salt: string, initialDigest: string) {
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(initialDigest)) throw new Error("Invalid password setup");
  const next = await temporaryPasswordDigest(password, salt);
  return timingSafeEqual(Buffer.from(next.digest, "hex"), Buffer.from(initialDigest, "hex"));
}
