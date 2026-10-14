import { forwardRef, useId, type ComponentPropsWithoutRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import styles from './ui.module.css';
const classes = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(' ');
export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'standard' | 'compact';
  asChild?: boolean;
  /**
   * Why the action is unavailable. A reason disables the button and shows as visible `--type-meta` text beside it,
   * linked with `aria-describedby` (not a tooltip). Pass `undefined` when the action is available.
   */
  reason?: string;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({variant='secondary',size='standard',asChild=false,type='button',className,reason,disabled,...props},ref) {
  const Component = asChild ? Slot : 'button';
  const reasonId = useId();
  const showReason = !!reason && !asChild;
  const describedBy = [props['aria-describedby'], showReason ? reasonId : undefined].filter(Boolean).join(' ') || undefined;
  const button = <Component {...props} ref={ref} type={asChild ? undefined : type} disabled={disabled || !!reason || undefined} aria-describedby={describedBy} className={classes(styles.button,className)} data-variant={variant} data-size={size} />;
  if (!showReason) return button;
  return <span className={styles.withReason} data-reason="">{button}<span id={reasonId} className={styles.reason}>{reason}</span></span>;
});
export interface IconButtonProps extends ButtonProps { label: string }
export const IconButton = forwardRef<HTMLButtonElement,IconButtonProps>(function IconButton({label,className,...props},ref) {
  return <Button {...props} ref={ref} aria-label={label} title={props.title ?? label} className={classes(styles.iconButton,className)} />;
});
export const Input = forwardRef<HTMLInputElement,ComponentPropsWithoutRef<'input'>>(function Input({className,...props},ref) {
  return <input {...props} ref={ref} className={classes(styles.input,className)} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement,ComponentPropsWithoutRef<'textarea'>>(function Textarea({className,...props},ref) {
  return <textarea {...props} ref={ref} className={classes(styles.input,styles.textarea,className)} />;
});
export const Checkbox = forwardRef<HTMLInputElement,Omit<ComponentPropsWithoutRef<'input'>,'type'>>(function Checkbox({className,...props},ref) {
  return <input {...props} ref={ref} type="checkbox" className={classes(styles.checkbox,className)} />;
});
