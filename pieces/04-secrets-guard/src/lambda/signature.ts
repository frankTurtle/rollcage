import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/** The value GitHub puts in `X-Hub-Signature-256`: "sha256=" plus the HMAC hex of the raw body. */
export function sign(secret: string, rawBody: string | Buffer): string {
  return `${PREFIX}${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/**
 * Check a webhook delivery's signature against the raw body, in constant time.
 * A missing, malformed or wrong signature is false; nothing else is distinguishable.
 */
export function verifySignature(
  secret: string,
  rawBody: string | Buffer,
  header: string | undefined,
): boolean {
  if (!secret || !header?.startsWith(PREFIX)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(PREFIX.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
