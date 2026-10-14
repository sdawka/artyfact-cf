import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { Tabs } from './Tabs';
afterEach(cleanup);
it('preserves click selection and arrow navigation past disabled tabs', async () => {
  function Example() {const [value,setValue]=useState('what');return <Tabs label="Details" tabs={[{id:'what',label:'What'},{id:'disabled',label:'Unavailable',disabled:true},{id:'rules',label:'Rules'}]} value={value} onChange={setValue}><p>{value} content</p></Tabs>;}
  render(<Example />);
  fireEvent.click(screen.getByRole('tab',{name:'Rules'}));
  expect(screen.getByRole('tabpanel').textContent).toBe('rules content');
  screen.getByRole('tab',{name:'Rules'}).focus();
  fireEvent.keyDown(screen.getByRole('tab',{name:'Rules'}),{key:'ArrowLeft'});
  await waitFor(()=>expect(screen.getByRole('tabpanel').textContent).toBe('what content'));
  fireEvent.keyDown(screen.getByRole('tab',{name:'What'}),{key:'End'});
  await waitFor(()=>expect(screen.getByRole('tabpanel').textContent).toBe('rules content'));
  fireEvent.keyDown(screen.getByRole('tab',{name:'Rules'}),{key:'Home'});
  await waitFor(()=>expect(screen.getByRole('tabpanel').textContent).toBe('what content'));
  expect(document.activeElement).toBe(screen.getByRole('tab',{name:'What'}));
});
it('requests one activation while controlled selection is deferred', () => {
  const changes: string[] = [];
  render(<Tabs label="Example" value="first" onChange={id=>changes.push(id)} tabs={[{id:'first',label:'First'},{id:'next',label:'Next'}]} />);
  const next = screen.getByRole('tab',{name:'Next'});
  fireEvent.mouseDown(next,{button:0,ctrlKey:false});
  fireEvent.mouseUp(next,{button:0});
  fireEvent.click(next,{detail:1});
  expect(changes).toEqual(['next']);
});
it('allows a fresh pointer activation after the controlled parent rejects a request', () => {
  const changes: string[] = [];
  render(<Tabs label="Retry" value="first" onChange={id=>changes.push(id)} tabs={[{id:'first',label:'First'},{id:'next',label:'Next'}]} />);
  const next = screen.getByRole('tab',{name:'Next'});
  const click = () => {fireEvent.mouseDown(next,{button:0,ctrlKey:false});fireEvent.mouseUp(next,{button:0});fireEvent.click(next,{detail:1});};
  click();click();
  expect(changes).toEqual(['next','next']);
});
it('allows separate keyboard and programmatic activations when selection is rejected', async () => {
  const changes: string[] = [];
  render(<Tabs label="Retry" value="first" onChange={id=>changes.push(id)} tabs={[{id:'first',label:'First'},{id:'next',label:'Next'}]} />);
  const next = screen.getByRole('tab',{name:'Next'});
  fireEvent.keyDown(next,{key:'Enter'});fireEvent.keyUp(next,{key:'Enter'});
  fireEvent.keyDown(next,{key:'Enter'});fireEvent.keyUp(next,{key:'Enter'});
  await Promise.resolve();
  next.click();next.click();
  expect(changes).toEqual(['next','next','next','next']);
});

it.each(['Enter',' '])('deduplicates the native %j keyboard click and permits a later retry', key => {
  const changes: string[] = [];
  render(<Tabs label="Keyboard" value="first" onChange={id=>changes.push(id)} tabs={[{id:'first',label:'First'},{id:'next',label:'Next'}]} />);
  const next=screen.getByRole('tab',{name:'Next'});
  next.focus();changes.length=0;
  const press=()=>{
    const defaultAllowed=fireEvent.keyDown(next,{key});
    expect(defaultAllowed).toBe(false);
    if(defaultAllowed && key==='Enter') fireEvent.click(next,{detail:0});
    fireEvent.keyUp(next,{key});
    if(defaultAllowed && key===' ') fireEvent.click(next,{detail:0});
  };
  press();press();
  expect(changes).toEqual(['next','next']);
});
it('keeps held Space in one activation while Enter repeat clicks each activate once', () => {
  const changes: string[] = [];
  render(<Tabs label="Repeat" value="first" onChange={id=>changes.push(id)} tabs={[{id:'first',label:'First'},{id:'next',label:'Next'}]} />);
  const next=screen.getByRole('tab',{name:'Next'});
  next.focus();changes.length=0;
  fireEvent.keyDown(next,{key:' '});fireEvent.keyDown(next,{key:' ',repeat:true});fireEvent.keyUp(next,{key:' '});
  fireEvent.keyDown(next,{key:'Enter'});fireEvent.keyDown(next,{key:'Enter',repeat:true});fireEvent.keyUp(next,{key:'Enter'});
  expect(changes).toEqual(['next','next','next']);
});
it('omits dangling panel references for panel-less layers while retaining real panel IDs', () => {
  const tabs=[{id:'genome',label:'Genome'},{id:'proteome',label:'Proteome'}];
  const {rerender}=render(<Tabs label="Overlay" tabs={tabs} value="genome" onChange={()=>{}} />);
  for(const tab of screen.getAllByRole('tab')) expect(tab.hasAttribute('aria-controls')).toBe(false);
  rerender(<Tabs label="Views" tabs={tabs} value="genome" onChange={()=>{}}><p>Genome content</p></Tabs>);
  for(const tab of screen.getAllByRole('tab')) {
    const controlled=tab.getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    expect(document.getElementById(controlled!)).toBeTruthy();
  }
  expect(screen.getByRole('tabpanel').textContent).toBe('Genome content');
});
