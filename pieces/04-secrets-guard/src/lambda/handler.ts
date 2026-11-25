import { AlertEventSchema } from './alert.js';
import type { GuardConfig } from './config.js';
import type { Ports } from './ports.js';
import { respondToAlert } from './respond.js';
import { verifySignature } from './signature.js';

/** The Lambda Function URL request (payload format version 2.0), reduced to what we read. */
export interface FunctionUrlEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
}

export interface FunctionUrlResponse {
  statusCode: number;
  body: string;
}

export interface HandlerDeps {
  ports: Ports;
  config: GuardConfig;
  /** The webhook secret, fetched on first use and kept by the caller. */
  webhookSecret(): Promise<string>;
  now(): Date;
}

const reply = (statusCode: number, body: Record<string, unknown>): FunctionUrlResponse => ({
  statusCode,
  body: JSON.stringify(body),
});

function header(event: FunctionUrlEvent, name: string): string | undefined {
  const entry = Object.entries(event.headers ?? {}).find(([k]) => k.toLowerCase() === name);
  return entry?.[1];
}

/**
 * Build the Function URL handler. The signature is checked on the raw body before anything is
 * parsed, and a bad signature produces a 401 with no other work done.
 */
export function createHandler(deps: HandlerDeps) {
  return async (event: FunctionUrlEvent): Promise<FunctionUrlResponse> => {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64')
      : Buffer.from(event.body ?? '', 'utf8');
    let secret: string;
    try {
      secret = await deps.webhookSecret();
    } catch {
      return reply(500, { error: 'webhook secret unavailable' });
    }
    if (!verifySignature(secret, raw, header(event, 'x-hub-signature-256'))) {
      return reply(401, { error: 'invalid signature' });
    }
    if (header(event, 'x-github-event') !== 'secret_scanning_alert') {
      return reply(202, { ignored: 'not a secret_scanning_alert event' });
    }

    const parsed = AlertEventSchema.safeParse(safeJson(raw.toString('utf8')));
    if (!parsed.success) return reply(400, { error: 'unexpected payload' });

    try {
      const entries = await respondToAlert(parsed.data, deps.ports, deps.config, deps.now);
      const failed = entries.some((e) => e.decision === 'error');
      return reply(failed ? 500 : 200, { decisions: entries.map((e) => e.decision) });
    } catch {
      return reply(500, { error: 'audit or processing failure' });
    }
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
