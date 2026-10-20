import { Coffee, Compass, Crown, Gem, Leaf, PartyPopper, Repeat2, Shapes, type LucideIcon } from 'lucide-react';
import type { PersonaKey } from './stories';

/** One icon per money personality, shared by the closing badge and the finales. */
export const personaIcons: Record<PersonaKey, LucideIcon> = {
  weekend: PartyPopper, bigTicket: Gem, steady: Coffee, monk: Leaf, loyal: Repeat2, devotee: Crown, explorer: Compass, allRounder: Shapes,
};
