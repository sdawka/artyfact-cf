// How it works is drawn from the repository's own Genome: these check the derived workflow and its static rendering.
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import { loadSelfGenome } from '../src/selfGenome';
import { deriveWorkflow } from '../src/workflow';
import { HowItWorks } from '../src/HowItWorks';

const model = loadSelfGenome();
const workflow = deriveWorkflow(model);
const ids = new Set(model.graph.nodes.map(n => n.id));

describe('the genome-derived workflow', () => {
  it('has the expected phases, in the journey order', () => {
    expect(workflow.journey.id).toBe('J.lifecycle');
    expect(workflow.phases.map(p => p.name)).toEqual([
      'Describe the product', 'Agree the change', 'Plan the work', 'Work in parallel', 'Check each candidate',
      'Combine and review', 'Promote', 'Deploy', 'Observe', 'Revise',
    ]);
    expect(workflow.phases.map(p => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('fans out to parallel Tasks after planning and joins before review, then loops back to agreeing a change', () => {
    expect(workflow.phases.filter(p => p.parallel).map(p => p.id)).toEqual(['work-in-parallel', 'check-each-candidate']);
    expect(workflow.fanOut).toBe('for each Task, in parallel');
    expect(workflow.join).toBe('once every Task has a candidate');
    expect(workflow.loop).toEqual({ to: 'agree-the-change', when: 'the next change' });
  });

  it('links only node ids that exist in the Genome', () => {
    const linked = workflow.phases.flatMap(p => p.nodeIds);
    expect(linked.length).toBeGreaterThan(50);
    expect(linked.filter(id => !ids.has(id))).toEqual([]);
    for (const phase of workflow.phases) expect(phase.nodeIds.some(id => id.startsWith('J.lifecycle/')), phase.id).toBe(true);
  });

  it('names who acts, the real commands and the guardrails from the model', () => {
    const step = (id: string) => workflow.phases.flatMap(p => p.steps).find(s => s.id === 'J.lifecycle/' + id)!;
    expect(step('submit').actor).toBe('agent');
    expect(step('claim').actor).toBe('person');
    expect(step('check').actor).toBe('platform');
    expect(step('deploy').actor).toBe('ci');
    expect(step('claim').commands.map(c => c.detail)).toEqual(['artyfact task claim <plan-id> <task-id> --system <system-id> --dir <dir>']);
    expect(step('promote').guardrails.map(g => g.id)).toContain('commitment.cas-promotion');
    expect(step('check').modules.map(m => m.id)).toContain('module.platform.hooks');
    expect(step('deploy').runtime.map(r => r.id)).toEqual(['workflow.artyfact-ci']);
    for (const s of workflow.phases.flatMap(p => p.steps)) for (const c of s.commands) expect(c.detail, c.id).toMatch(/^artyfact /);
  });

  it('fails instead of drawing a journey without phases', () => {
    expect(() => deriveWorkflow(model, 'J.compare')).toThrow(/no phases/);
    expect(() => deriveWorkflow(model, 'J.missing')).toThrow(/no phases/);
  });
});

describe('the How it works page', () => {
  it('renders every phase as a closed disclosure with what happens, who acts, commands, guardrails and model ids', () => {
    const { container } = render(<HowItWorks workflow={workflow} />);
    const phases = [...container.querySelectorAll<HTMLElement>('.flow-phase')];
    expect(phases).toHaveLength(10);
    for (const phase of phases) {
      const details = phase.querySelector('details')!;
      expect(details.open).toBe(false);
      expect([...details.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['What happens', 'Who acts', 'Command or screen', 'Guardrails', 'In the model']);
      for (const node of details.querySelectorAll<HTMLElement>('[data-model-node]')) expect(ids.has(node.dataset.modelNode!), node.dataset.modelNode).toBe(true);
    }
    expect(container.querySelectorAll('.flow-parallel > .flow-phase')).toHaveLength(2);
    expect(container.querySelector('.flow-parallel')?.getAttribute('start')).toBe('4');
    expect(within(container.querySelector<HTMLElement>('#phase-check-each-candidate')!).getByText(/Cloudflare Clef/)).toBeTruthy();
    expect(container.querySelector('#phase-check-each-candidate')!.textContent).toContain('task submit --screenshot');
    expect(container.querySelector('.flow-loop a')?.getAttribute('href')).toBe('#phase-agree-the-change');
    expect(container.textContent).toContain('page.how-it-works');
    expect(container.querySelector('[style]')).toBeNull();
  });
});
