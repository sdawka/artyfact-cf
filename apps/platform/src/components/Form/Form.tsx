import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import styles from "./Form.module.css";

const cx = (...v: (string | undefined | false)[]) => v.filter(Boolean).join(" ");

/** Class names for forms built by hand; prefer the components below. */
export { styles as formStyles };

/** A form laid out as one column of fields, at most 40rem wide. */
export const Form = forwardRef<HTMLFormElement, ComponentPropsWithoutRef<"form">>(function Form({ className, ...props }, ref) {
  return <form {...props} ref={ref} className={cx(styles.form, className)} />;
});

export interface FieldProps extends Omit<ComponentPropsWithoutRef<"label">, "children"> {
  /** Visible label text above the control. */
  label: ReactNode;
  /** The control (Input, Textarea, Select); it is labelled by being inside the label. */
  children: ReactNode;
}

/** A labelled control: label text, then the control, `--spacing-2` apart. */
export function Field({ label, children, className, ...props }: FieldProps) {
  return <label {...props} className={cx(styles.field, className)}>{label}{children}</label>;
}

/** A checkbox row with its label, 44px tall. */
export function Check({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return <label {...props} className={cx(styles.check, className)} />;
}

/** The row of buttons that ends a form or group. */
export function FormActions({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cx(styles.actions, className)} />;
}

/** Why something is not possible yet, as quiet text. `tone="error"` for what failed. */
export function Reason({ tone, className, ...props }: ComponentPropsWithoutRef<"p"> & { tone?: "error" }) {
  return <p {...props} className={cx(styles.reason, tone === "error" && styles.error, className)} />;
}
