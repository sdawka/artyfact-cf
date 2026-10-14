import { useRef, useState } from "react";
import {
  AmbientField, SurfaceField, SURFACE_PRESET_NAMES, type AmbientFieldHandle, type SurfaceHandle, type SurfacePresetName,
} from "@artyfact/effects";
import { DotsHorizontalIcon, GearIcon } from '@radix-ui/react-icons';
import { Button, IconButton, Input, Textarea, Checkbox, Select, Menu, Popover, Dialog, Sheet, ToggleGroup, Tabs } from '@/components/ui';
import { Card } from '@/components/Card/Card';
import { StatusChip } from '@/components/StatusChip/StatusChip';
import { VerdictBadge } from '@/components/VerdictBadge/VerdictBadge';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EffectsPreferenceProvider, useEffectsPreference } from '@/effects/effectsPreference';
import styles from "./StylePage.module.css";

const TABS = ["Overview", "Map", "Work"];

const PRESET_USE: Record<SurfacePresetName, string> = {
  apricot: "Accent. Default, neutral or in progress.",
  verdant: "Success. Every gate passes.",
  ember: "Error. Failing or blocked.",
  tide: "Info. Waiting on evidence.",
  dusk: "Background hue. Idle or ambient.",
};

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
      <Button className="u-brackets" onClick={() => surface.current?.pulse(1)}>
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
    <>
      <h2>Signature effects</h2>
      <p>
        Glow and haze mark signature moments, state changes and selection. They are decorative, follow reduced motion,
        and the page reads the same with them off.
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

      <h3>Glow tokens</h3>
      <p className={styles.glows}>
        <span className={styles.glow} data-glow="accent">accent</span>
        <span className={styles.glow} data-glow="success">success</span>
        <span className={styles.glow} data-glow="error">error</span>
      </p>
    </>
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
  const effects = useEffectsPreference();
  return <main className={styles.page} data-effects={effects.enabled ? 'on' : 'off'}>
    <p className={`wordmark ${styles.wordmark}`}>artyfact</p>
    <h1 className={styles.title}>Style sheet</h1>
    <p>A System is what you are building and why. These are the shared pieces used throughout the application.</p>
    <h2>Buttons and fields</h2>
    <Card title="Create a change" headingLevel={3}>
      <div className={styles.controls}>
        <Button variant="primary">Primary action</Button><Button>Secondary action</Button><Button variant="ghost">Quiet action</Button><Button disabled>Unavailable</Button>
        <IconButton label="Settings" variant="ghost"><GearIcon /></IconButton>
      </div>
      <div className={styles.fields}>
        <label>Title<Input name="title" placeholder="Describe the change" required /></label>
        <label>Context<Textarea name="context" placeholder="What should happen?" /></label>
        <label className={styles.toggle}><Checkbox defaultChecked /> Include supporting evidence</label>
        <label>Unavailable field<Input disabled value="Waiting for evidence" readOnly /></label>
        <label>Scope<Select label="Scope" name="scope" value={filter} onChange={setFilter} options={[{value:'',label:'All',group:'Scope'},{value:'genome',label:'Genome',group:'Scope'},{value:'proteome',label:'Proteome',group:'Scope'},{value:'phenome',label:'Phenome',group:'Scope'},{value:'unavailable',label:'Unavailable',disabled:true,group:'Other'}]} /></label>
      </div>
    </Card>
    <h2>Menus and overlays</h2>
    <div className={styles.controls}>
      <Menu label="Example actions" trigger={<Button><DotsHorizontalIcon /> Actions</Button>} items={[{id:'review',label:'Review',onSelect:()=>setChoice('Review selected')},{id:'current',label:'Current view',checked:true,group:'View'},{id:'unavailable',label:'Unavailable',disabled:true,group:'View'}]} />
      <Popover label="Example details" trigger={<Button>Details</Button>}><p>Supporting context stays close to its control.</p><Button variant="ghost">Read more</Button></Popover>
      <Dialog open={dialog} onOpenChange={setDialog} title="Example dialog" description="Review before continuing." trigger={<Button>Open dialog</Button>}><label>Change title<Input autoFocus placeholder="Title" /></label><div className={styles.controls}><Button variant="primary" onClick={()=>setDialog(false)}>Continue</Button><Button onClick={()=>setDialog(false)}>Cancel</Button></div></Dialog>
      <Sheet open={sheet} onOpenChange={setSheet} title="Example sheet" side="bottom" trigger={<Button>Open sheet</Button>}><p>Details remain readable on a narrow screen.</p></Sheet>
    </div>
    <p role="status">{choice}</p>
    <h2>Tabs and choices</h2>
    <Tabs tabs={TABS.map(id=>({id,label:id}))} value={tab} onChange={setTab} label="Example workspace"><p>{tab} content</p></Tabs>
    <ToggleGroup tabs={TABS.map(id=>({id,label:id}))} value={tab} onChange={setTab} label="Example layer" />
    <h2>States and verdicts</h2>
    <div className={styles.controls}><StatusChip status="needs-review" label="Needs review" tone="attention" />{(['pass','fail','unknown','stale','not-run'] as const).map(verdict=><VerdictBadge key={verdict} verdict={verdict} />)}</div>
    <EmptyState title="No evidence yet" action={<Button>Add evidence</Button>}>Run an evaluation to collect the first result.</EmptyState>
    <p>Read the <a className="u-marker" href="/style">task packet</a> before you start work.</p>
    <EffectsSection />
  </main>;
}
