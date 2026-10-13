/**
 * Model types for the SPA. Domain shapes come from `@artyfact/model`; `ModelJson` is the
 * serialisable `SystemModel` as it arrives in `ModelBundle.model` (`index` dropped, `templates`
 * optional). The bundle is produced by the loader, so every defaulted field is present.
 */
import type { schema, SystemModel } from "@artyfact/model";
import type { ModelBundle } from "../../shared/api";

export type Relation = schema.Relation;
export type Certainty = schema.Certainty;
export type Source = schema.Source;
export type CrossLink = schema.CrossLink;
export type Field = schema.Field;
export type OntologyNode = schema.OntologyNode;
export type External = schema.Externals;
export type Purpose = schema.Purpose;
export type TheoryClaim = schema.TheoryClaim;
export type GDFeature = schema.GDFeature;
export type Commitment = schema.Commitment;
export type Description = schema.Description;
export type Requirement = schema.Requirement;
export type ArtifactBinding = schema.ArtifactBinding;
export type Thing = schema.ResolvedThing;
export type Gate = schema.Gate;
export type TargetKind = schema.TargetKind;
export type Criterion = schema.Criterion;
export type AssayHook = schema.AssayHook;
export type JourneyStep = schema.JourneyStep;
export type Journey = schema.Journey;
export type ModelEvolution = schema.Evolution;
export type SystemFile = schema.SystemFile;
export type KitsFile = schema.KitsFile;


export type ModelJson = Omit<SystemModel, "index" | "templates"> & { templates?: SystemModel["templates"] };

/** Where the bundle came from; the TopBar shows a "fixture data" pill for `fixture`. */
export type BundleSource = NonNullable<ModelBundle["source"]>;

/** `ModelBundle` as the SPA holds it: `model` typed and `source` always set. */
export interface UiBundle extends Omit<ModelBundle, "model" | "source"> {
  model: ModelJson;
  source: BundleSource;
}
