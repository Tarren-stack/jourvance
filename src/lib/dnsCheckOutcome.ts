// What the page editor's Check DNS may say, read from the answer to GET /api/domain/verify (U03).
// It used to show "CNAME Target Mismatch" for any answer without verified: true, so a 500, a 401
// or a dropped connection claimed a DNS result nobody had checked, and the server's own error
// sentence was never shown. Only a real answer from the check says whether the CNAME matches;
// anything else is one sentence saying the check did not run, with Retry only when retrying can
// help. Pure, with type-only imports, so Node tests can load it without a bundler.

import type { ServerAnswer } from './saveOutcome';
import type { DomainVerifyResult } from './shopifyClient';

export type DnsCheckOutcome =
  /** The check ran: the verdict (verified, contested or mismatch) is the server's. */
  | { kind: 'verdict'; result: DomainVerifyResult }
  /** The check did not run, or its answer carries no verdict. */
  | { kind: 'refused'; message: string; retryable: boolean };

export const DNS_UNREACHABLE = 'The DNS check did not run because the server could not be reached.';
export const DNS_SIGN_IN = 'Sign in to check the DNS for this domain.';
export const DNS_SERVER_PROBLEM = 'The DNS check did not run because the server had a problem.';
export const DNS_SERVER_BUSY = 'The DNS check did not run because the server was busy.';
export const DNS_UNREADABLE = 'The DNS check did not run because the server sent an answer it could not read.';

const bodyError = (body: unknown): string => {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error.trim() : '';
};

/** The one thing Check DNS may show for an answer (null: no answer came back at all). */
export function dnsCheckOutcome(answer: ServerAnswer | null): DnsCheckOutcome {
  if (!answer) return { kind: 'refused', message: DNS_UNREACHABLE, retryable: true };
  const { status, body } = answer;
  if (status === 401) return { kind: 'refused', message: DNS_SIGN_IN, retryable: false };
  if (status >= 500) return { kind: 'refused', message: DNS_SERVER_PROBLEM, retryable: true };
  if (status === 408 || status === 429) return { kind: 'refused', message: DNS_SERVER_BUSY, retryable: true };
  const said = bodyError(body);
  if (status < 200 || status >= 300) {
    // A refusal with the server's reason (an address that is not a subdomain): retrying the same
    // address cannot help, changing it can.
    return {
      kind: 'refused',
      message: said || `The DNS check did not run because the server answered with status ${status}.`,
      retryable: false
    };
  }
  const result = body as Partial<DomainVerifyResult> | null;
  if (!result || result.success !== true || typeof result.verified !== 'boolean') {
    return said
      ? { kind: 'refused', message: said, retryable: false }
      : { kind: 'refused', message: DNS_UNREADABLE, retryable: true };
  }
  return { kind: 'verdict', result: result as DomainVerifyResult };
}

/** The verdict's detail line: the server's error sentence when it sent one, else its message. */
export function dnsVerdictDetail(result: DomainVerifyResult): string {
  const error = typeof result.error === 'string' ? result.error.trim() : '';
  const message = typeof result.message === 'string' ? result.message.trim() : '';
  return error || message;
}
