import type { ElementType } from 'react';
import { BedDouble, MapPin, Plane, Ticket, TrainFront } from 'lucide-react';
import type { BookingKind } from './trip-utils';

/** The icon each kind of booking shows with, in lists and on its day. */
export const BOOKING_ICONS: Record<BookingKind, ElementType> = { flight: Plane, stay: BedDouble, transport: TrainFront, ticket: Ticket, other: MapPin };
