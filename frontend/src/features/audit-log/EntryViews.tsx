import { Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { cn, formatDateTime, formatTime } from '../../lib/utils';
import { useAuditRecordHistoryQuery } from './queries';
import { entryTitle } from './format';
import { actionLabel, auditAmount, auditChanges, auditKind, auditReason, entityLabel, type AuditEntry, type AuditFormat, type AuditKind } from './describe';

const KIND_ICON: Record<AuditKind, { icon: typeof Plus; className: string }> = {
  added: { icon: Plus, className: 'text-[var(--color-success)]' },
  changed: { icon: Pencil, className: 'text-[var(--ref-primary)]' },
  removed: { icon: Trash2, className: 'text-[var(--color-danger)]' },
  step: { icon: CheckCircle2, className: 'text-[var(--ref-on-surface-variant)]' },
};

function KindIcon({ action, className }: { action: string; className?: string }) {
  const { icon: Icon, className: tone } = KIND_ICON[auditKind(action)];
  return (
    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ref-surface-container-low)]', className)} aria-hidden>
      <Icon className={cn('h-4 w-4', tone)} />
    </span>
  );
}

/** One entry in the list: what it's about, what happened, and the first changes. */
export function EntryRow({ entry, format, onOpen }: { entry: AuditEntry; format: AuditFormat; onOpen: () => void }) {
  const amount = auditAmount(entry);
  const kind = auditKind(entry.action);
  // An add or a deletion is described by its name; for the rest, the fields that changed say it.
  const changes = kind === 'changed' || kind === 'step' ? auditChanges(entry, format) : [];
  const reason = auditReason(entry);
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:bg-[var(--ref-surface-container-low)] focus-visible:outline-none">
        <KindIcon action={entry.action} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cn('truncate text-sm font-semibold text-[var(--ref-on-surface)]', kind === 'removed' && 'line-through decoration-[var(--color-danger)]/50')}>{entryTitle(entry)}</span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatTime(entry.createdAt)}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--ref-on-surface-variant)]">
            {actionLabel(entry.action)} · {entityLabel(entry.entityType)}{amount != null ? ` · ${format.amount(amount)}` : ''}{reason ? ` · ${reason}` : ''}
          </span>
          {changes.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {changes.slice(0, 2).map((change) => (
                <span key={change.key} className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-[var(--ref-surface-container-low)] px-2 py-0.5 text-[11px] text-[var(--ref-on-surface-variant)]">
                  <span className="font-semibold text-[var(--ref-on-surface)]">{change.label}</span>
                  <span className="truncate">{change.before}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" aria-label="to" />
                  <span className="truncate font-medium text-[var(--ref-on-surface)]">{change.after}</span>
                </span>
              ))}
              {changes.length > 2 && <span className="px-1 py-0.5 text-[11px] text-[var(--ref-on-surface-variant)]">+{changes.length - 2} more</span>}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function Swatch({ color }: { color: string | null | undefined }) {
  return color ? <span className="mr-1.5 inline-block h-3 w-3 rounded-full align-[-1px] ring-1 ring-black/10" style={{ background: color }} aria-hidden /> : null;
}

/** An entry opened: every field that changed, the record's whole history, and the raw record. */
export function EntryDetail({ entry, format, onClose, onOpen }: { entry: AuditEntry | null; format: AuditFormat; onClose: () => void; onOpen: (entry: AuditEntry) => void }) {
  const historyQuery = useAuditRecordHistoryQuery(entry?.entityType ?? null, entry?.entityId ?? null);
  if (!entry) return null;
  const kind = auditKind(entry.action);
  const changes = auditChanges(entry, format);
  const compare = Boolean(entry.beforeSnapshot && entry.afterSnapshot);
  const reason = auditReason(entry);
  const history = (historyQuery.data?.history ?? []) as AuditEntry[];
  const heading = compare ? 'What changed' : kind === 'removed' || !entry.afterSnapshot ? 'What it held' : 'What was recorded';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={entryTitle(entry)}
      subtitle={`${actionLabel(entry.action)} · ${entityLabel(entry.entityType)} · ${formatDateTime(entry.createdAt, { withSeconds: true })}`}
      size="xl"
      showCloseLabel={false}
    >
      <div className="space-y-6">
        {reason && <p className="text-sm text-[var(--ref-on-surface-variant)]"><span className="font-semibold text-[var(--ref-on-surface)]">Reason given:</span> {reason}</p>}

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">{heading}</h3>
          {changes.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--ref-on-surface-variant)]">Nothing you’d see changed; this step only touched the record’s bookkeeping.</p>
          ) : (
            <table className="mt-2 w-full table-fixed border-collapse text-sm">
              {compare && (
                <thead>
                  <tr className="text-left text-xs text-[var(--ref-on-surface-variant)]">
                    <th className="w-[30%] py-1.5 pr-3 font-medium"><span className="sr-only">Field</span></th>
                    <th className="py-1.5 pr-3 font-medium">Before</th>
                    <th className="py-1.5 font-medium">After</th>
                  </tr>
                </thead>
              )}
              <tbody className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                {changes.map((change) => (
                  <tr key={change.key} className="align-top">
                    <th scope="row" className="w-[30%] py-2 pr-3 text-left font-medium text-[var(--ref-on-surface-variant)]">{change.label}</th>
                    {compare ? (
                      <>
                        <td className="break-words py-2 pr-3 text-[var(--ref-on-surface-variant)]"><Swatch color={change.color?.before} />{change.before}</td>
                        <td className="break-words py-2 font-medium text-[var(--ref-on-surface)]"><Swatch color={change.color?.after} />{change.after}</td>
                      </>
                    ) : (
                      <td className="break-words py-2 text-[var(--ref-on-surface)]" colSpan={2}>
                        <Swatch color={entry.afterSnapshot ? change.color?.after : change.color?.before} />{entry.afterSnapshot ? change.after : change.before}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {history.length > 1 && (
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">Everything that happened to it</h3>
            <ol className="mt-2 space-y-0.5">
              {history.map((step) => (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(step)}
                    disabled={step.id === entry.id}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)] disabled:cursor-default disabled:bg-[var(--ref-surface-container-low)]"
                  >
                    <KindIcon action={step.action} className="h-7 w-7" />
                    <span className="flex-1 font-medium text-[var(--ref-on-surface)]">{actionLabel(step.action)}{step.id === entry.id ? <span className="ml-2 text-xs font-normal text-[var(--ref-on-surface-variant)]">This entry</span> : null}</span>
                    <span className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatDateTime(step.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]">The full record as saved</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {entry.beforeSnapshot && <pre className="max-h-64 overflow-auto rounded-xl bg-[var(--ref-surface-container-low)] p-3 font-mono text-[11px] leading-relaxed text-[var(--ref-on-surface)]"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">Before</span>{JSON.stringify(entry.beforeSnapshot, null, 2)}</pre>}
            {entry.afterSnapshot && <pre className="max-h-64 overflow-auto rounded-xl bg-[var(--ref-surface-container-low)] p-3 font-mono text-[11px] leading-relaxed text-[var(--ref-on-surface)]"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">After</span>{JSON.stringify(entry.afterSnapshot, null, 2)}</pre>}
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {entry.entityType === 'transaction' && kind !== 'removed' && (
            <Link to="/transactions" search={{ transactionId: String(entry.entityId) }} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10">
              Open in Transactions <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Button type="button" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
