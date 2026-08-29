import type { SimpleFormValues } from './schemas';

export const stitchSelect =
  'rounded-xl border-none bg-[var(--ref-surface-container-low)] px-3 py-3 text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)]/20';

export const stickyFooter =
  'sticky bottom-0 z-10 -mx-5 mt-4 flex flex-col gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-5 py-3 backdrop-blur-sm shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.12)] lg:-mx-6 lg:px-6';

export function toDatetimeLocal(d: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toDateInputLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInputLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function startOfLocalDayMs(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function createSimpleFormDefaults(): SimpleFormValues {
  return {
    dateTime: toDatetimeLocal(),
    type: 'expense',
    fromAccountId: '',
    toAccountId: '',
    categoryId: '',
    paylaterRecognitionId: '',
    paylaterExpenseId: '',
    paylaterLiabilityId: '',
    paylaterInstallmentMonths: '3',
    paylaterInterestRate: '',
    paylaterAdminFee: '',
    paylaterFirstDueDate: '',
    amount: '',
    description: '',
    notes: '',
    place: '',
    tagIds: [],
    origin: null,
    destination: null,
    rideProvider: '',
    rideService: '',
    transferAdminFee: '',
    transferFeePayerOverride: '',
    subscriptionId: '',
  };
}
