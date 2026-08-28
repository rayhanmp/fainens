import { z } from 'zod';

const amountString = z
  .string()
  .trim()
  .refine((value) => {
    const normalized = value.replace(/[^0-9-]/g, '');
    const amount = Number(normalized);
    return normalized.length > 0 && Number.isSafeInteger(amount) && amount > 0;
  }, 'Enter a valid positive amount');

const optionalAmountString = z
  .string()
  .trim()
  .refine((value) => {
    if (!value) return true;
    const normalized = value.replace(/[^0-9-]/g, '');
    const amount = Number(normalized);
    return normalized.length > 0 && Number.isSafeInteger(amount) && amount >= 0;
  }, 'Enter a valid non-negative amount');

const tagIds = z.array(z.number().int().positive()).max(100);

export const simpleTransactionFormSchema = z.object({
  dateTime: z.string().trim().min(1, 'Choose a date and time'),
  type: z.enum(['expense', 'income', 'transfer', 'paylater']),
  amount: amountString,
  description: z.string().trim().min(1, 'Enter a transaction name').max(500),
  fromAccountId: z.string(),
  toAccountId: z.string(),
  categoryId: z.string(),
  notes: z.string().max(5000),
  place: z.string().max(500),
  tagIds,
  transferAdminFee: optionalAmountString,
});

const journalLineSchema = z.object({
  accountId: z.string(),
  debit: z.string(),
  credit: z.string(),
  description: z.string().max(500),
  cashFlowClass: z.enum(['', 'operating', 'investing', 'financing', 'transfer']),
});

const categoryAllocationSchema = z.object({
  categoryId: z.string(),
  amount: z.string(),
});

export const journalFormSchema = z.object({
  dateTime: z.string().trim().min(1, 'Choose a date and time'),
  description: z.string().trim().min(1, 'Enter a journal description').max(500),
  notes: z.string().max(5000),
  place: z.string().max(500),
  tagIds,
  lines: z.array(journalLineSchema).min(2, 'A journal needs at least two lines'),
  categoryAllocations: z.array(categoryAllocationSchema).max(100),
});

export const editMetadataSchema = z.object({
  date: z.string().trim().min(1, 'Choose a date'),
  time: z.string().trim().min(1, 'Choose a time'),
  description: z.string().trim().min(1, 'Enter a transaction name').max(500),
  reference: z.string().max(500),
  notes: z.string().max(5000),
  place: z.string().max(500),
  categoryId: z.string(),
  tagIds,
});

export type EditMetadataValues = z.infer<typeof editMetadataSchema>;

export function formatValidationError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Please check the form values';
  const path = issue.path.filter((part) => typeof part === 'string').join(' ');
  return path ? `${path}: ${issue.message}` : issue.message;
}
