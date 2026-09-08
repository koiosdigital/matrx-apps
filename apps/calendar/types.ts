/** The neutral event shape every source resolves to. */
export interface Event {
  /** Unix seconds. */
  start: number;
  end: number;
  allDay: boolean;
  summary: string;
}
