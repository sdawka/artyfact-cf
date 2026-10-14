import { expect, it } from 'vitest';
import { neverStaged } from '../src/ignore.ts';

it('never stages the task config, the start config or the task packet, at any depth', () => {
 for (const p of ['.artyfact-task.json', 'sub/.artyfact-task.json', '.artyfact.json', 'TASK_PACKET.md', 'docs/TASK_PACKET.md', '.dev.vars', 'node_modules/x.js'])
  expect(neverStaged(p), p).toBe(true);
 for (const p of ['src/app.ts', 'AGENTS.md', 'task_packet.md', '.dev.vars.example', 'artyfact-task.json'])
  expect(neverStaged(p), p).toBe(false);
});
