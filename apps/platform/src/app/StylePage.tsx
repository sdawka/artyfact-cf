import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AmbientField, SurfaceField, SURFACE_PRESET_NAMES, type AmbientFieldHandle, type SurfaceHandle, type SurfacePresetName,
} from "@artyfact/effects";
import { DotsHorizontalIcon, GearIcon, PlusIcon } from '@radix-ui/react-icons';
import { Button, IconButton, Input, Textarea, Checkbox, Select, Menu, Popover, Dialog, Sheet, ToggleGroup, Tabs } from '@/components/ui';
import { Card } from '@/components/Card/Card';
import { StatusChip } from '@/components/StatusChip/StatusChip';
import { VerdictBadge } from '@/components/VerdictBadge/VerdictBadge';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageHeader, ScopePath } from '@/components/PageHeader/PageHeader';
import { Section } from '@/components/Section/Section';
import { Panel } from '@/components/Panel/Panel';
import { ListDetail } from '@/components/ListDetail/ListDetail';
import { Row, RowList } from '@/components/RowList/RowList';
import { MetaLine } from '@/components/MetaLine/MetaLine';
import { StatusText } from '@/components/StatusText/StatusText';
import { Count } from '@/components/Count/Count';
import { Kbd } from '@/components/Kbd/Kbd';
import { Steps } from '@/components/Steps/Steps';
import { Check, Field, Form, FormActions, Reason } from '@/components/Form/Form';
import { Facts } from '@/components/Facts/Facts';
import { CommandBlock } from '@/components/CommandBlock/CommandBlock';
import { NodeChip } from '@/components/NodeChip/NodeChip';
import { EffectsPreferenceProvider, useEffectsPreference } from '@/effects/effectsPreference';
import { contrast } from './styleContrast';
import styles from "./StylePage.module.css";

const TABS = ["Overview", "Map", "Work"];

const PRESET_USE: Record<SurfacePresetName, string> = {
  apricot: "Accent. Default, neutral or in progress.",
  verdant: "Success. Every gate passes.",
  ember: "Error. Failing or blocked.",
  tide: "Info. Waiting on evidence.",
  dusk: "Background hue. Idle or ambient.",
};

const TYPE_ROLES: Array<{ token: string; use: string; sample: string; tracking?: string }> = [
  { token: "--type-display", tracking: "--type-display-tracking", use: "Site hero h1 only", sample: "Keep track of the product" },
  { token: "--type-display-2", tracking: "--type-display-2-tracking", use: "Site section h2", sample: "See it working" },
  { token: "--type-system", tracking: "--type-h1-tracking", use: "Overview h1: the System name", sample: "Peopling" },
  { token: "--type-h1", tracking: "--type-h1-tracking", use: "Every other page h1", sample: "Review" },
  { token: "--type-h1-compact", use: "Canvas h1 (Map, Journeys)", sample: "Map" },
  { token: "--type-h2", use: "Section titles, UI face", sample: "Builds" },
  { token: "--type-h3", use: "Card, panel and group titles", sample: "Model readiness" },
  { token: "--type-body", use: "Default text, purpose lines", sample: "Decisions waiting on you, oldest first." },
  { token: "--type-prose", use: "Reading pages, 68ch", sample: "A System is what you are building and why." },
  { token: "--type-ui", use: "Rows, tables, chips, field labels", sample: "2 tasks await an agent" },
  { token: "--type-control", use: "Button and select labels", sample: "Describe a change" },
  { token: "--type-meta", use: "Meta lines, timestamps", sample: "started 3 min ago   head sc-1-e12083f7" },
  { token: "--type-hint", use: "Keyboard hints and legend keys only", sample: "Drag to pan" },
  { token: "--type-code-block", use: "Ids, shas, commands, paths", sample: "candidate.1.r1.5744c33  Il1 O0 rn m" },
];

const COLOURS: Array<{ token: string; use: string }> = [
  { token: "--color-text-primary", use: "Text, links (with the underline)" },
  { token: "--color-text-secondary", use: "Purpose lines, meta" },
  { token: "--color-text-subtle", use: "Labels, inventory counts, neutral status" },
  { token: "--color-attention", use: "Waiting on you; active nav; the primary" },
  { token: "--color-danger", use: "Fail, hard conflict" },
  { token: "--color-success", use: "Pass and passed only" },
  { token: "--color-info", use: "Information" },
];

const SURFACES: Array<{ token: string; use: string }> = [
  { token: "--surface-well", use: "Code, commands, inset derivations (down)" },
  { token: "--surface-page", use: "Page, main column" },
  { token: "--surface-panel", use: "Cards, panels, queue, detail pane" },
  { token: "--surface-raised", use: "Current or hovered row, inputs on a panel" },
  { token: "--surface-overlay", use: "Menus, popovers, dialogs, sheets (up)" },
];

/** A reference block: what the sample is, the sample, and its `data-style-sample` id for audits. */
function Sample({ id, label, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <figure className={styles.sample} data-style-sample={id}>
      <figcaption className={styles.sampleLabel}>{label}</figcaption>
      <div className={styles.sampleBody}>{children}</div>
    </figure>
  );
}

function Swatch({ token, use, surface = false }: { token: string; use: string; surface?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const body = getComputedStyle(document.body);
    setRatio(surface ? contrast(body.color, cs.backgroundColor) : contrast(cs.color, body.backgroundColor));
  }, [surface]);
  return (
    <li className={styles.swatch} data-style-sample={`colour${token}`}>
      <span ref={ref} className={styles.chipSample} style={surface ? { background: `var(${token})` } : { color: `var(${token})` }} aria-hidden="true">
        {surface ? "" : "Aa"}
      </span>
      <span className={styles.swatchText}>
        <code>{token}</code>
        <span>{use}</span>
        <span className={styles.ratio}>{ratio === null ? "contrast unknown" : `${ratio.toFixed(1)}:1 ${surface ? "with primary text" : "on the page"}`}</span>
      </span>
    </li>
  );
}

function SurfaceTile({ preset }: { preset: SurfacePresetName }) {
  const surface = useRef<SurfaceHandle>(null);
  return (
    <figure className={styles.surfaceTile} data-preset={preset}>
      <div className={styles.surfaceBox}>
        <SurfaceField ref={surface} preset={preset} level={.65} activity={.3} density={.4} />
        <div className={styles.surfaceContent}><h3>{preset}</h3><p>{PRESET_USE[preset]}</p></div>
      </div>
      <figcaption>
        <span className={styles.muted}>Illustrative System state.</span>
      </figcaption>
      <Button onClick={() => surface.current?.pulse(1)}>
        Pulse<span className="sr-only"> {preset}</span>
      </Button>
    </figure>
  );
}

function EffectsSection() {
  const {enabled, setEnabled} = useEffectsPreference();
  const [intensity, setIntensity] = useState(0.5);
  const field = useRef<AmbientFieldHandle>(null);
  return (
    <section className={styles.block} data-style-sample="effects">
      <h2>Signature effects</h2>
      <p className={styles.lead}>
        Glow and haze mark signature moments, state changes and selection. They are decorative, follow reduced motion,
        and the page reads the same with them off. One SurfaceField per view at most, besides the Shell's ambient field.
      </p>
      <label className={styles.toggle}>
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Effects on
      </label>
      <div className={styles.surfaceGrid}>
        {SURFACE_PRESET_NAMES.map((p) => <SurfaceTile key={p} preset={p} />)}
      </div>

      <h3>Ambient field</h3>
      <div
        className={styles.ambientPanel}
        data-testid="ambient-panel"
        onPointerDown={(e) => field.current?.pulse(e.clientX, e.clientY, 1)}
      >
        <AmbientField ref={field} intensity={intensity} density={0.5} />
        <p className={styles.ambientText}>Click inside the panel to send a ripple.</p>
      </div>
      <label className={styles.toggle}>
        Intensity{" "}
        <input type="range" min={0} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
      </label>

      <h3>Glow tokens: selection and status only</h3>
      <p className={styles.glows}>
        <span className={styles.glow} data-glow="selection">selection</span>
        <span className={styles.glow} data-glow="attention">status attention</span>
        <span className={styles.glow} data-glow="fail">status fail</span>
        <span className={styles.glow} data-glow="pass">status pass</span>
      </p>
    </section>
  );
}

/** Living examples use the same controls and persisted Effects preference as the application. */
export function StylePage() {
  return <EffectsPreferenceProvider><StyleExamples /></EffectsPreferenceProvider>;
}

function StyleExamples() {
  const [tab,setTab] = useState('Map');
  const [filter,setFilter] = useState('');
  const [dialog,setDialog] = useState(false);
  const [sheet,setSheet] = useState(false);
  const [choice,setChoice] = useState('Nothing selected');
  const [pressed,setPressed] = useState(true);
  const [panelOpen,setPanelOpen] = useState(false);
  const [row,setRow] = useState<string | null>("candidate");
  const effects = useEffectsPreference();
  return <main id="main" className={styles.page} data-effects={effects.enabled ? 'on' : 'off'}>
    <p className={`wordmark ${styles.wordmark}`}>artyfact</p>
    <PageHeader
      title="Style sheet"
      context={null}
      purpose="Every shared primitive and state, set in the shipped tokens. Compare views against these, not against each other."
    />

    <section className={styles.block}>
      <h2>Type</h2>
      <p className={styles.lead}>Alegreya for the one h1 per view and the wordmark, Atkinson Hyperlegible Next for everything else, Atkinson Hyperlegible Mono for values you could paste. Components name a role token, never a size.</p>
      <ul className={styles.typeList}>
        {TYPE_ROLES.map((r) => (
          <li key={r.token} data-style-sample={`type${r.token}`}>
            <span className={styles.typeSample} style={{ font: `var(${r.token})`, letterSpacing: r.tracking ? `var(${r.tracking})` : undefined }}>{r.sample}</span>
            <span className={styles.typeMeta}><code>{r.token}</code> {r.use}</span>
          </li>
        ))}
        <li data-style-sample="type--type-numeric">
          <span className={styles.typeSample}><span className="u-numeric">1,204  37  0.82</span></span>
          <span className={styles.typeMeta}><code>--type-numeric</code> Counts and durations, tabular figures (<code>.u-numeric</code>)</span>
        </li>
      </ul>
    </section>

    <section className={styles.block}>
      <h2>Colour</h2>
      <p className={styles.lead}>Apricot is the operator's colour: where you are, what you can do, what waits on you. Success is for pass only.</p>
      <ul className={styles.swatches}>{COLOURS.map((c) => <Swatch key={c.token} {...c} />)}</ul>
    </section>

    <section className={styles.block}>
      <h2>Surfaces</h2>
      <p className={styles.lead}>Wells go down, overlays go up, one step per containment, at most two steps on a page.</p>
      <ul className={styles.swatches}>{SURFACES.map((c) => <Swatch key={c.token} {...c} surface />)}</ul>
    </section>

    <section className={styles.block}>
      <h2>Links and markers</h2>
      <Sample id="link" label="Link in text: text colour, 1px apricot underline">
        <p>Read the <a href="/style">task packet</a> before you start work.</p>
      </Sample>
      <Sample id="marker" label="Marker: the one next step in an empty state or ledger row">
        <p>2 await your review. <a className="u-marker" href="/style">Open in Review</a></p>
      </Sample>
      <Sample id="scope-path" label="Scope path (PageHeader context)">
        <ScopePath label="Sample scope path" crumbs={[{ label: "Peopling", to: "/style" }, { label: "Web app", to: "/style" }, { label: "Work" }]} />
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Buttons</h2>
      <Sample id="button-variants" label="Primary once per view; secondary; ghost; danger; compact">
        <div className={styles.controls}>
          <Button variant="primary">Describe a change</Button><Button>Compare</Button><Button variant="ghost">Copy</Button>
          <Button variant="danger">Reject candidate</Button><Button size="compact"><PlusIcon aria-hidden="true" />Evolution</Button>
          <IconButton label="Settings" variant="ghost"><GearIcon /></IconButton>
        </div>
      </Sample>
      <Sample id="button-reason" label="Disabled with a visible reason (aria-describedby)">
        <div className={styles.controls}>
          <Button variant="primary" reason="Set the admin token in the header.">Create System</Button>
        </div>
        <div className={styles.controls}>
          <Button reason="No files changed yet.">Commit</Button>
        </div>
      </Sample>
      <Sample id="button-pressed" label="Toggle (aria-pressed), on and off; ghost toggles use the selection rule">
        <div className={styles.controls}>
          <Button aria-pressed={pressed} onClick={() => setPressed(!pressed)}>Effects</Button>
          <Button aria-pressed={!pressed} onClick={() => setPressed(!pressed)}>Plans</Button>
          <Button variant="ghost" aria-pressed={pressed} onClick={() => setPressed(!pressed)}>src/app.ts</Button>
        </div>
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Fields and forms</h2>
      <Sample id="form" label="Form, Field, Check, FormActions, Reason">
        <Form aria-label="Example form" onSubmit={(e) => e.preventDefault()}>
          <Field label="Title"><Input name="title" placeholder="Describe the change" required /></Field>
          <Field label="Context"><Textarea name="context" placeholder="What should happen?" /></Field>
          <Check><Checkbox defaultChecked /> Include supporting evidence</Check>
          <Field label="Unavailable field"><Input disabled value="Waiting for evidence" readOnly /></Field>
          <Field label="Scope"><Select label="Scope" name="scope" value={filter} onChange={setFilter} options={[{value:'',label:'All',group:'Scope'},{value:'genome',label:'Genome',group:'Scope'},{value:'proteome',label:'Proteome',group:'Scope'},{value:'phenome',label:'Phenome',group:'Scope'},{value:'unavailable',label:'Unavailable',disabled:true,group:'Other'}]} /></Field>
          <Reason>Promotion needs every blocking gate to pass.</Reason>
          <FormActions><Button type="submit" variant="primary">Create Evolution</Button><Button>Cancel</Button></FormActions>
        </Form>
      </Sample>
      <Sample id="facts" label="Facts">
        <Facts items={[{ term: "Phase", value: "build" }, { term: "Head", value: <code>sc-1-e12083f7</code> }, { term: "Template", value: "unknown" }]} />
      </Sample>
      <Sample id="command-block" label="CommandBlock">
        <CommandBlock title="Bring your agent" commands={["npx artyfact claim realization.1.r1", "npx artyfact start"]}>
          <p>Run these in your checkout.</p>
        </CommandBlock>
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Page structure</h2>
      <Sample id="page-header-standard" label="PageHeader standard (context, h1, purpose, actions, status)">
        <PageHeader titleId="sample-h1-standard" title="Work" context={<ScopePath label="Sample scope" crumbs={[{ label: "Peopling", to: "/style" }, { label: "Web app", to: "/style" }, { label: "Work" }]} />}
          purpose="Genome Evolutions and the Task plans that realize them." secondary={<Button><PlusIcon aria-hidden="true" />Evolution</Button>}
          primary={<Button variant="primary">Describe a change</Button>} status={<StatusChip status="waiting" label="2 waiting" tone="attention" glyph="◔" />} />
      </Sample>
      <Sample id="page-header-system" label="PageHeader system (Overview)">
        <PageHeader titleId="sample-h1-system" variant="system" title="Peopling" context={null} purpose="Help people keep in touch with the people who matter to them." primary={<Button variant="primary">Describe a change</Button>} />
      </Sample>
      <Sample id="page-header-compact" label="PageHeader compact (canvas): the purpose is the h1's description">
        <PageHeader titleId="sample-h1-compact" variant="compact" title="Map" purpose="Where each part of Peopling sits and what it touches."
          context={<ScopePath label="Sample map scope" crumbs={[{ label: "Environment", to: "/style" }, { label: "Peopling", to: "/style" }, { label: "Web app" }]} />}
          secondary={<Button size="compact">Tree</Button>} primary={<Button size="compact" variant="primary">Details</Button>}>
          <span className={styles.hints}><Kbd keys={["Enter"]} /> enter <Kbd keys={["D"]} /> details</span>
        </PageHeader>
      </Sample>
      <Sample id="section" label="Section (no surface) and Section surface=panel, with a count">
        <Section title="Builds" count={2} description="Newest first." actions={<Button size="compact">Refresh</Button>}><p className={styles.muted}>Rows go here.</p></Section>
        <Section title="Operations" headingLevel={3} surface="panel"><p className={styles.muted}>A panel groups controls.</p></Section>
      </Sample>
      <Sample id="panel" label="Panel replaces the region it is about; Back returns focus to the opener">
        {panelOpen
          ? <Panel title="New Evolution" onBack={() => setPanelOpen(false)} backLabel="Back to board" primary={<Button variant="primary" onClick={() => setPanelOpen(false)}>Create Evolution</Button>}>
              <p className={styles.muted}>The board is replaced while this is open.</p>
            </Panel>
          : <div className={styles.region}><p>Board region.</p><Button onClick={() => setPanelOpen(true)}><PlusIcon aria-hidden="true" />Evolution</Button></div>}
      </Sample>
      <Sample id="card" label="Card: one distinct object, padding 20, never for lists">
        <Card title="Model readiness" headingLevel={3}><p className={styles.muted}>4 pass, 1 unknown</p></Card>
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Lists and workbench</h2>
      <Sample id="row-list" label="RowList and Row: the whole row is the target; current = left rule + one surface step">
        <RowList label="Sample queue">
          <Row onSelect={() => setRow("candidate")} current={row === "candidate"} title="Private contact foundation" meta={<MetaLine items={[{ label: "candidate", value: "candidate.1.r1.5744c33", code: true }, { value: "agent-app" }]} />} status={<StatusText status="waiting" label="await review" tone="attention" />} />
          <Row onSelect={() => setRow("promotion")} current={row === "promotion"} title="Goal tracking" meta={<MetaLine items={[{ label: "started", value: "3 min ago" }]} />} status={<StatusText status="ready" label="ready to promote" />} trailing={<Button size="compact">Open</Button>} />
          <Row onSelect={() => setRow("failed")} current={row === "failed"} title="Contact log" tone="fail" status={<StatusText status="failed" tone="fail" label="build failed" />} />
        </RowList>
      </Sample>
      <Sample id="row-list-compact" label="RowList compact (non-interactive rows)">
        <RowList label="Sample events" density="compact">
          <Row title="contact.logged" meta={<MetaLine items={[{ label: "version", value: "e12083f", code: true }, { value: "2 min ago" }]} />} />
          <Row title="goal.saved" meta={<MetaLine items={[{ label: "version", value: "e12083f", code: true }, { value: "9 min ago" }]} />} />
        </RowList>
      </Sample>
      <Sample id="list-detail" label="ListDetail: list 20rem and detail; one pane below 900px with a back link">
        <ListDetail listLabel="Sample list" detailLabel="Sample detail" hasSelection={row !== null} onBack={() => setRow(null)} backLabel="Back to queue"
          list={<RowList label="Sample list rows"><Row onSelect={() => setRow("candidate")} current={row === "candidate"} title="Private contact foundation" /><Row onSelect={() => setRow("promotion")} current={row === "promotion"} title="Goal tracking" /></RowList>}
          detail={<div className={styles.detail}><h3>{row ?? "Nothing selected"}</h3><MetaLine items={[{ label: "head", value: "sc-1-e12083f7", code: true }, { label: "started", value: "3 min ago", title: "2026-10-14T12:00:00Z" }]} /></div>} />
      </Sample>
      <Sample id="steps" label="Steps (Start only: a real sequence)">
        <Steps label="Sample steps" steps={[
          { id: "name", title: "Name your System", state: "done", summary: <code>system.peopling</code> },
          { id: "preview", title: "Preview your ontology", state: "current" },
          { id: "review", title: "Review the import", state: "todo" },
          { id: "build", title: "Build with your agent", state: "todo" },
        ]}><p>Paste a native package, then preview it.</p><FormActions><Button variant="primary">Preview import</Button></FormActions></Steps>
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Status, counts and keys</h2>
      <Sample id="status-text" label="StatusText: inline glyph and word, no border">
        <div className={styles.controls}>
          <StatusText status="waiting" label="2 await review" tone="attention" /><StatusText status="failed" label="deploy failed" tone="fail" />
          <StatusText status="passed" tone="pass" /><StatusText status="not-deployed" label="not deployed" />
        </div>
      </Sample>
      <Sample id="status-chip" label="StatusChip (headers, one per row) and VerdictBadge">
        <div className={styles.controls}>
          <StatusChip status="needs-review" label="Needs review" tone="attention" glyph="◔" />
          {(['pass','fail','unknown','stale','not-run'] as const).map(verdict=><VerdictBadge key={verdict} verdict={verdict} />)}
        </div>
      </Sample>
      <Sample id="verdict-row" label="Verdict row: the criterion's kind glyph is hidden, so ✓ only means pass">
        <div className={styles.controls}><NodeChip id="C.sample" label="Saves a goal" kind="criterion" interactive={false} glyph={false} /><VerdictBadge verdict="not-run" /></div>
      </Sample>
      <Sample id="count" label="Count: attention (hidden at zero, with screen-reader words) and inventory">
        <div className={styles.controls}>
          <a href="/style">Review <Count n={2} tone="attention" srLabel="waiting" /></a>
          <a href="/style">Work <Count n={0} tone="attention" srLabel="waiting" /></a>
          <span>Parts <Count n={0} /></span><span>Events <Count n={37} /></span>
        </div>
      </Sample>
      <Sample id="kbd" label="Kbd: platform-aware">
        <div className={styles.controls}>
          <span><Kbd keys={["Mod", "K"]} /> palette</span><span><Kbd keys={["g", "w"]} sequence /> Work</span><span><Kbd keys={["Esc"]} /> clear focus</span>
        </div>
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Menus, overlays and tabs</h2>
      <Sample id="overlays" label="Overlays sit on --surface-overlay with --shadow-md">
        <div className={styles.controls}>
          <Menu label="Example actions" trigger={<Button><DotsHorizontalIcon /> Actions</Button>} items={[{id:'review',label:'Review',onSelect:()=>setChoice('Review selected')},{id:'current',label:'Current view',checked:true,group:'View'},{id:'unavailable',label:'Unavailable',disabled:true,group:'View'}]} />
          <Popover label="Example details" trigger={<Button>Details</Button>}><p>Supporting context stays close to its control.</p><Button variant="ghost">Read more</Button></Popover>
          <Dialog open={dialog} onOpenChange={setDialog} title="Example dialog" description="Review before continuing." trigger={<Button>Open dialog</Button>}><Field label="Change title"><Input autoFocus placeholder="Title" /></Field><FormActions><Button variant="primary" onClick={()=>setDialog(false)}>Continue</Button><Button onClick={()=>setDialog(false)}>Cancel</Button></FormActions></Dialog>
          <Sheet open={sheet} onOpenChange={setSheet} title="Example sheet" side="bottom" trigger={<Button>Open sheet</Button>}><p>Details remain readable on a narrow screen.</p></Sheet>
        </div>
        <p role="status">{choice}</p>
      </Sample>
      <Sample id="tabs" label="Tabs and toggle group">
        <Tabs tabs={TABS.map(id=>({id,label:id}))} value={tab} onChange={setTab} label="Example workspace"><p>{tab} content</p></Tabs>
        <ToggleGroup tabs={TABS.map(id=>({id,label:id}))} value={tab} onChange={setTab} label="Example layer" />
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Empty, error and loading</h2>
      <Sample id="empty" label="Empty: what is missing, how it fills, one action">
        <EmptyState title="No builds yet." action={<Button>Open Review</Button>}>A build starts when a candidate is promoted or a preview is reported.</EmptyState>
      </Sample>
      <Sample id="error" label="Error: what failed, the cause, Try again (role=alert)">
        <EmptyState kind="error" title="Could not load builds." onRetry={() => setChoice('Retried')}>The API returned 503.</EmptyState>
      </Sample>
      <Sample id="loading" label="Region loading: quiet text where the content will appear (LoadingState is page-level only)">
        <div className={styles.skeleton} role="status"><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /><p>Loading builds…</p></div>
      </Sample>
      <Sample id="unknown" label="Unknown is a value, not an empty state">
        <MetaLine items={[{ label: "deploy", value: "unknown" }, { label: "template", value: "unknown" }]} />
      </Sample>
    </section>

    <section className={styles.block}>
      <h2>Focus</h2>
      <Sample id="focus" label="2px outline on keyboard focus only; inset inside rows and canvases">
        <div className={styles.controls}>
          <span className={styles.focusDemo}>Focus ring</span>
          <span className={`${styles.focusDemo} ${styles.focusInset}`}>Inset focus ring</span>
        </div>
      </Sample>
    </section>

    <EffectsSection />
  </main>;
}
