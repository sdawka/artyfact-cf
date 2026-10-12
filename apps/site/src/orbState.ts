import type { OrbParams, OrbPresetName } from '@artyfact/effects';
import { layers, subjects } from './SystemExplorer';
import type { SystemSelection } from './systemState';

/**
 * How the hero orb encodes the example System. The layer picks the palette and motion; the subject reshapes it.
 * The Purpose subject seen in the Genome layer is the System's purpose itself, so it gets its own facet.
 * Type-only import from @artyfact/effects: this module stays out of the effects chunk's critical path.
 */
export type Facet = 'purpose' | 'genome' | 'proteome' | 'phenome';
export type OrbState = { facet: Facet; label: string; preset: OrbPresetName; params: Partial<OrbParams>; ambient: string };

const facets: Record<Facet, Omit<OrbState, 'facet' | 'label'>> = {
  // Warm peach ring orbiting a full core: the change wanted for people.
  purpose: { preset: 'apricot', ambient: 'oklch(0.8 0.115 45)', params: { color: 'oklch(0.8 0.115 45)', strands: 7, glow: 1.25, flares: 0.85, motion: 'orbit', fill: 0.6 } },
  // Apricot, steady rise: declared intent and contracts.
  genome: { preset: 'apricot', ambient: 'oklch(0.79 0.125 60)', params: { motion: 'rise', strands: 6, glow: 1 } },
  // Lavender drift with more sparks: work in flight, parallel realizations.
  proteome: { preset: 'dusk', ambient: 'oklch(0.74 0.075 286)', params: { sparks: 0.6, crackle: 0.65, strands: 4.5 } },
  // Slow falling teal: observations settling. The example's evidence is unknown, so the glow stays modest.
  phenome: { preset: 'tide', ambient: 'oklch(0.693 0.055 211.4)', params: { glow: 0.8 } },
};

const subjectShape: Record<string, Partial<OrbParams>> = {
  Operation: { crackle: 0.75, sparks: 0.65 },
  Entity: { fill: 0.72, particleShape: 'round', sway: 0.35 },
  Purpose: { motion: 'orbit' },
};

export function orbState({ layer, subject }: SystemSelection): OrbState {
  const kind = subjects[subject]?.kind ?? 'Operation';
  const layerName = layers[layer]?.name ?? 'Genome';
  const facet: Facet = layerName === 'Genome' && kind === 'Purpose' ? 'purpose' : (layerName.toLowerCase() as Facet);
  const base = facets[facet];
  const params = facet === 'purpose' ? base.params : { ...base.params, ...subjectShape[kind] };
  const label = (facet === 'purpose' ? 'Purpose' : layerName) + ' · ' + (subjects[subject]?.name ?? '');
  return { facet, label, preset: base.preset, params, ambient: base.ambient };
}

/** Angles (radians, 0 = right, π/2 = top) for the response: layers flare across the top, subjects spark below. */
export const layerAngle = (layer: number) => Math.PI * (0.8 - 0.3 * layer);
export const subjectAngle = (subject: number) => Math.PI * (1.25 + 0.25 * subject);
