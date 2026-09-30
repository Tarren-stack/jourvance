// Email Studio's Flow map reads. A request the server never answered (fetch rejects) is not an
// account with no flows: the map keeps what it last showed, says so, and offers Retry. These are
// the pure rules, so node tests can hold them.

export const FLOW_MAP_UNREACHABLE = 'The flows could not be loaded. The server did not answer.';

export type SettledRead<T> = { answered: true; data: T } | { answered: false };

/** Runs one read. A rejection comes back as `{ answered: false }` and never escapes unhandled. */
export async function settleRead<T>(read: () => Promise<T>): Promise<SettledRead<T>> {
  try {
    return { answered: true, data: await read() };
  } catch {
    return { answered: false };
  }
}

/**
 * What Retry asks for. Once a flow is showing, it stays chosen. Before any list loaded, it is the
 * flow a funnel step asked for, and then a missing flow is still worth saying.
 */
export function retryFlowMapArgs(currentId: string, initialFlowId?: string): [string | undefined, boolean] {
  return currentId ? [currentId, false] : [initialFlowId, true];
}

// The Flow map's writes. A write the server never answered cannot be told apart from one it
// took and could not confirm, so the notice says the change may not have gone through; the
// button that sent it is still there to press again.
export const FLOW_MAP_WRITE_UNREACHABLE = {
  save: 'The server did not answer, so this flow may not be saved.',
  timezone: 'The server did not answer, so the timezone may not be saved.',
  create: 'The server did not answer, so a new flow may not have been created.',
  remove: 'The server did not answer, so this flow may not be deleted.',
  enroll: 'The server did not answer, so this email may not be enrolled.',
  suppress: 'The server did not answer, so unengaged people may not be suppressed.'
} as const;

export type FlowMapWrite = keyof typeof FLOW_MAP_WRITE_UNREACHABLE;

export type SentWrite = { answered: true; ok: boolean; data: any } | { answered: false };

/**
 * Sends one write and reads its body. A rejection (no server, or no auth headers) comes back as
 * `{ answered: false }`; an answer whose body is not JSON is still an answer, read as `{}`.
 */
export async function sendFlowWrite(send: () => Promise<Response>): Promise<SentWrite> {
  const settled = await settleRead(async () => {
    const res = await send();
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  });
  return settled.answered ? { answered: true, ...settled.data } : { answered: false };
}
