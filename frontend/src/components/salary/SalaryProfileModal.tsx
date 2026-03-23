import { useCallback, useEffect, useState, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { formatCurrency, parseIdNominalToInt, cn } from '../../lib/utils';
import { CurrencyInput } from '../ui/CurrencyInput';
import { Landmark, Wallet, Banknote, ToggleLeft, ToggleRight, Calculator, Info } from 'lucide-react';

type PtkpOption = { code: string; label: string; annualPtkp: number; terCategory: string };

const PTKP_FALLBACK: PtkpOption[] = [
  { code: 'TK0', label: 'TK/0 — single, no dependants', annualPtkp: 54_000_000, terCategory: 'A' },
  { code: 'K0', label: 'K/0 — married, no dependants', annualPtkp: 58_500_000, terCategory: 'A' },
  { code: 'K1', label: 'K/1 — married + 1 dependant', annualPtkp: 63_000_000, terCategory: 'B' },
  { code: 'K2', label: 'K/2 — married + 2 dependants', annualPtkp: 67_500_000, terCategory: 'B' },
  { code: 'K3', label: 'K/3 — married + 3 dependants', annualPtkp: 72_000_000, terCategory: 'B' },
];

const WALLET_ICONS = [Landmark, Wallet, Banknote] as const;

// JKK Risk Grade options
const JKK_OPTIONS = [
  { value: 24, label: '0.24% — Very Low Risk', description: 'Office/administrative work' },
  { value: 54, label: '0.54% — Low Risk', description: 'Light manufacturing, retail' },
  { value: 89, label: '0.89% — Medium Risk', description: 'Manufacturing, warehousing' },
  { value: 127, label: '1.27% — High Risk', description: 'Construction, heavy industry' },
  { value: 174, label: '1.74% — Very High Risk', description: 'Mining, offshore' },
];

type Computed = {
  grossMonthly: number;
  ptkpCode: string;
  ptkpAnnual: number;
  terCategory: string;
  taxBasisBruto: number;
  employerJkk: number;
  employerJkm: number;
  employerBpjsKes: number;
  jhtMonthly: number;
  jpMonthly: number;
  bpjsKesehatanMonthly: number;
  pph21Monthly: number;
  totalMandatoryDeductionsMonthly: number;
  estimatedNetMonthly: number;
  calculationMethod: string;
  notes: string[];
};

type Account = { id: number; name: string; type: string };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initial: {
    grossMonthly: number;
    payrollDay: number;
    ptkpCode: string;
    depositAccountId: number | null;
    terCategory: string;
    jkkRiskGrade: number;
    jkmRate: number;
    bpjsKesehatanActive: boolean;
    jpWageCap: number;
    bpjsKesWageCap: number;
    jhtWageCap: number;
  };
  ptkpOptions: PtkpOption[];
  accounts: Account[];
  onSaved: (payload: Awaited<ReturnType<typeof api.salarySettings.update>>) => void;
}

export function SalaryProfileModal({ isOpen, onClose, initial, ptkpOptions, accounts, onSaved }: Props) {
  const [grossStr, setGrossStr] = useState('');
  const [payrollDay, setPayrollDay] = useState(25);
  const [ptkpCode, setPtkpCode] = useState('TK0');
  const [depositAccountId, setDepositAccountId] = useState<string>('');
  const [previewMonth, setPreviewMonth] = useState(1);
  
  // TER settings
  const [jkkRiskGrade, setJkkRiskGrade] = useState(24);
  const [jkmRate, setJkmRate] = useState(30);
  const [bpjsKesehatanActive, setBpjsKesehatanActive] = useState(true);
  const [jpWageCap, setJpWageCap] = useState(10042300);
  const [bpjsKesWageCap, setBpjsKesWageCap] = useState(12000000);
  const [jhtWageCap, setJhtWageCap] = useState(12000000);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [preview, setPreview] = useState<Computed | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshPreview = useCallback(
    async (gross: number, code: string, month: number) => {
      try {
        const { computed } = await api.salarySettings.preview({
          grossMonthly: gross,
          ptkpCode: code,
          month,
          jkkRiskGrade: jkkRiskGrade,
          jkmRate: jkmRate,
          bpjsKesehatanActive: bpjsKesehatanActive,
          jpWageCap: jpWageCap,
          bpjsKesWageCap: bpjsKesWageCap,
          jhtWageCap: jhtWageCap,
        });
        setPreview(computed);
      } catch {
        setPreview(null);
      }
    },
    [jkkRiskGrade, jkmRate, bpjsKesehatanActive, jpWageCap, bpjsKesWageCap, jhtWageCap],
  );

  // Only initialize state when modal opens (isOpen changes from false to true)
  const prevIsOpen = useRef(isOpen);
  useEffect(() => {
    if (!isOpen) {
      prevIsOpen.current = false;
      return;
    }
    // Only reset state when modal first opens
    if (!prevIsOpen.current) {
      prevIsOpen.current = true;
      setGrossStr(initial.grossMonthly > 0 ? new Intl.NumberFormat('id-ID').format(initial.grossMonthly) : '');
      setPayrollDay(initial.payrollDay);
      setPtkpCode(initial.ptkpCode);
      setDepositAccountId(initial.depositAccountId ? String(initial.depositAccountId) : '');
      setJkkRiskGrade(initial.jkkRiskGrade ?? 24);
      setJkmRate(initial.jkmRate ?? 30);
      setBpjsKesehatanActive(initial.bpjsKesehatanActive ?? true);
      setJpWageCap(initial.jpWageCap ?? 10042300);
      setBpjsKesWageCap(initial.bpjsKesWageCap ?? 12000000);
      setJhtWageCap(initial.jhtWageCap ?? 12000000);
      setErr(null);
      void refreshPreview(initial.grossMonthly, initial.ptkpCode, previewMonth);
    }
  }, [isOpen, initial.grossMonthly, initial.payrollDay, initial.ptkpCode, initial.depositAccountId, initial.jkkRiskGrade, initial.jkmRate, initial.bpjsKesehatanActive, initial.jpWageCap, initial.bpjsKesWageCap, initial.jhtWageCap, previewMonth, refreshPreview]);

  const digitsOnly = grossStr.replace(/\D/g, '');
  const grossNum = digitsOnly === '' ? 0 : parseIdNominalToInt(grossStr);
  const grossValid = !Number.isNaN(grossNum) && grossNum >= 0;

  useEffect(() => {
    if (!isOpen || !grossValid) return;
    const t = window.setTimeout(() => {
      void refreshPreview(grossNum, ptkpCode, previewMonth);
    }, 250);
    return () => window.clearTimeout(t);
  }, [grossStr, ptkpCode, previewMonth, isOpen, grossValid, grossNum, refreshPreview]);

  const handleSave = async () => {
    if (!grossValid) {
      setErr('Enter a valid gross salary (IDR).');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await api.salarySettings.update({
        grossMonthly: grossNum,
        payrollDay,
        ptkpCode,
        depositAccountId: depositAccountId ? parseInt(depositAccountId, 10) : null,
        jkkRiskGrade,
        jkmRate,
        bpjsKesehatanActive,
        jpWageCap,
        bpjsKesWageCap,
        jhtWageCap,
      });
      onSaved(res);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const selectOpts = (ptkpOptions.length > 0 ? ptkpOptions : PTKP_FALLBACK).map((o) => ({
    value: o.code,
    label: `${o.label} (TER ${o.terCategory})`,
  }));

  const assetAccounts = accounts.filter((a) => a.type === 'asset');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Salary profile"
      subtitle="Configure gross salary, PTKP status, payday, deposit account, and statutory deduction settings."
      size="xl"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        <div className="lg:col-span-8 space-y-6">
          {/* Gross Salary */}
          <CurrencyInput
            label="Gross monthly salary"
            value={grossStr}
            onChange={(value) => setGrossStr(value)}
            size="lg"
            required
          />

          {/* Basic Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Payday (day of month)"
              type="number"
              min={1}
              max={31}
              value={payrollDay}
              onChange={(e) => setPayrollDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
            />

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                PTKP status
              </label>
              <div className="relative">
                <select
                  value={ptkpCode}
                  onChange={(e) => setPtkpCode(e.target.value)}
                  className="w-full appearance-none bg-[var(--ref-surface-container-low)] border-none rounded-xl px-3 py-3 focus:ring-2 focus:ring-[var(--color-accent)]/20 text-[var(--color-text-primary)] transition-all"
                >
                  {selectOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] text-lg">
                  ▾
                </span>
              </div>
            </div>
          </div>

          {/* Deposit Account Selection */}
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
              Deposit account (salary will be posted here)
            </label>
            {assetAccounts.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                No asset accounts available. Create a wallet account first.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {assetAccounts.map((a, idx) => {
                  const Icon = WALLET_ICONS[idx % 3];
                  const selected = depositAccountId === String(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setDepositAccountId(String(a.id))}
                      className={cn(
                        'flex flex-col items-start p-4 rounded-xl transition-all text-left min-h-[96px]',
                        selected
                          ? 'bg-[var(--ref-surface-container-lowest)] border-2 border-[var(--ref-primary-container)] shadow-sm'
                          : 'bg-[var(--ref-surface-container-low)] border-2 border-transparent hover:border-[var(--ref-surface-container-highest)]',
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-6 h-6 mb-2',
                          selected ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]',
                        )}
                      />
                      <span className="text-xs font-bold text-[var(--color-text-primary)] line-clamp-2">
                        {a.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
          >
            <Calculator className="w-4 h-4" />
            {showAdvanced ? 'Hide' : 'Show'} advanced statutory settings
            {showAdvanced ? '▾' : '▸'}
          </button>

          {/* Advanced Settings */}
          {showAdvanced && (
            <div className="space-y-5 rounded-xl bg-[var(--ref-surface-container-low)] p-5">
              {/* JKK Risk Grade */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  JKK Risk Grade (Work Accident Insurance)
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {JKK_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setJkkRiskGrade(opt.value)}
                      className={cn(
                        'flex items-center justify-between p-3 rounded-lg text-left transition-all',
                        jkkRiskGrade === opt.value
                          ? 'bg-[var(--ref-surface-container-lowest)] border-2 border-[var(--ref-primary-container)]'
                          : 'bg-[var(--ref-surface-container)] border-2 border-transparent hover:border-[var(--ref-surface-container-highest)]',
                      )}
                    >
                      <div>
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {opt.label}
                        </span>
                        <p className="text-xs text-[var(--color-text-secondary)]">{opt.description}</p>
                      </div>
                      {jkkRiskGrade === opt.value && (
                        <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* BPJS Kesehatan Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    BPJS Kesehatan (Health Insurance)
                  </label>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Include 1% employee + 4% employer contribution
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBpjsKesehatanActive(!bpjsKesehatanActive)}
                  className={cn(
                    'cursor-pointer transition-all hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 rounded-full',
                    bpjsKesehatanActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]',
                  )}
                  aria-pressed={bpjsKesehatanActive}
                  aria-label={bpjsKesehatanActive ? 'BPJS Kesehatan is enabled, click to disable' : 'BPJS Kesehatan is disabled, click to enable'}
                >
                  {bpjsKesehatanActive ? (
                    <ToggleRight className="w-10 h-10" strokeWidth={2} />
                  ) : (
                    <ToggleLeft className="w-10 h-10" strokeWidth={2} />
                  )}
                </button>
              </div>

              {/* Wage Caps */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CurrencyInput
                  label="JP Wage Cap"
                  value={new Intl.NumberFormat('id-ID').format(jpWageCap)}
                  onChange={(value) => {
                    const val = parseIdNominalToInt(value);
                    if (!Number.isNaN(val)) setJpWageCap(val);
                  }}
                  size="sm"
                  showDivider={false}
                />
                <CurrencyInput
                  label="JHT Wage Cap"
                  value={new Intl.NumberFormat('id-ID').format(jhtWageCap)}
                  onChange={(value) => {
                    const val = parseIdNominalToInt(value);
                    if (!Number.isNaN(val)) setJhtWageCap(val);
                  }}
                  size="sm"
                  showDivider={false}
                />
                <CurrencyInput
                  label="BPJS Kes Wage Cap"
                  value={new Intl.NumberFormat('id-ID').format(bpjsKesWageCap)}
                  onChange={(value) => {
                    const val = parseIdNominalToInt(value);
                    if (!Number.isNaN(val)) setBpjsKesWageCap(val);
                  }}
                  size="sm"
                  showDivider={false}
                />
              </div>

              {/* Month Preview Toggle */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  Preview calculation for month
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[...Array(12)].map((_, i) => (
                    <button
                      key={i + 1}
                      type="button"
                      onClick={() => setPreviewMonth(i + 1)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                        previewMonth === i + 1
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'bg-[var(--ref-surface-container)] text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-highest)]',
                      )}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                {previewMonth === 12 && (
                  <p className="text-xs text-[var(--color-text-secondary)] flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    December uses annualized Pasal 17 calculation with true-up
                  </p>
                )}
              </div>
            </div>
          )}

          {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
        </div>

        {/* Sidebar Preview */}
        <div className="lg:col-span-4">
          {preview && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4 space-y-3 sticky top-0">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Month {previewMonth} Preview
                </p>
                <span className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                  preview.calculationMethod === 'TER'
                    ? 'bg-[var(--ref-primary-container)] text-[var(--ref-primary)]'
                    : 'bg-[var(--ref-secondary-container)] text-[var(--ref-secondary)]',
                )}>
                  {preview.calculationMethod}
                </span>
              </div>

              {/* Tax Basis */}
              <div className="space-y-1 pb-3 border-b border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-secondary)]">Tax Basis (Bruto)</p>
                <p className="font-headline font-bold text-lg text-[var(--color-text-primary)]">
                  {formatCurrency(preview.taxBasisBruto)}
                </p>
                <div className="text-[10px] text-[var(--color-text-secondary)] space-y-0.5">
                  <p>Base: {formatCurrency(preview.grossMonthly)}</p>
                  <p>+ JKK ({(jkkRiskGrade / 100).toFixed(2)}%): {formatCurrency(preview.employerJkk)}</p>
                  <p>+ JKM ({(jkmRate / 100).toFixed(2)}%): {formatCurrency(preview.employerJkm)}</p>
                  {bpjsKesehatanActive && (
                    <p>+ BPJS Kes (4%): {formatCurrency(preview.employerBpjsKes)}</p>
                  )}
                </div>
              </div>

              {/* Deductions */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--color-text-secondary)]">PPh 21</span>
                  <span className="font-mono font-semibold text-[var(--color-danger)]">
                    {formatCurrency(preview.pph21Monthly)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--color-text-secondary)]">JHT (2%)</span>
                  <span className="font-mono font-semibold">{formatCurrency(preview.jhtMonthly)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--color-text-secondary)]">JP (1%)</span>
                  <span className="font-mono font-semibold">{formatCurrency(preview.jpMonthly)}</span>
                </div>
                {bpjsKesehatanActive && (
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-secondary)]">BPJS Kes (1%)</span>
                    <span className="font-mono font-semibold">{formatCurrency(preview.bpjsKesehatanMonthly)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 border-t border-[var(--color-border)] pt-2 mt-1">
                  <span className="font-bold text-[var(--color-text-primary)]">Est. net take-home</span>
                  <span className="font-headline font-bold text-[var(--color-accent)]">
                    {formatCurrency(preview.estimatedNetMonthly)}
                  </span>
                </div>
              </div>

              <p className="text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                {preview.notes[0]}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-[var(--color-border)]">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={saving || !grossValid}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
