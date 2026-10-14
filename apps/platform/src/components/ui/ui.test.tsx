import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef, useState } from 'react';
import { Button, Input, Checkbox, Select, Menu, Dialog, Popover } from './index';
import { EffectsPreferenceProvider, EFFECTS_KEY } from '@/effects/effectsPreference';

// jsdom has no scrolling layout; real browser coverage verifies the viewport behavior.
HTMLElement.prototype.scrollIntoView ??= function () {};
afterEach(() => { cleanup(); window.localStorage.clear(); });
// These exercise the wrapper boundary: native form values and composed Radix focus/dismissal.
function FilterForm() {
  const [value, setValue] = useState('one');
  return <form aria-label="filters"><Select label="Filter" name="filter" value={value} onChange={setValue} options={[{value:'',label:'All',group:'Scope'},{value:'one',label:'One',group:'Scope'},{value:'__empty__',label:'Domain identifier',group:'Other'}]} /><Button type="submit">Apply</Button></form>;
}
async function openSelect(label: string) {
  fireEvent.keyDown(screen.getByRole('combobox', {name:label}), {key:'ArrowDown'});
  return screen.findByRole('listbox');
}
describe('shared controls', () => {
  it('preserves native submit, required field, checkbox and refs', () => {
    const ref = createRef<HTMLInputElement>();
    render(<form aria-label="native"><Input ref={ref} name="title" required defaultValue="" /><Checkbox name="enabled" defaultChecked value="yes" /><Button>Cancel</Button><Button type="submit">Save</Button></form>);
    const form = screen.getByRole('form') as HTMLFormElement;
    expect(ref.current?.checkValidity()).toBe(false);
    expect((screen.getByRole('button',{name:'Cancel'}) as HTMLButtonElement).type).toBe('button');
    expect((screen.getByRole('button',{name:'Save'}) as HTMLButtonElement).type).toBe('submit');
    fireEvent.change(ref.current!,{target:{value:'A title'}});
    expect(form.checkValidity()).toBe(true);
    expect(Object.fromEntries(new FormData(form))).toEqual({title:'A title',enabled:'yes'});
  });
  it('selects the empty All option with keyboard and submits the real empty value', async () => {
    render(<FilterForm />);
    await openSelect('Filter');
    expect(screen.getAllByRole('group')).toHaveLength(2);
    const all = screen.getByRole('option',{name:'All'});
    all.focus(); fireEvent.keyDown(all,{key:'Enter'});
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('filter')).toBe('');
    await openSelect('Filter');
    const domain = screen.getByRole('option',{name:'Domain identifier'});
    domain.focus(); fireEvent.keyDown(domain,{key:'Enter'});
    await waitFor(() => expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('filter')).toBe('__empty__'));
  });
  it('keeps unknown values and required placeholder semantics', async () => {
    const ref = createRef<HTMLButtonElement>();
    const {rerender} = render(<form aria-label="unknown"><Select ref={ref} label="Revision" name="revision" value="unlisted" onChange={() => {}} options={[{value:'head',label:'Head'}]} required /></form>);
    expect(ref.current?.getAttribute('role')).toBe('combobox');
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('revision')).toBe('unlisted');
    expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(true);
    await openSelect('Revision');
    expect(screen.getByRole('option',{name:'unlisted'})).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('listbox'),{key:'Escape'});
    rerender(<form aria-label="unknown"><Select label="Revision" name="revision" value="" onChange={() => {}} options={[{value:'head',label:'Head'}]} required placeholder="Choose revision" /></form>);
    expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(false);
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('revision')).toBe('');
  });
  it('menu actions restore focus and disabled items cannot run', async () => {
    let chosen = '';
    render(<Menu trigger={<Button>More</Button>} items={[{id:'disabled',label:'Unavailable',disabled:true,onSelect:()=>{chosen='bad';}},{id:'run',label:'Run',onSelect:()=>{chosen='run';}}]} />);
    const trigger = screen.getByRole('button',{name:'More'}); trigger.focus(); fireEvent.keyDown(trigger,{key:'ArrowDown'});
    const run = await screen.findByRole('menuitem',{name:'Run'});
    expect(screen.getByRole('menuitem',{name:'Unavailable'}).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(run); await waitFor(()=>expect(chosen).toBe('run'));
    await waitFor(()=>expect(document.activeElement).toBe(trigger));
  });
  it('Escape dismisses foremost nested overlay and restores its trigger', async () => {
    function Nested() { const [open,setOpen] = useState(false); return <Dialog open={open} onOpenChange={setOpen} title="Settings" trigger={<Button>Settings</Button>}><Popover trigger={<Button>Help</Button>}><p>Helpful detail</p></Popover></Dialog>; }
    render(<Nested />); fireEvent.click(screen.getByRole('button',{name:'Settings'}));
    const help = await screen.findByRole('button',{name:'Help'}); fireEvent.click(help);
    await screen.findByText('Helpful detail'); fireEvent.keyDown(document.activeElement!,{key:'Escape'});
    await waitFor(()=>expect(screen.queryByText('Helpful detail')).toBeNull());
    expect(screen.getByRole('dialog',{name:'Settings'})).toBeTruthy();
    await waitFor(()=>expect(document.activeElement).toBe(help));
    fireEvent.keyDown(document.activeElement!,{key:'Escape'});
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Settings'})));
  });
  it('propagates persisted Effects off into portaled overlays', async () => {
    window.localStorage.setItem(EFFECTS_KEY,'off');
    render(<EffectsPreferenceProvider><Popover trigger={<Button>Help</Button>} label="Help details"><p>Quiet content</p></Popover></EffectsPreferenceProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Help'}));
    expect((await screen.findByRole('dialog',{name:'Help details'})).getAttribute('data-effects')).toBe('off');
  });
});
