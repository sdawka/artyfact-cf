import * as Primitive from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '@radix-ui/react-icons';
import { forwardRef, useImperativeHandle, useRef, type AriaAttributes } from 'react';
import { useEffectsPreference } from '@/effects/effectsPreference';
import styles from './ui.module.css';
export interface SelectOption {value: string;label: string;disabled?: boolean;group?: string}
export interface SelectProps extends Pick<AriaAttributes,'aria-label'|'aria-labelledby'|'aria-describedby'> {
  id?:string;name?:string;value:string;onChange(value:string):void;options:readonly SelectOption[];
  placeholder?:string;label?:string;disabled?:boolean;required?:boolean;className?:string;
}
/** Display values are opaque option indices; only the native form control exposes domain values. */
export const Select = forwardRef<HTMLButtonElement,SelectProps>(function Select({id,name,value,onChange,options,placeholder='Choose…',label,disabled,required,className,...aria},ref) {
  const effects = useEffectsPreference();
  const trigger = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref,()=>trigger.current!);
  const listed = options.some(o=>o.value===value);
  const actual = !listed && value !== '' ? [{value,label:value},...options] : [...options];
  const index = actual.findIndex(o=>o.value===value);
  const groups = new Map<string, {option:SelectOption;index:number}[]>();
  actual.forEach((option,index)=>{const group=option.group ?? '';groups.set(group,[...(groups.get(group) ?? []),{option,index}]);});
  return <span className={styles.selectField}>
    <Primitive.Root value={index < 0 ? '' : String(index)} onValueChange={encoded=>{const option=actual[Number(encoded)];if(encoded!=='' && option) onChange(option.value);}} disabled={disabled}>
      <Primitive.Trigger {...aria} id={id} ref={trigger} aria-label={aria['aria-label'] ?? label} aria-required={required} className={`${styles.selectTrigger} ${className ?? ''}`}>
        <Primitive.Value placeholder={placeholder} /><Primitive.Icon className={styles.caret}><ChevronDownIcon /></Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal><Primitive.Content position="popper" sideOffset={6} collisionPadding={12} className={styles.selectContent} data-effects={effects.enabled ? 'on' : 'off'}>
        <Primitive.ScrollUpButton className={styles.scrollButton}><ChevronUpIcon /></Primitive.ScrollUpButton>
        <Primitive.Viewport className={styles.selectViewport}>
          {[...groups].map(([group,entries])=><Primitive.Group key={group}>
            {group && <Primitive.Label className={styles.groupLabel}>{group}</Primitive.Label>}
            {entries.map(({option,index})=><Primitive.Item key={index} value={String(index)} disabled={option.disabled} className={styles.item}>
              <Primitive.ItemText>{option.label}</Primitive.ItemText><Primitive.ItemIndicator className={styles.indicator}><CheckIcon /></Primitive.ItemIndicator>
            </Primitive.Item>)}
          </Primitive.Group>)}
        </Primitive.Viewport><Primitive.ScrollDownButton className={styles.scrollButton}><ChevronDownIcon /></Primitive.ScrollDownButton>
      </Primitive.Content></Primitive.Portal>
    </Primitive.Root>
    <select aria-hidden="true" tabIndex={-1} className={styles.nativeSelect} name={name} value={value} required={required} disabled={disabled} onChange={event=>onChange(event.target.value)} onInvalid={event=>{event.preventDefault();trigger.current?.focus();}}>
      {!actual.some(o=>o.value==='') && <option value="">{placeholder}</option>}
      {actual.map(o=><option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  </span>;
});
