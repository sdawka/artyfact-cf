import { vi } from 'vitest';
import type { SemanticModel } from '../src';

export const okBody = (answers: Record<string, unknown>) => ({ model: 'jev-test', answers, usage: { input_tokens: 10, output_tokens: 2 } });
export const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const mockFetch = (...responders: Array<(init: RequestInit) => Response | Promise<Response>>) => {
  let i = 0;
  return vi.fn(async (_url: unknown, init?: RequestInit) => responders[Math.min(i++, responders.length - 1)]!(init!));
};

export const model: SemanticModel = {
  system: { id: 'sys1', purpose: 'Help two people keep a private, consented conversation.' },
  governing: { criteria: [{ title: 'Private pairs', claim: 'one recipient per send' }], requirements: [{ id: 'R1', text: 'Messages go to one person.' }] },
};
export const commitments = [
  { id: 'C1', statement: 'No group threads.' },
  { id: 'C2', statement: 'Recipients must consent.' },
];
export const change = { id: 'ch1', kind: 'requirement', before: 'Send to one person', after: 'Send to a list', fieldsChanged: ['text'] };
