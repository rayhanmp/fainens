import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Search, Wallet } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { cn, formatCurrency } from '../../lib/utils';
import { useAccountsQuery } from '../../features/accounts/queries';
import { useContactsQuery } from '../../features/loans/queries';
import { queryKeys } from '../../features/core/query-keys';

type Claim = Awaited<ReturnType<typeof api.reimbursements.list>>[number];
type Expense = Awaited<ReturnType<typeof api.transactions.list>>['data'][number];
type InitialSource = { sourceTransactionId?: string; expenseLineId?: string; categoryId?: string; amount?: string };
const field = 'mt-1.5 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2.5 text-sm font-normal focus:outline-2 focus:outline-[var(--ref-primary)] disabled:opacity-50';
const label = 'block text-sm font-semibold';
const hint = 'mt-1.5 text-xs font-normal leading-relaxed text-[var(--ref-on-surface-variant)]';
const positiveInteger = (value: string) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const dateLabel = (value: number) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function useDialogScrollLock() {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
}
function ErrorMessage({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-[var(--ref-error)]">{error.message}</p> : null;
}
function todayInput() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function ClaimComposer({ initial, onClose, onSaved }: { initial: InitialSource; onClose: () => void; onSaved: () => Promise<void> }) {
  useDialogScrollLock();
  const queryClient = useQueryClient();
  const contactsQuery = useContactsQuery();
  const accountsQuery = useAccountsQuery();
  const claimsQuery = useQuery({ queryKey: queryKeys.reimbursements.list(), queryFn: () => api.reimbursements.list() });
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [addingOrganization, setAddingOrganization] = useState(false);
  const [sourceId, setSourceId] = useState(initial.sourceTransactionId ?? '');
  const [lineId, setLineId] = useState(initial.expenseLineId ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [amount, setAmount] = useState(initial.amount ?? '');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [findingExpense, setFindingExpense] = useState(!initial.sourceTransactionId);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 250); return () => clearTimeout(timer); }, [search]);
  const expenseQuery = useQuery({
    queryKey: ['reimbursement-expense', 'search', debouncedSearch],
    queryFn: () => api.transactions.list({ search: debouncedSearch || undefined, kind: 'expense', limit: '20', sort: 'newest' }),
    enabled: findingExpense,
  });
  const selectedQuery = useQuery({
    queryKey: ['reimbursement-expense', 'detail', sourceId],
    queryFn: () => api.transactions.get(Number(sourceId)), enabled: positiveInteger(sourceId),
  });
  const selected = selectedQuery.data;
  const expenseLines = selected?.lines.filter((line) => line.debit > line.credit && accountsQuery.data?.some((account) => account.id === line.accountId && account.type === 'expense')) ?? [];
  const selectedLine = expenseLines.find((line) => String(line.id) === lineId) ?? (expenseLines.length === 1 ? expenseLines[0] : undefined);
  const categories = selected?.categoryAllocations.filter((category) => category.amount > 0) ?? [];
  const selectedCategory = categories.find((category) => String(category.categoryId) === categoryId) ?? (categories.length === 1 ? categories[0] : undefined);
  const activeSources = (claimsQuery.data ?? []).filter((claim) => ['approved', 'partially_paid', 'settled'].includes(claim.status)).flatMap((claim) => claim.sources);
  const lineAvailable = selectedLine ? Math.max(0, selectedLine.debit - selectedLine.credit - activeSources.filter((source) => source.expenseLineId === selectedLine.id).reduce((sum, source) => sum + source.amount, 0)) : 0;
  const categoryAvailable = selectedCategory ? Math.max(0, selectedCategory.amount - activeSources.filter((source) => source.sourceTransactionId === Number(sourceId) && source.categoryId === selectedCategory.categoryId).reduce((sum, source) => sum + source.amount, 0)) : Infinity;
  const available = Math.min(lineAvailable, categoryAvailable);
  const amountError = amount && (!positiveInteger(amount) ? 'Enter a whole IDR amount greater than zero.' : selectedLine && Number(amount) > available ? `You can claim up to ${formatCurrency(available)} from this expense allocation.` : '');
  const valid = contactId && title.trim() && selected && selectedLine && (!categories.length || selectedCategory) && positiveInteger(amount) && Number(amount) <= available && !claimsQuery.isPending && !claimsQuery.isError;
  const create = useMutation({
    mutationFn: () => api.reimbursements.create({
      contactId: Number(contactId), title: title.trim(), dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).getTime() : null,
      notes: notes.trim() || null,
      sources: [{ sourceTransactionId: Number(sourceId), expenseLineId: selectedLine!.id, categoryId: selectedCategory?.categoryId ?? null, amount: Number(amount) }],
    }), onSuccess: onSaved,
  });
  const organization = useMutation({
    mutationFn: () => api.contacts.create({ name: organizationName.trim(), kind: 'organization' }),
    onSuccess: async (contact) => { setContactId(String(contact.id)); setOrganizationName(''); setAddingOrganization(false); await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all }); },
  });
  const choose = (expense: Expense) => {
    const line = expense.lines.find((item) => item.accountType === 'expense' && item.debit > item.credit);
    setSourceId(String(expense.id)); setLineId(line ? String(line.id) : '');
    setCategoryId(expense.categoryAllocations.length === 1 ? String(expense.categoryAllocations[0]!.categoryId) : '');
    setAmount(String(expense.remainingReimbursableExpense ?? expense.expenseCents));
    if (!title.trim()) setTitle(expense.description.slice(0, 500));
    setFindingExpense(false); setSearch(''); create.reset();
  };
  const expenses = (expenseQuery.data?.data ?? []).filter((expense) => expense.status === 'posted' && (expense.remainingReimbursableExpense ?? expense.expenseCents) > 0 && expense.lines.some((line) => line.accountType === 'expense' && line.debit > line.credit));

  return <Modal isOpen onClose={() => { if (!create.isPending && !organization.isPending) onClose(); }} title="New reimbursement claim" subtitle="Start with an expense you paid. Save a draft, then track its approval and payment." size="xl" className="!max-w-3xl" showCloseLabel={false} footer={<div className="flex items-center justify-between gap-3"><p className="hidden text-xs text-[var(--ref-outline)] sm:block">Your expense stays unchanged until approval.</p><div className="ml-auto flex gap-2"><Button variant="secondary" disabled={create.isPending || organization.isPending} onClick={onClose}>Cancel</Button><Button type="submit" form="reimbursement-claim" disabled={!valid || create.isPending || organization.isPending}>{create.isPending ? 'Saving…' : 'Save draft'}</Button></div></div>}>
    <form id="reimbursement-claim" onSubmit={(event) => { event.preventDefault(); if (valid && !create.isPending && !organization.isPending) create.mutate(); }} className="space-y-6">
      <fieldset disabled={create.isPending} className="space-y-6">
        <section><h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ref-primary)]/10 text-xs text-[var(--ref-primary)]">1</span>Link your expense</h3>
          {sourceId && <div className="rounded-xl border border-[var(--ref-primary)]/30 bg-[var(--ref-primary)]/5 p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-1.5 text-xs font-bold text-[var(--ref-primary)]"><CheckCircle2 className="h-4 w-4" />Selected expense</p><p className="mt-2 break-words font-bold">{selected?.description ?? (selectedQuery.isError ? 'Expense unavailable' : 'Loading expense…')}</p>{selected && <p className={hint}>{dateLabel(selected.date)} · Transaction #{selected.id}</p>}</div><button type="button" onClick={() => setFindingExpense(!findingExpense)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-[var(--ref-primary)]">{findingExpense ? 'Keep selected' : 'Change'}</button></div>
            <ErrorMessage error={selectedQuery.error} />
          </div>}
          {findingExpense && <div className="mt-3"><label className="relative block"><span className="sr-only">Find an expense</span><Search className="absolute left-3 top-3.5 h-4 w-4 text-[var(--ref-outline)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant or description…" className={cn(field, 'pl-9')} /></label><p className={hint}>{search ? 'Matching expenses with an available balance' : 'Recent expenses with an available balance'}</p>
            <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-[var(--color-border)]" aria-live="polite">
              {expenseQuery.isPending || search !== debouncedSearch ? <p className="p-4 text-sm text-[var(--ref-outline)]">Finding expenses…</p> : expenseQuery.isError ? <div className="p-3"><ErrorMessage error={expenseQuery.error} /><Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void expenseQuery.refetch()}>Try again</Button></div> : expenses.length ? expenses.map((expense) => <button key={expense.id} type="button" onClick={() => choose(expense)} className="flex w-full items-center justify-between gap-4 border-b border-[var(--color-border)] p-3 text-left last:border-0 hover:bg-[var(--ref-surface-container-low)] focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{expense.description}</span><span className="mt-1 block text-xs text-[var(--ref-outline)]">{dateLabel(expense.date)}</span></span><span className="shrink-0 text-sm font-bold tabular-nums">{formatCurrency(expense.remainingReimbursableExpense ?? expense.expenseCents)}</span></button>) : <p className="p-4 text-sm text-[var(--ref-on-surface-variant)]">No available expenses found. Try another search or add a posted expense in Transactions.</p>}
            </div>
          </div>}
          {expenseLines.length > 1 && <label className={cn(label, 'mt-3')}>Expense account<select className={field} value={selectedLine?.id ?? ''} onChange={(event) => setLineId(event.target.value)} required><option value="">Choose expense account</option>{expenseLines.map((line) => <option key={line.id} value={line.id}>{accountsQuery.data?.find((account) => account.id === line.accountId)?.name} · {formatCurrency(line.debit - line.credit)}</option>)}</select></label>}
          {selected && !accountsQuery.isPending && !accountsQuery.isError && !expenseLines.length && <p role="alert" className="mt-2 text-sm text-[var(--ref-error)]">This transaction has no eligible expense line. Choose another expense.</p>}
        </section>
        <section><h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ref-primary)]/10 text-xs text-[var(--ref-primary)]">2</span>Claim details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={cn(label, 'sm:col-span-2')}>Claim title<input required maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Client meeting travel" className={field} /></label>
            <div className="sm:col-span-2"><label className={label}>Who will reimburse you?<select required value={contactId} onChange={(event) => setContactId(event.target.value)} className={field} disabled={contactsQuery.isPending}><option value="">{contactsQuery.isPending ? 'Loading payers…' : 'Choose a person or organization'}</option>{(contactsQuery.data ?? []).filter((contact) => contact.isActive).map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
              <ErrorMessage error={contactsQuery.error} />
              <button type="button" onClick={() => setAddingOrganization(!addingOrganization)} aria-expanded={addingOrganization} className="mt-2 flex items-center gap-1 text-xs font-semibold text-[var(--ref-primary)]"><Plus className="h-3.5 w-3.5" />{addingOrganization ? 'Hide new organization' : 'Add an organization'}</button>
              {addingOrganization && <div className="mt-2 flex items-end gap-2 rounded-xl bg-[var(--ref-surface-container-low)] p-3"><label className={cn(label, 'min-w-0 flex-1')}>Organization name<input value={organizationName} maxLength={200} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Employer or client" className={field} /></label><Button type="button" variant="secondary" disabled={!organizationName.trim() || organization.isPending} onClick={() => organization.mutate()}>{organization.isPending ? 'Adding…' : 'Add'}</Button></div>}
              <ErrorMessage error={organization.error} />
            </div>
            {categories.length > 0 && <label className={cn(label, 'sm:col-span-2')}>Expense category<select required className={field} value={selectedCategory?.categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value)}><option value="">Choose a category allocation</option>{categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName ?? 'Unnamed category'} · {formatCurrency(category.amount)}</option>)}</select><p className={hint}>Choose the part of the expense this claim covers.</p></label>}
            <label className={label}>Claim amount (IDR)<input required inputMode="numeric" value={amount} aria-invalid={Boolean(amountError)} aria-describedby="claim-amount-hint" onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} placeholder="0" className={cn(field, 'tabular-nums', amountError && 'border-[var(--ref-error)]')} /><p id="claim-amount-hint" className={cn(hint, amountError && 'text-[var(--ref-error)]')}>{amountError || (selectedLine ? `${formatCurrency(available)} available · whole rupiah` : 'Choose an expense first. Use whole rupiah.')}</p></label>
            <label className={label}>Due date <span className="font-normal text-[var(--ref-outline)]">(optional)</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={field} /><p className={hint}>When you expect to be paid back.</p></label>
            <label className={cn(label, 'sm:col-span-2')}>Notes <span className="font-normal text-[var(--ref-outline)]">(optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={4000} placeholder="Add a reference or context for this claim" className={field} /></label>
          </div>
        </section>
      </fieldset>
      <ErrorMessage error={accountsQuery.error ?? claimsQuery.error ?? create.error} />
    </form>
  </Modal>;
}

export function PaymentDialog({ claims, initialClaimId, onClose, onSaved }: { claims: Claim[]; initialClaimId?: number; onClose: () => void; onSaved: () => Promise<void> }) {
  useDialogScrollLock();
  const accountsQuery = useAccountsQuery();
  const eligible = claims.filter((claim) => claim.outstandingAmount > 0);
  const initialClaim = eligible.find((claim) => claim.id === initialClaimId) ?? (eligible.length === 1 ? eligible[0] : undefined);
  const [claimId, setClaimId] = useState(initialClaim ? String(initialClaim.id) : '');
  const [amount, setAmount] = useState(initialClaim ? String(initialClaim.outstandingAmount) : '');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayInput);
  // Keep the same key when retrying an unchanged payment after a network failure.
  const [attempt, setAttempt] = useState<{ payload: string; key: string } | null>(null);
  const selected = eligible.find((claim) => String(claim.id) === claimId);
  const accounts = (accountsQuery.data ?? []).filter((account) => account.isActive && account.type === 'asset' && account.liquidityClass === 'cash_equivalent' && !account.systemKey);
  const error = amount && (!positiveInteger(amount) ? 'Enter a whole IDR amount greater than zero.' : selected && Number(amount) > selected.outstandingAmount ? `Payment cannot exceed ${formatCurrency(selected.outstandingAmount)}.` : '');
  const valid = selected && positiveInteger(amount) && Number(amount) <= selected.outstandingAmount && accounts.some((account) => String(account.id) === accountId) && date && date <= todayInput();
  const payment = useMutation({
    mutationFn: () => {
      const data = { date: new Date(`${date}T12:00:00`).getTime(), walletAccountId: Number(accountId), allocations: [{ claimId: Number(claimId), amount: Number(amount) }] };
      const payload = JSON.stringify(data);
      const key = attempt?.payload === payload ? attempt.key : crypto.randomUUID();
      setAttempt({ payload, key });
      return api.reimbursements.receipt({ ...data, idempotencyKey: key });
    }, onSuccess: onSaved,
  });
  return <Modal isOpen onClose={() => { if (!payment.isPending) onClose(); }} title="Record payment" className="!max-w-xl" footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={payment.isPending} onClick={onClose}>Cancel</Button><Button type="submit" form="reimbursement-payment" disabled={!valid || payment.isPending}>{payment.isPending ? 'Recording…' : 'Record payment'}</Button></div>}>
    <form id="reimbursement-payment" onSubmit={(event) => { event.preventDefault(); if (valid && !payment.isPending) payment.mutate(); }} className="space-y-4">
      <p className="text-sm text-[var(--ref-on-surface-variant)]">Log money you have received against an approved claim.</p>
      <fieldset disabled={payment.isPending} className="space-y-4">
        <label className={label}>Claim<select required value={claimId} onChange={(event) => { setClaimId(event.target.value); const next = eligible.find((claim) => String(claim.id) === event.target.value); setAmount(next ? String(next.outstandingAmount) : ''); payment.reset(); }} className={field}><option value="">Choose an outstanding claim</option>{eligible.map((claim) => <option key={claim.id} value={claim.id}>{claim.title} · {claim.contact?.name} · {formatCurrency(claim.outstandingAmount)}</option>)}</select></label>
        {selected && <div className="flex items-center gap-3 rounded-xl bg-[var(--ref-primary)]/5 p-4"><Wallet className="h-6 w-6 text-[var(--ref-primary)]" /><div><p className="text-xs text-[var(--ref-on-surface-variant)]">Left to receive from {selected.contact?.name ?? 'payer'}</p><p className="mt-1 text-xl font-extrabold tabular-nums">{formatCurrency(selected.outstandingAmount)}</p></div></div>}
        <label className={label}>Received into<select required value={accountId} onChange={(event) => setAccountId(event.target.value)} className={field} disabled={accountsQuery.isPending}><option value="">{accountsQuery.isPending ? 'Loading accounts…' : 'Choose a bank account or wallet'}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{!accountsQuery.isPending && !accountsQuery.isError && !accounts.length && <p className={hint}>Add an active cash or bank account in Accounts before recording a payment.</p>}</label>
        <div className="grid gap-4 sm:grid-cols-2"><label className={label}>Amount received (IDR)<input required value={amount} inputMode="numeric" aria-invalid={Boolean(error)} aria-describedby="payment-amount-hint" onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} className={field} placeholder="0" /><p id="payment-amount-hint" className={cn(hint, error && 'text-[var(--ref-error)]')}>{error || 'Partial payments are welcome.'}</p></label><label className={label}>Payment date<input required type="date" value={date} max={todayInput()} onChange={(event) => setDate(event.target.value)} className={field} /></label></div>
        {selected && positiveInteger(amount) && !error && <div className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-sm"><span className="text-[var(--ref-on-surface-variant)]">Remaining after payment</span><span className="font-bold tabular-nums text-[var(--ref-secondary)]">{formatCurrency(selected.outstandingAmount - Number(amount))}</span></div>}
      </fieldset>
      <ErrorMessage error={accountsQuery.error ?? payment.error} />
    </form>
  </Modal>;
}
