import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon, Cross2Icon } from '@radix-ui/react-icons';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useEffectsPreference } from '@/effects/effectsPreference';
import { IconButton } from './Controls';
import styles from './ui.module.css';
type FocusHandlers = Pick<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,'onEscapeKeyDown'|'onCloseAutoFocus'|'onOpenAutoFocus'>;
export interface DialogProps extends FocusHandlers {open:boolean;onOpenChange(open:boolean):void;title:string;description?:string;children:ReactNode;trigger?:ReactNode;className?:string}
export interface SheetProps extends DialogProps {side?:'left'|'right'|'bottom'}
function Modal({open,onOpenChange,title,description,children,trigger,className,side,...handlers}:SheetProps) {
  const effects=useEffectsPreference();
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-effects={effects.enabled?'on':'off'} className={styles.backdrop} />
      <DialogPrimitive.Content {...handlers} {...(!description && {'aria-describedby':undefined})} data-effects={effects.enabled?'on':'off'} data-side={side} className={`${side ? styles.sheet : styles.dialog} ${className ?? ''}`}>
        <div className={styles.dialogHeader}><DialogPrimitive.Title className={styles.dialogTitle}>{title}</DialogPrimitive.Title><DialogPrimitive.Close asChild><IconButton label={`Close ${title}`} variant="ghost"><Cross2Icon /></IconButton></DialogPrimitive.Close></div>
        {description && <DialogPrimitive.Description className={styles.description}>{description}</DialogPrimitive.Description>}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
export function Dialog(props:DialogProps) {return <Modal {...props} />;}
export function Sheet({side='right',...props}:SheetProps) {return <Modal {...props} side={side} />;}
export interface PopoverProps extends FocusHandlers {trigger:ReactNode;children:ReactNode;open?:boolean;onOpenChange?(open:boolean):void;label?:string;align?:'start'|'center'|'end';side?:'top'|'right'|'bottom'|'left';className?:string}
export function Popover({trigger,children,open,onOpenChange,label,align='end',side='bottom',className,...handlers}:PopoverProps) {
  const effects=useEffectsPreference();
  return <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}><PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger><PopoverPrimitive.Portal><PopoverPrimitive.Content {...handlers} aria-label={label} align={align} side={side} sideOffset={8} collisionPadding={12} data-effects={effects.enabled?'on':'off'} className={`${styles.popover} ${className ?? ''}`}>{children}</PopoverPrimitive.Content></PopoverPrimitive.Portal></PopoverPrimitive.Root>;
}
export interface MenuItem {id:string;label:string;icon?:ReactNode;onSelect?():void;disabled?:boolean;checked?:boolean;group?:string}
export interface MenuProps extends Pick<ComponentPropsWithoutRef<typeof MenuPrimitive.Content>, 'onCloseAutoFocus'> {trigger:ReactNode;items:readonly MenuItem[];label?:string;align?:'start'|'center'|'end'}
export function Menu({trigger,items,label,align='end',onCloseAutoFocus}:MenuProps) {
  const effects=useEffectsPreference();
  return <MenuPrimitive.Root><MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger><MenuPrimitive.Portal><MenuPrimitive.Content onCloseAutoFocus={onCloseAutoFocus} aria-label={label} align={align} sideOffset={8} collisionPadding={12} data-effects={effects.enabled?'on':'off'} className={styles.menu}>
    {items.map((item,index)=><MenuPrimitive.Group key={item.id}>
      {index>0 && items[index-1]?.group!==item.group && <MenuPrimitive.Separator className={styles.separator} />}
      {item.checked !== undefined ? <MenuPrimitive.CheckboxItem className={styles.item} checked={item.checked} onSelect={item.onSelect} disabled={item.disabled}><span className={styles.itemIcon}>{item.icon}</span>{item.label}<MenuPrimitive.ItemIndicator className={styles.indicator}><CheckIcon /></MenuPrimitive.ItemIndicator></MenuPrimitive.CheckboxItem> : <MenuPrimitive.Item className={styles.item} onSelect={item.onSelect} disabled={item.disabled}><span className={styles.itemIcon}>{item.icon}</span>{item.label}</MenuPrimitive.Item>}
    </MenuPrimitive.Group>)}
  </MenuPrimitive.Content></MenuPrimitive.Portal></MenuPrimitive.Root>;
}
