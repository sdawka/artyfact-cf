import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import styles from './ui.module.css';
const classes = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(' ');
export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'standard' | 'compact';
  asChild?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({variant='secondary',size='standard',asChild=false,type='button',className,...props},ref) {
  const Component = asChild ? Slot : 'button';
  return <Component {...props} ref={ref} type={asChild ? undefined : type} className={classes(styles.button,className)} data-variant={variant} data-size={size} />;
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
