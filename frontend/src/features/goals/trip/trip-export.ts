import { printNotes } from '../notes/notes-export';
import { costText, dayLabel, itinerary, tripCalendar, type TripBasics, type TripBooking, type TripPlan } from './trip-utils';

const fileName = (name: string, extension: string) => `${name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'trip'}.${extension}`;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Saves the trip's bookings and plans as a calendar file, to open in any calendar app. */
export function downloadCalendar(goalName: string, bookings: readonly TripBooking[], plans: readonly TripPlan[]) {
  const blob = new Blob([tripCalendar(goalName, bookings, plans)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(goalName, 'ics');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out', on: '' };

/** Opens the print dialog (where it can be saved as a PDF) for the trip day by day. */
export function printItinerary(goalName: string, basics: TripBasics, bookings: readonly TripBooking[], plans: readonly TripPlan[], amount: (value: number) => string) {
  const { days } = itinerary(basics, bookings, plans);
  const html = days.map((day) => {
    const items = day.items.map((item) => {
      const end = item.type === 'plan' && item.time && item.plan.endTime ? `–${item.plan.endTime}` : '';
      const time = item.time ? `<strong>${item.time}${end}</strong> · ` : '';
      if (item.type === 'plan') {
        const plan = item.plan;
        const cost = plan.cost > 0 ? ` · ${escape(plan.costCurrency === 'IDR' ? amount(plan.rupiah) : costText(plan.cost, plan.costCurrency))}` : '';
        return `<li>${time}${escape(plan.title)}${plan.place ? ` · ${escape(plan.place)}` : ''}${cost}</li>`;
      }
      const { booking } = item;
      const role = ROLE[item.role] ? `${ROLE[item.role]}: ` : '';
      const where = [booking.place, typeof booking.details.to === 'string' ? booking.details.to : null].filter(Boolean).join(' → ');
      return `<li>${time}${role}${escape(booking.title)}${where ? ` · ${escape(where)}` : ''}${booking.code ? ` · code <strong>${escape(booking.code)}</strong>` : ''}${booking.address ? `<br><small>${escape(booking.address)}</small>` : ''}</li>`;
    }).join('');
    const sleep = day.sleep ? `<p class="meta">Night at ${escape(day.sleep.title)}</p>` : '';
    return `<h2>Day ${day.index} · ${escape(dayLabel(day.key))}</h2>${items ? `<ul>${items}</ul>` : '<p class="meta">Nothing planned yet.</p>'}${sleep}`;
  }).join('');
  printNotes(`${goalName}: day by day`, [goalName, basics.places.join(', ')].filter(Boolean).join(' · '), html || '<p>Add the dates you leave and come back to plan each day.</p>');
}
