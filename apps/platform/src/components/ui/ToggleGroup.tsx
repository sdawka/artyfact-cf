import * as Primitive from '@radix-ui/react-toggle-group';
import type { TabsProps } from '../Tabs/Tabs';
import styles from './ui.module.css';
export function ToggleGroup<T extends string>({tabs,value,onChange,label}:Omit<TabsProps<T>,'children'>) {
  return <Primitive.Root type="single" value={value} onValueChange={id=>{if(id) onChange(id as T);}} aria-label={label} className={styles.toggleGroup}>
    {tabs.map(tab=><Primitive.Item key={tab.id} value={tab.id} disabled={tab.disabled} className={styles.toggleItem}>{tab.label}</Primitive.Item>)}
  </Primitive.Root>;
}
