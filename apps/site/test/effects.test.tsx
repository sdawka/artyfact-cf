import React from 'react';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemExplorer } from '../src/SystemExplorer';
import { orbState } from '../src/orbState';
import { currentSelection, publishSelection } from '../src/systemState';
afterEach(() => { cleanup(); document.body.innerHTML = ''; publishSelection({ layer: 0, subject: 0 }); });

it('gives each view of the System its own orb facet', () => {
  expect(orbState({ layer: 0, subject: 0 }).facet).toBe('genome');
  expect(orbState({ layer: 0, subject: 2 }).facet).toBe('purpose');
  expect(orbState({ layer: 1, subject: 2 }).facet).toBe('proteome');
  expect(orbState({ layer: 2, subject: 1 }).facet).toBe('phenome');
  const presets = new Set([0, 1, 2].map(layer => orbState({ layer, subject: 0 }).preset));
  expect(presets.size).toBe(3);
  expect(orbState({ layer: 0, subject: 2 }).params.color).not.toBe(orbState({ layer: 0, subject: 0 }).params.color);
  // The subject reshapes the orb within a layer.
  expect(orbState({ layer: 1, subject: 1 }).params).not.toEqual(orbState({ layer: 1, subject: 0 }).params);
});

it('reports layer and subject choices without changing its markup', () => {
  const onSelect = vi.fn();
  const { container } = render(<SystemExplorer onSelect={onSelect} />);
  const plain = render(<SystemExplorer />).container.innerHTML;
  expect(container.innerHTML).toBe(plain);
  expect(onSelect).toHaveBeenLastCalledWith({ layer: 0, subject: 0 });
  fireEvent.click(screen.getAllByRole('tab', { name: /Phenome/ })[0]);
  expect(onSelect).toHaveBeenLastCalledWith({ layer: 2, subject: 0 });
  fireEvent.click(screen.getAllByRole('button', { name: /Wanted contact/ })[0]);
  expect(onSelect).toHaveBeenLastCalledWith({ layer: 2, subject: 2 });
});

it('mounts the orb and ambient field into their slots and follows the explorer', async () => {
  document.body.innerHTML = '<div data-ambient></div><div data-hero-orb></div>';
  const { mountEffects } = await import('../src/effects');
  await act(async () => { mountEffects(); });
  const slot = document.querySelector<HTMLElement>('[data-hero-orb]')!;
  // jsdom has no WebGL2, so both effects take the CSS fallback path.
  expect(slot.querySelector('[data-effect="orb"]')?.getAttribute('data-effect-mode')).toBe('fallback');
  expect(document.querySelector('[data-ambient] [data-effect="ambient"]')).toBeTruthy();
  expect(slot.dataset.orbFacet).toBe('genome');
  await act(async () => { publishSelection({ layer: 1, subject: 1 }); });
  expect(currentSelection()).toEqual({ layer: 1, subject: 1 });
  expect(slot.dataset.orbFacet).toBe('proteome');
  expect(slot.dataset.orbState).toBe('Proteome · A private relationship');
});
