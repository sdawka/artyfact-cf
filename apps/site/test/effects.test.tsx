import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemExplorer } from '../src/SystemExplorer';
import { currentSelection, publishSelection } from '../src/systemState';
afterEach(() => { cleanup(); document.body.innerHTML = ''; publishSelection({ layer: 0, subject: 0 }); });

it('reports layer choices without changing its markup', () => {
  const onSelect = vi.fn();
  const { container } = render(<SystemExplorer onSelect={onSelect} />);
  const plain = render(<SystemExplorer />).container.innerHTML;
  expect(container.innerHTML).toBe(plain);
  expect(onSelect).toHaveBeenLastCalledWith({ layer: 0, subject: 0 });
  fireEvent.click(screen.getAllByRole('tab', { name: /Phenome/ })[0]);
  expect(onSelect).toHaveBeenLastCalledWith({ layer: 2, subject: 0 });
  expect(screen.getAllByText(/Explain Artyfact clearly/)).toHaveLength(2);
});

it('mounts ambient atmosphere without bringing back the literal hero orb', async () => {
  document.body.innerHTML = '<div data-ambient></div><div data-hero-orb></div>';
  const { mountEffects } = await import('../src/effects');
  await act(async () => { mountEffects(); });
  expect(document.querySelector('[data-ambient] [data-effect="ambient"]')?.getAttribute('data-effect-mode')).toBe('fallback');
  expect(document.querySelector('[data-effect="orb"]')).toBe(null);
  await act(async () => { publishSelection({ layer: 1, subject: 1 }); });
  expect(currentSelection()).toEqual({ layer: 1, subject: 1 });
  expect(document.querySelector('[data-effect="orb"]')).toBe(null);
});

it('keeps CSS fallbacks on software-rendered WebGL (the package guard)', async () => {
  document.body.innerHTML = '<div data-ambient></div><div data-hero-orb></div>';
  vi.stubGlobal('WebGL2RenderingContext', class {});
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { RENDERER: 1, getParameter: () => 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)', getExtension: () => null } as never);
  const { mountEffects } = await import('../src/effects');
  await act(async () => { mountEffects(); });
  expect(getContext).toHaveBeenCalledWith('webgl2', { failIfMajorPerformanceCaveat: true });
  expect(document.querySelector('[data-effect="orb"]')).toBe(null);
  expect(document.querySelector('[data-ambient] [data-effect="ambient"]')?.getAttribute('data-effect-mode')).toBe('fallback');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
