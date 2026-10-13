export type LandingView = 'genome' | 'proteome' | 'phenome';
export type LandingSubject = 'app' | 'starter' | 'components' | 'runtime';

export type LandingDemo = {
  count: number;
  pressing: boolean;
  showPointer: boolean;
  celebrating: boolean;
  showToast: boolean;
  onSave: () => void;
  paused: boolean;
  completed: boolean;
  onPause: () => void;
  onResume: () => void;
};

export const landingIdeas = [
  { name: 'Trailkeepers', purpose: 'Help neighbors care for the places they share.' },
  { name: 'Small Signals', purpose: 'Make everyday observations useful to a community.' },
  { name: 'Open Table', purpose: 'Bring people together through shared meals.' },
  { name: 'Repair Circle', purpose: 'Keep useful things in use through shared repair.' },
  { name: 'Local Threads', purpose: 'Connect local knowledge to people who need it.' },
  { name: 'Growing Room', purpose: 'Make space for people to learn together.' },
] as const;

export const landingSubjects: Record<LandingSubject, {
  title: string;
  summary: Record<LandingView, string>;
  detail: string;
}> = {
  app: {
    title: 'Artyfact application',
    summary: {
      genome: 'A System starts with its name and purpose. The shape declares how ideas become an application.',
      proteome: 'Coding agents realize that shape as an application, API and storage. The same slots now have a concrete implementation.',
      phenome: 'Randomize an idea and watch the sample activity grow. This local illustration does not measure useful outcomes.',
    },
    detail: 'The Astro starter and component system are composed as Parts. Source S1, output B1 and runtime R1 remain distinct identities: the build comes from the source, and activity belongs to that runtime.',
  },
  starter: {
    title: 'Astro starter Part',
    summary: {
      genome: 'The starter supplies the planned application structure, routes and server contract.',
      proteome: 'The pinned Astro starter contributes source through an explicit composition recipe.',
      phenome: 'Activity is observed in the application runtime, with provenance back to the starter contribution.',
    },
    detail: 'Astro starter v1.2.0 is an illustrative pinned Part version. Its contribution becomes part of application source S1; the Part itself is not the realized output B1 or runtime R1.',
  },
  components: {
    title: 'Component system Part',
    summary: {
      genome: 'The component system supplies interface contracts, including the Randomize Button.',
      proteome: 'An explicit Button override replaces the starter’s Button contribution.',
      phenome: 'The composed Button is part of the same application. Sample activity does not measure its usefulness.',
    },
    detail: 'The component system replaces the starter’s Button contribution in source S1, which builds output B1 and runs as runtime R1. The recipe uses a caller adapter to adapt existing Button calls and a config adapter to adapt the starter’s configuration. Component system v2.4.0 is an illustrative pinned version; the override and both adapters are recorded composition choices.',
  },
  runtime: {
    title: 'API and storage',
    summary: {
      genome: 'The application calls its ideas API; the API persists ideas in storage. These are declared relationships.',
      proteome: 'The app, ideas API and storage form one fullstack application, with runtime identity R1.',
      phenome: 'Ideas explored is a sample activity count. It is not live traffic or evidence of useful outcomes.',
    },
    detail: 'Runtime R1 is associated with output B1 and source S1. Sample operational signals show what could be observed; outcome evidence remains unmeasured until observations from people establish it.',
  },
};
