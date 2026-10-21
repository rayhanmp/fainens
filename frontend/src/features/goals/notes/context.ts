import { createContext, useContext } from 'react';

/** Something in a goal that notes can link to with `[[`: a part of its cost, a booking or a file. */
export type NoteTarget = {
  kind: 'part' | 'booking' | 'file';
  id: number;
  label: string;
  /** What the chip says next to the name, like "Rp9 jt · paid". */
  detail?: string;
  done?: boolean;
  /** Where clicking the chip goes, if anywhere (a file opens). */
  href?: string;
};

export type NotesContextValue = {
  goalId: number;
  targets: NoteTarget[];
  formatAmount: (value: number) => string;
};

export const NotesContext = createContext<NotesContextValue>({ goalId: 0, targets: [], formatAmount: (value) => String(value) });

export const useNotesContext = () => useContext(NotesContext);
