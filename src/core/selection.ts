/** The token classes a picker can own. Paths stay with pi core. */
export type PickerClass = "skill" | "tool" | "role";

/** One recorded picker selection. */
export interface SelectionRecord {
  count: number;
  lastSelectedAt: number;
}

/** Selection state the picker reads and writes, without tying it to a file. */
export interface SelectionHistory {
  get(className: PickerClass): Readonly<Record<string, SelectionRecord>>;
  record(className: PickerClass, targetKey: string, now?: number): void;
}
