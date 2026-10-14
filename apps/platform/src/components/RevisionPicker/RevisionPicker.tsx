import { revisionGroups, type RevisionOption } from '@/model/revisions';
import { Select } from '../ui/Select';
import styles from './RevisionPicker.module.css';
export interface RevisionPickerProps {
  id:string;label:string;value:string;onChange(value:string):void;options:RevisionOption[];
  /** Keep the label for assistive tech only, when the surrounding group already reads as its sentence ("Compare [from] to [to]"). */
  hideLabel?:boolean;
}
/** Grouped, labelled revision selector; unknown revisions retain their short display label. */
export function RevisionPicker({id,label,value,onChange,options,hideLabel=false}:RevisionPickerProps) {
  return <span className={styles.field}><label htmlFor={id} className={hideLabel ? 'sr-only' : styles.label}>{label}</label><Select id={id} value={value} onChange={onChange} className={styles.select} options={revisionGroups(options,value).flatMap(group=>group.options.map(option=>({value:option.id,label:option.label,group:group.label})))} /></span>;
}
