import * as Primitive from '@radix-ui/react-tabs';
import { useRef, type ReactNode } from 'react';
import styles from './Tabs.module.css';
export interface TabItem<T extends string = string> { id: T; label: string; disabled?: boolean }
export interface TabsProps<T extends string> { tabs: readonly TabItem<T>[]; value: T; onChange(id: T): void; label: string; children?: ReactNode }

/** Shared segments with Radix roving focus and automatic activation. */
export function Tabs<T extends string>({ tabs, value, onChange, label, children }: TabsProps<T>) {
  const interaction = useRef<{ requested: T | null; pointer: boolean }>({ requested: null, pointer: false });
  const begin = (pointer = false) => { interaction.current = { requested: null, pointer }; };
  const activate = (id: T) => {
    if (id === value || id === interaction.current.requested) return;
    interaction.current.requested = id;
    onChange(id);
  };
  return <Primitive.Root value={value} onValueChange={id => activate(id as T)} className={styles.tabs}>
    <Primitive.List
      aria-label={label} className={`u-segments ${styles.list}`}
      onPointerDownCapture={() => begin(true)} onMouseDownCapture={() => begin(true)}
      onPointerCancelCapture={() => begin()} onKeyDownCapture={() => begin()}
      onFocusCapture={() => { if (!interaction.current.pointer) begin(); }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) begin(); }}
    >
      {tabs.map(tab => <Primitive.Trigger
        key={tab.id} value={tab.id} disabled={tab.disabled}
        {...(children === undefined ? { 'aria-controls': undefined } : {})}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          // Own key activation: cancel Radix's duplicate request and the browser's
          // generated click. Arrow/Home/End still use Radix automatic focus.
          event.preventDefault();
          if (!tab.disabled && !(event.key === ' ' && event.repeat)) activate(tab.id);
        }}
        onClick={() => {
          if (!interaction.current.pointer) begin();
          activate(tab.id);
          begin();
        }}
      >{tab.label}</Primitive.Trigger>)}
    </Primitive.List>
    {children !== undefined && tabs.map(tab => <Primitive.Content key={tab.id} value={tab.id} className={styles.panel}>{tab.id === value ? children : null}</Primitive.Content>)}
  </Primitive.Root>;
}
