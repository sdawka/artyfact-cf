import React from 'react';

type Node = { stage: number; title: React.ReactNode; detail: React.ReactNode; kind?: 'commit' | 'fork' | 'promote' | 'shared'; token?: boolean };
type Lane = { id: string; name: string; repo?: string; note?: React.ReactNode; nodes: Node[] };

const stages = ['Import', 'Accept a change', 'Work in forks', 'Integrate', 'Promote'];

// Simplified from the platform: lifecycle-store.ts names forks, lifecycle-service.ts forks, integrates and
// promotes, and system-authority.ts writes the System commit. Sample commit names.
const lanes: Lane[] = [
  { id: 'system', name: 'System head', repo: 'Durable Object', nodes: [
    { stage: 1, title: 'System commit 1', detail: 'Pins model a1 and app b1.' },
    { stage: 2, title: 'System commit 2', detail: 'Pins model a2 and app b1.' },
    { stage: 5, kind: 'promote', title: 'System commit 3', detail: <>Pins model a2 and app c1. Refused if the head moved since review.</> },
  ] },
  { id: 'genome', name: 'Model repo', repo: '<slug>.genome', nodes: [
    { stage: 1, title: 'a1', detail: 'The imported model.' },
    { stage: 2, title: 'a2', detail: 'A change request, accepted.' },
  ] },
  { id: 'app', name: 'App repo', repo: '<slug>.app', nodes: [
    { stage: 1, title: 'b1', detail: 'The imported app.' },
  ] },
  { id: 'tasks', name: 'Task forks', repo: '<slug>.app--task-…', note: <>Agents use plain <code>git clone</code> and <code>git push</code> over HTTPS.</>, nodes: [
    { stage: 3, kind: 'fork', token: true, title: 'Task 1', detail: 'Forked from b1.' },
    { stage: 3, kind: 'fork', token: true, title: 'Task 2', detail: 'Forked from b1.' },
  ] },
  { id: 'integrate', name: 'Integration fork', repo: '<slug>.app--integrate-…', nodes: [
    { stage: 4, kind: 'fork', title: 'c1', detail: 'The selected Task results, combined into one commit.' },
  ] },
  { id: 'platform', name: 'Shared repo', repo: 'platform', nodes: [
    { stage: 1, kind: 'shared', title: 'Templates and Rule Packs', detail: 'Shared by every System. Its commit is recorded at import.' },
  ] },
];

const pieces: { name: string; text: React.ReactNode; soon?: boolean }[] = [
  { name: 'Artifacts', text: 'Git repos for the model and the app, a fork per Task, and write tokens scoped to one fork.' },
  { name: 'Artifacts binding', text: 'The Worker reads commits and trees directly. It writes with a small built-in Git push, not a Git library.' },
  { name: 'Workers + Static Assets', text: 'The platform Worker serves the API and the review app.' },
  { name: 'Durable Object + SQLite', text: 'One per System. It holds the head and the history, and runs the compare-and-swap promote.' },
  { name: 'Workflows + Containers + R2', text: 'The artyfact-ci Worker runs a Workflow that builds each app commit in a container and deploys previews and production. R2 holds workspace snapshots and the install cache.' },
  { name: 'Queues', text: <>Push events from Artifacts. Optional: the CLI submits directly.</> },
  { name: 'Flagship', text: 'Feature flags are shown next to deployments and metrics. An admin can create, update or turn off a flag, with a reason, and each change is logged.' },
  { name: 'Email', soon: true, text: 'Review requests and promotion notices, through Cloudflare Email Service.' },
];

function Branch() {
  return <svg className="backbone-branch" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false"><path d="M2 2v8a12 12 0 0 0 12 12h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" pathLength={1} /></svg>;
}

/** Static: lanes are lists of commits and forks, each tagged with its stage. CSS lays them out as a branching history. */
export function ArtifactsBackbone() {
  return <section className="section artifacts-backbone" id="cloudflare" aria-labelledby="cloudflare-heading">
    <div className="section-heading"><h2 id="cloudflare-heading">Built on Cloudflare.</h2><p>Each Cloudflare product has one job. Artifacts, Cloudflare’s Git storage, is the backbone: it holds the product’s history and gives every Task its own isolated copy. You run all of it in your own account.</p></div>
    <figure className="backbone" id="artifacts" aria-labelledby="backbone-caption">
      <figcaption id="backbone-caption">One System’s history, from import to a promoted change. Sample commits.</figcaption>
      <div className="backbone-stages" aria-hidden="true">{stages.map((stage, index) => <span key={stage}>{index + 1}. {stage}</span>)}</div>
      {lanes.map(lane => <div key={lane.id} className="backbone-lane" data-lane={lane.id}>
        <h3 className="backbone-lane-name">{lane.name}{lane.repo && <code>{lane.repo}</code>}</h3>
        {lane.note && <p className="backbone-lane-note">{lane.note}</p>}
        <ol>{lane.nodes.map((node, index) => <li key={index} className="backbone-node" data-stage={node.stage} data-kind={node.kind ?? 'commit'}>
          {node.kind === 'fork' && <Branch />}
          <span className="backbone-stage">{node.stage}. {stages[node.stage - 1]}</span>
          <strong>{node.title}</strong>
          <span className="backbone-detail">{node.detail}</span>
          {node.token && <span className="backbone-token">Token for this fork only. 15 min, max 60.</span>}
        </li>)}</ol>
      </div>)}
    </figure>
    <dl className="backbone-pieces">
      {pieces.map(piece => <div key={piece.name} data-status={piece.soon ? 'coming-soon' : 'shipped'}><dt>{piece.name}{piece.soon && <span className="term-label">Coming soon</span>}</dt><dd>{piece.text}</dd></div>)}
    </dl>
  </section>;
}
