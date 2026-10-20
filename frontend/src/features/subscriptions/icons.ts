import { CalendarClock, Car, Film, Music, Signal, Sparkles } from 'lucide-react';

/** The icons a subscription can wear, by the `iconKey` the server stores. */
export const ICON_MAP: Record<string, typeof Car> = {
  default: CalendarClock,
  film: Film,
  music: Music,
  signal: Signal,
  car: Car,
  sparkles: Sparkles,
};

export const ICON_LABELS: Record<string, string> = {
  default: 'Calendar',
  film: 'Video',
  music: 'Music',
  signal: 'Mobile / data',
  car: 'Transport',
  sparkles: 'Other',
};
