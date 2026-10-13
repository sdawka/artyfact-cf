export type LandingView = 'genome' | 'proteome' | 'phenome';
export type LandingSubject = 'app' | 'starter' | 'components' | 'runtime';

export const landingSubjects: Record<LandingSubject, {
  title: string;
  summary: Record<LandingView, string>;
  detail: string;
}> = {
  app: {
    title: 'Fieldnotes application',
    summary: {
      genome: 'One fullstack application: a place to capture and revisit fieldnotes. Its shape and contracts come first.',
      proteome: 'The same application now has source and a realized build. Its interface, API and storage belong together.',
      phenome: 'The same application, with illustrative activity. A saved record is observable; useful outcomes still need evidence.',
    },
    detail: 'The Astro starter and component system are composed as Parts. Source S1, output B1 and runtime R1 remain distinct identities: the build comes from the source, and activity belongs to that runtime.',
  },
  starter: {
    title: 'Astro starter Part',
    summary: {
      genome: 'The starter supplies the planned application structure, routes and server contract.',
      proteome: 'The pinned Astro starter contributes source to this application through an explicit composition recipe.',
      phenome: 'Activity is observed in the application runtime, with provenance back to the starter contribution.',
    },
    detail: 'Astro starter v1.2.0 is an illustrative pinned Part version. Its contribution becomes part of application source S1; the Part itself is not the realized output B1 or runtime R1.',
  },
  components: {
    title: 'Component system Part',
    summary: {
      genome: 'The component system supplies interface contracts, including the Button used to save a record.',
      proteome: 'An explicit Button override lets the component system replace the starter’s Button contribution.',
      phenome: 'The composed Button is still part of the same application. Sample save activity does not measure its usefulness.',
    },
    detail: 'The component system replaces the starter’s Button contribution. The recipe uses a caller adapter to adapt existing Button calls and a config adapter to adapt the starter’s configuration. Component system v2.4.0 is an illustrative pinned version; the override and both adapters are recorded composition choices.',
  },
  runtime: {
    title: 'API and storage',
    summary: {
      genome: 'The application calls its records API; the API persists records in storage. These are declared relationships.',
      proteome: 'The app, records API and storage are realized as one fullstack application, with runtime identity R1.',
      phenome: 'The requests, latency, error rate and saved-record event are sample observations, not live measurements.',
    },
    detail: 'Runtime R1 is associated with output B1 and source S1. Sample operational signals show what could be observed; outcome evidence remains unmeasured until observations from people establish it.',
  },
};

// Fixed decoration, prepared once. It deliberately carries no System relationships.
export const landingConstellationPoints = [
  [22, 64], [96, 26], [164, 56], [268, 24], [366, 58], [479, 23], [604, 46],
  [687, 110], [657, 242], [711, 330], [570, 373], [422, 352], [189, 372], [40, 309],
] as const;
const edgePairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 0], [2, 12]] as const;
export const landingConstellationEdges = edgePairs.map(([start, end]) => ({
  start: landingConstellationPoints[start], end: landingConstellationPoints[end],
}));
