import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { Calculator, Check, ClipboardCopy, Download, Pencil, Plus, ReceiptText, Trash2, UserPlus } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { Modal } from '../ui/Modal';

export type SplitChargeRule = 'proportional' | 'equal' | 'payer';

export type SplitBillAccount = {
  id: number;
  name: string;
  provider?: string | null;
  accountNumber?: string | null;
};

export type SplitBillVisualization = {
  type: 'split_bill';
  title: string;
  merchant?: string;
  date?: string;
  currency?: 'IDR';
  items: Array<{ id: string; name: string; quantity: number; amount: number; participantIds: string[] }>;
  participants: Array<{ id: string; name: string }>;
  charges: {
    tax: number;
    service: number;
    discount: number;
    tip: number;
    taxRule: SplitChargeRule;
    serviceRule: SplitChargeRule;
    discountRule: SplitChargeRule;
    tipRule: SplitChargeRule;
  };
  payerId?: string;
  note?: string;
};

type DraftItem = SplitBillVisualization['items'][number];
type DraftParticipant = SplitBillVisualization['participants'][number];
type ChargeKey = 'tax' | 'service' | 'discount' | 'tip';
type ChargeState = SplitBillVisualization['charges'];
type ChargeRuleKey = 'taxRule' | 'serviceRule' | 'discountRule' | 'tipRule';

const MAX_ITEMS = 60;
const MAX_PARTICIPANTS = 20;

// PNG-only vertical nudges. Negative values move the selected text upward.
// These preserve the current manual pill adjustment, but each label can now
// be tuned independently without moving its pill background.
const PNG_TEXT_VERTICAL_OFFSETS = {
  paidByPill: -6,
  payerPill: -6,
  splitBillLabel: 4,
  totalLabel: -4,
  totalAmount: -12,
  totalItems: -12,
} as const;

// PNG-only layout nudges. These move the whole pill or separator, including
// the pill background, without affecting the live card.
const PNG_LAYOUT_VERTICAL_OFFSETS = {
  paidByPill: 4,
  payerPill: 7,
  splitBillIcon: 8,
  itemDivider: 8,
  shareDivider: 8,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown, fallback = '', maxLength = 120): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function readAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readQuantity(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, 999) : 1;
}

function readRule(value: unknown): SplitChargeRule {
  return value === 'equal' || value === 'payer' ? value : 'proportional';
}

function normalizeId(value: unknown, fallback: string): string {
  const id = readText(value, '', 40);
  return /^[a-z0-9_-]{1,40}$/i.test(id) ? id : fallback;
}

/** Parses a strictly bounded, model-produced split-bill draft. The card itself
 * performs all split calculations; model values are never treated as totals. */
export function parseSplitBillVisualization(value: unknown): SplitBillVisualization | null {
  if (!isRecord(value) || value.type !== 'split_bill') return null;
  const title = readText(value.title);
  if (!title) return null;

  const participants = Array.isArray(value.participants)
    ? value.participants.filter(isRecord).slice(0, MAX_PARTICIPANTS).flatMap((person, index) => {
      const name = readText(person.name);
      return name ? [{ id: normalizeId(person.id, `person_${index + 1}`), name }] : [];
    })
    : [];
  if (participants.length === 0) participants.push({ id: 'me', name: 'You' });
  if (!participants.some((person) => person.id === 'me')) participants.unshift({ id: 'me', name: 'You' });
  const uniqueParticipants = participants.filter((person, index) => participants.findIndex((candidate) => candidate.id === person.id) === index);

  const participantIds = new Set(uniqueParticipants.map((person) => person.id));
  const items = Array.isArray(value.items)
    ? value.items.filter(isRecord).slice(0, MAX_ITEMS).flatMap((item, index) => {
      const name = readText(item.name);
      const amount = readAmount(item.amount);
      if (!name || amount == null) return [];
      const assigned = Array.isArray(item.participantIds)
        ? item.participantIds.filter((id): id is string => typeof id === 'string' && participantIds.has(id)).slice(0, MAX_PARTICIPANTS)
        : [];
      return [{ id: normalizeId(item.id, `item_${index + 1}`), name, quantity: readQuantity(item.quantity), amount, participantIds: [...new Set(assigned)] }];
    })
    : [];
  if (items.length === 0) return null;

  const rawCharges = isRecord(value.charges) ? value.charges : {};
  const payerId = typeof value.payerId === 'string' && participantIds.has(value.payerId) ? value.payerId : undefined;
  return {
    type: 'split_bill',
    title,
    merchant: readText(value.merchant),
    date: readText(value.date, '', 40),
    currency: 'IDR',
    participants: uniqueParticipants,
    items,
    charges: {
      tax: readAmount(rawCharges.tax) ?? 0,
      service: readAmount(rawCharges.service) ?? 0,
      discount: readAmount(rawCharges.discount) ?? 0,
      tip: readAmount(rawCharges.tip) ?? 0,
      taxRule: readRule(rawCharges.taxRule),
      serviceRule: readRule(rawCharges.serviceRule),
      discountRule: readRule(rawCharges.discountRule),
      tipRule: readRule(rawCharges.tipRule),
    },
    ...(payerId ? { payerId } : {}),
    ...(readText(value.note, '', 500) ? { note: readText(value.note, '', 500) } : {}),
  };
}

function allocateInteger(total: number, ids: string[], weights: Record<string, number>): Record<string, number> {
  const allocated = Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
  if (total === 0 || ids.length === 0) return allocated;
  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const totalWeight = ids.reduce((sum, id) => sum + Math.max(0, weights[id] ?? 0), 0);
  const effectiveWeights = totalWeight > 0 ? weights : Object.fromEntries(ids.map((id) => [id, 1]));
  const effectiveTotal = totalWeight > 0 ? totalWeight : ids.length;
  const rows = ids.map((id, index) => {
    const exact = absolute * Math.max(0, effectiveWeights[id] ?? 0) / effectiveTotal;
    return { id, index, amount: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = absolute - rows.reduce((sum, row) => sum + row.amount, 0);
  rows.sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const row of rows) {
    if (remainder <= 0) break;
    row.amount += 1;
    remainder -= 1;
  }
  for (const row of rows) allocated[row.id] = row.amount * sign;
  return allocated;
}

function chargeRuleKey(key: ChargeKey): ChargeRuleKey {
  return `${key}Rule` as ChargeRuleKey;
}

function chargeRuleLabel(rule: SplitChargeRule): string {
  if (rule === 'equal') return 'Equal Split';
  if (rule === 'payer') return 'Paid by Payer';
  return 'Proportional';
}

function isDefaultPaymentAccount(account: SplitBillAccount) {
  const label = `${account.name} ${account.provider ?? ''}`.trim().toLowerCase();
  return /(^|[\s_-])bni($|[\s_-])/.test(label) || (/(^|[\s_-])gopay($|[\s_-])/.test(label) && !label.includes('gopaylater'));
}

async function writeClipboardText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* Use the legacy fallback below when clipboard permissions are unavailable. */ }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard access was denied');
}

const UNSUPPORTED_EXPORT_COLOR = /oklab|oklch|color\(/i;

function safeExportValue(value: string, fallback: string) {
  return UNSUPPORTED_EXPORT_COLOR.test(value) ? fallback : value;
}

function sanitizeExportColors(source: HTMLElement, clone: HTMLElement) {
  const sources = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
  const clones = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  const properties: Array<[string, string]> = [
    ['color', '#191b23'],
    ['background-color', 'transparent'],
    ['border-top-color', '#e1e2ec'],
    ['border-right-color', '#e1e2ec'],
    ['border-bottom-color', '#e1e2ec'],
    ['border-left-color', '#e1e2ec'],
    ['outline-color', '#0040a1'],
    ['text-decoration-color', '#191b23'],
    ['fill', '#0040a1'],
    ['stroke', '#0040a1'],
    ['box-shadow', 'none'],
    ['background-image', 'none'],
  ];
  sources.forEach((element, index) => {
    const target = clones[index];
    if (!target) return;
    const style = getComputedStyle(element);
    properties.forEach(([property, fallback]) => target.style.setProperty(property, safeExportValue(style.getPropertyValue(property), fallback)));
    if (element.classList.contains('bg-[var(--ref-primary)]/10')) {
      target.style.setProperty('background-color', '#e8eeff', 'important');
    }
  });
}

function sanitizeExportLayout(source: HTMLElement, clone: HTMLElement) {
  // Give the saved card a little more breathing room than the inline chat
  // card, without widening the content column or changing its line wraps.
  const sourceStyle = getComputedStyle(source);
  const sourceContentWidth = source.clientWidth - parseFloat(sourceStyle.paddingLeft) - parseFloat(sourceStyle.paddingRight);
  clone.style.boxSizing = 'content-box';
  clone.style.width = `${Math.max(0, sourceContentWidth)}px`;
  clone.style.maxWidth = 'none';
  clone.style.padding = '36px';

  // Hover-only edit affordances belong to the app UI, not the saved receipt.
  clone.querySelectorAll<SVGElement>('svg.h-3.w-3.opacity-0').forEach((icon) => icon.remove());

  clone.querySelectorAll<HTMLElement>('.truncate').forEach((element) => {
    // html2canvas can clip the line box when overflow/ellipsis is combined
    // with a flex row. The export keeps the same width but lets the text lay
    // out normally so the rasterized card remains readable.
    element.style.overflow = 'visible';
    element.style.textOverflow = 'clip';
    element.style.whiteSpace = 'normal';
    element.style.height = 'auto';
  });

  // html2canvas uses slightly different inline/flex font metrics from the
  // browser. Give the small pills their own stable line box in the cloned DOM
  // so their background stays centred on the label.
  const sourcePills = source.querySelectorAll<HTMLElement>('[data-export-pill]');
  clone.querySelectorAll<HTMLElement>('[data-export-pill]').forEach((element, index) => {
    const isPayer = element.dataset.exportPill === 'payer';
    const sourceBox = sourcePills[index]?.getBoundingClientRect();
    element.style.display = 'inline-flex';
    element.style.alignItems = 'center';
    element.style.boxSizing = 'border-box';
    // Copy the live dimensions instead of guessing at Tailwind's `normal`
    // line-height. This is what keeps the coloured outline identical.
    if (sourceBox) {
      element.style.width = `${sourceBox.width}px`;
      element.style.height = `${sourceBox.height}px`;
      element.style.minHeight = `${sourceBox.height}px`;
    }
    element.style.padding = isPayer ? '0 6px' : '0 8px';
    element.style.position = 'relative';
    element.style.top = `${isPayer ? PNG_LAYOUT_VERTICAL_OFFSETS.payerPill : PNG_LAYOUT_VERTICAL_OFFSETS.paidByPill}px`;
    element.style.lineHeight = '1.0';
    element.style.verticalAlign = 'middle';
    element.style.backgroundColor = '#e8eeff';
  });
  const nudgeExportText = (selector: string, offset: number) => {
    clone.querySelectorAll<HTMLElement>(selector).forEach((label) => {
      // Keep the surrounding layout in place and nudge only this text.
      label.style.position = 'relative';
      label.style.top = `${offset}px`;
    });
  };
  nudgeExportText('[data-export-pill-label="paid-by"]', PNG_TEXT_VERTICAL_OFFSETS.paidByPill);
  nudgeExportText('[data-export-pill-label="payer"]', PNG_TEXT_VERTICAL_OFFSETS.payerPill);

  // The large tabular number sits in an items-end flex row. html2canvas can
  // place its glyphs a few pixels low even when the row itself is correct.
  // A fixed line box keeps it aligned with the browser-rendered card.
  const sourceTotalAmount = source.querySelector<HTMLElement>('[data-export-total-amount]');
  const totalAmount = clone.querySelector<HTMLElement>('[data-export-total-amount]');
  const sourceTotalBox = sourceTotalAmount?.getBoundingClientRect();
  if (totalAmount && sourceTotalBox) {
    totalAmount.style.boxSizing = 'border-box';
    totalAmount.style.width = `${sourceTotalBox.width}px`;
    totalAmount.style.height = `${sourceTotalBox.height}px`;
    totalAmount.style.minHeight = `${sourceTotalBox.height}px`;
    totalAmount.style.lineHeight = `${sourceTotalBox.height}px`;
    totalAmount.style.position = 'relative';
  }
  nudgeExportText('[data-export-total-label]', PNG_TEXT_VERTICAL_OFFSETS.totalLabel);
  nudgeExportText('[data-export-total-amount]', PNG_TEXT_VERTICAL_OFFSETS.totalAmount);
  nudgeExportText('[data-export-total-items]', PNG_TEXT_VERTICAL_OFFSETS.totalItems);
  nudgeExportText('[data-export-split-bill-label]', PNG_TEXT_VERTICAL_OFFSETS.splitBillLabel);
  const splitBillIcon = clone.querySelector<SVGElement>('[data-export-split-bill-icon]');
  if (splitBillIcon) {
    splitBillIcon.style.position = 'relative';
    splitBillIcon.style.top = `${PNG_LAYOUT_VERTICAL_OFFSETS.splitBillIcon}px`;
  }

  const replaceExportDividers = (kind: 'items' | 'shares', offset: number) => {
    clone.querySelectorAll<HTMLElement>(`[data-export-divider-list="${kind}"]`).forEach((list) => {
      const rows = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      rows.forEach((row, index) => {
        row.style.borderBottomWidth = '0';
        if (index === rows.length - 1) return;
        const divider = clone.ownerDocument.createElement('span');
        divider.setAttribute('aria-hidden', 'true');
        divider.style.position = 'absolute';
        divider.style.left = '0';
        divider.style.right = '0';
        divider.style.bottom = '0';
        divider.style.height = '1px';
        divider.style.backgroundColor = '#e1e2ec';
        divider.style.transform = `translateY(${offset}px)`;
        row.style.position = 'relative';
        row.appendChild(divider);
      });
    });
  };
  replaceExportDividers('items', PNG_LAYOUT_VERTICAL_OFFSETS.itemDivider);
  replaceExportDividers('shares', PNG_LAYOUT_VERTICAL_OFFSETS.shareDivider);
}

async function downloadCardAsPng(element: HTMLElement) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = await html2canvas(element, {
    backgroundColor: '#faf8ff',
    scale: 3,
    useCORS: true,
    allowTaint: false,
    logging: false,
    ignoreElements: (node) => node instanceof HTMLImageElement && new URL(node.currentSrc || node.src, window.location.href).origin !== window.location.origin,
    onclone: (document) => {
      const clone = document.querySelector<HTMLElement>('[data-split-bill-export="true"]');
      if (clone) {
        sanitizeExportColors(element, clone);
        sanitizeExportLayout(element, clone);
        clone.querySelectorAll<HTMLElement>('[data-export-hide="true"]').forEach((control) => control.remove());
      }
    },
  });
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the card image')), 'image/png'));
  const pngUrl = URL.createObjectURL(png);
  const link = document.createElement('a');
  link.href = pngUrl;
  link.download = `split-bill-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(pngUrl);
}

export function SplitBillCard({ visualization, accounts = [] }: { visualization: SplitBillVisualization; accounts?: SplitBillAccount[] }) {
  const [title, setTitle] = useState(visualization.title);
  const [merchant, setMerchant] = useState(visualization.merchant ?? '');
  const [date, setDate] = useState(visualization.date ?? '');
  const [participants, setParticipants] = useState<DraftParticipant[]>(visualization.participants);
  const [items, setItems] = useState<DraftItem[]>(visualization.items);
  const [charges, setCharges] = useState<ChargeState>(visualization.charges);
  const [payerId, setPayerId] = useState(visualization.payerId ?? '');
  const [note, setNote] = useState(visualization.note ?? '');
  const [editingSection, setEditingSection] = useState<'charges' | 'shares' | 'note' | null>(null);
  const [activeHeaderField, setActiveHeaderField] = useState<'merchant' | 'date' | 'payer' | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [paymentAccountIds, setPaymentAccountIds] = useState<string[]>([]);
  const [isPaymentPickerOpen, setIsPaymentPickerOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<'charges' | 'shares' | 'payment' | 'item' | null>(null);
  const [mobileItemId, setMobileItemId] = useState<string | null>(null);
  const initializedPaymentAccounts = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const selectablePaymentAccounts = accounts.filter((account) => Boolean(account.accountNumber?.trim()));
  const isChargesEditing = editingSection === 'charges';
  const isSharesEditing = editingSection === 'shares';
  const isNoteEditing = editingSection === 'note';

  useEffect(() => {
    if (initializedPaymentAccounts.current || selectablePaymentAccounts.length === 0) return;
    const defaults = selectablePaymentAccounts
      .filter(isDefaultPaymentAccount)
      .map((account) => String(account.id));
    setPaymentAccountIds(defaults);
    initializedPaymentAccounts.current = true;
  }, [selectablePaymentAccounts]);

  const calculation = useMemo(() => {
    const participantIds = participants.map((person) => person.id);
    const subtotals = Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>;
    let unassignedItems = 0;
    for (const item of items) {
      const assigned = item.participantIds.filter((id) => participantIds.includes(id));
      if (assigned.length === 0) {
        unassignedItems += item.amount;
        continue;
      }
      const allocation = allocateInteger(item.amount, assigned, Object.fromEntries(assigned.map((id) => [id, 1])));
      for (const id of assigned) subtotals[id] += allocation[id] ?? 0;
    }
    const eligible = participantIds.filter((id) => subtotals[id] > 0);
    const allocateCharge = (amount: number, rule: SplitChargeRule) => {
      if (amount === 0) return Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>;
      if (rule === 'payer') return payerId && participantIds.includes(payerId)
        ? allocateInteger(amount, [payerId], { [payerId]: 1 })
        : Object.fromEntries(participantIds.map((id) => [id, 0])) as Record<string, number>;
      return allocateInteger(amount, eligible, rule === 'equal' ? Object.fromEntries(eligible.map((id) => [id, 1])) : subtotals);
    };
    const tax = allocateCharge(charges.tax, charges.taxRule);
    const service = allocateCharge(charges.service, charges.serviceRule);
    const discount = allocateCharge(-charges.discount, charges.discountRule);
    const tip = allocateCharge(charges.tip, charges.tipRule);
    const totals = Object.fromEntries(participantIds.map((id) => [id, (subtotals[id] ?? 0) + (tax[id] ?? 0) + (service[id] ?? 0) + (discount[id] ?? 0) + (tip[id] ?? 0)])) as Record<string, number>;
    const itemSubtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const total = itemSubtotal + charges.tax + charges.service + charges.tip - charges.discount;
    const allocated = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const chargeNeedsPayer = [charges.taxRule, charges.serviceRule, charges.discountRule, charges.tipRule].includes('payer') && !payerId;
    return { subtotals, tax, service, discount, tip, totals, itemSubtotal, total, allocated, unassignedItems, chargeNeedsPayer };
  }, [charges, items, participants, payerId]);

  const payer = participants.find((person) => person.id === payerId);
  const settlement = participants.filter((person) => person.id !== payerId && calculation.totals[person.id] > 0);
  const calculatedNote = note.trim() || (payer
    ? settlement.length === 0
      ? `${payer.name} paid ${formatCurrency(calculation.total)}. Everyone’s share is settled in this calculation.`
      : settlement.map((person) => `${person.name} owes ${payer.name} ${formatCurrency(calculation.totals[person.id])}.`).join(' ')
    : 'Calculation only — choose who paid to show who owes whom.');

  const updateCharge = (key: ChargeKey, value: number) => setCharges((current) => ({ ...current, [key]: Number.isSafeInteger(value) && value >= 0 ? value : 0 }));
  const updateRule = (key: ChargeKey, value: SplitChargeRule) => setCharges((current) => ({ ...current, [chargeRuleKey(key)]: value }));
  const addParticipant = () => {
    if (participants.length >= MAX_PARTICIPANTS) return;
    const id = `guest_${Date.now()}`;
    setParticipants((current) => [...current, { id, name: `Guest ${current.length}` }]);
  };
  const removeParticipant = (id: string) => {
    if (id === 'me') return;
    setParticipants((current) => current.filter((person) => person.id !== id));
    setItems((current) => current.map((item) => ({ ...item, participantIds: item.participantIds.filter((participantId) => participantId !== id) })));
    if (payerId === id) setPayerId('');
  };
  const addItem = () => {
    if (items.length >= MAX_ITEMS) return;
    const id = `item_${Date.now()}`;
    setItems((current) => [...current, { id, name: 'New item', quantity: 1, amount: 0, participantIds: [] }]);
    if (window.matchMedia('(max-width: 639px)').matches) {
      setMobileItemId(id);
      setMobileSheet('item');
    } else {
      setEditingItemId(id);
    }
  };
  const selectedPaymentAccounts = selectablePaymentAccounts.filter((account) => paymentAccountIds.includes(String(account.id)));
  const mobileItem = mobileItemId ? items.find((item) => item.id === mobileItemId) ?? null : null;
  const copyNote = async () => {
    try {
      await writeClipboardText(calculatedNote);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* Clipboard availability is browser-dependent. */ }
  };
  const copySummary = async () => {
    const chargeLines = ([['Tax', charges.tax, charges.taxRule], ['Service', charges.service, charges.serviceRule], ['Discount', charges.discount, charges.discountRule], ['Tip', charges.tip, charges.tipRule]] as Array<[string, number, SplitChargeRule]>)
      .filter(([, amount]) => amount > 0)
      .map(([label, amount, rule]) => `${label} ${label === 'Discount' ? '−' : ''}${formatCurrency(amount)} (${chargeRuleLabel(rule)})`);
    const itemLines = items.map((item) => {
      const people = item.participantIds.map((id) => participants.find((person) => person.id === id)?.name ?? id).join(', ') || 'Needs assignment';
      return `- ${item.name}: ${item.quantity} pcs · ${formatCurrency(Math.round(item.amount / item.quantity))} each · ${formatCurrency(item.amount)} (${people})`;
    });
    const shareLines = participants.map((person) => `- ${person.name}${person.id === payerId ? ' (Payer)' : ''}: Items ${formatCurrency(calculation.subtotals[person.id] ?? 0)} · Tax ${formatCurrency(calculation.tax[person.id] ?? 0)} · Service ${formatCurrency(calculation.service[person.id] ?? 0)} · Total ${formatCurrency(calculation.totals[person.id] ?? 0)}`);
    const paymentLines = payerId === 'me' && selectedPaymentAccounts.length > 0
      ? ['', 'Payment details', ...selectedPaymentAccounts.map((account) => `- ${account.name}${account.provider ? ` · ${account.provider}` : ''}: ${account.accountNumber}`)]
      : [];
    const summary = [
      `Split bill: ${merchant || title}`,
      date ? `Date: ${date}` : '',
      payer ? `Paid by: ${payer.name}` : '',
      '',
      `Total: ${formatCurrency(calculation.total)}`,
      `Items: ${formatCurrency(calculation.itemSubtotal)}`,
      '',
      'Charges',
      ...(chargeLines.length > 0 ? chargeLines : ['- No charges']),
      '',
      'Items',
      ...itemLines,
      '',
      'Shares',
      ...shareLines,
      ...paymentLines,
      '',
      `Note: ${calculatedNote}`,
    ].filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== '' && index < lines.length - 1 && lines[index + 1] !== ''))
      .join('\n');
    try {
      await writeClipboardText(summary);
      setCopiedSummary(true);
      window.setTimeout(() => setCopiedSummary(false), 1800);
    } catch { /* Clipboard availability is browser-dependent. */ }
  };

  const saveImage = async () => {
    if (!cardRef.current) return;
    setIsSavingImage(true);
    setExportNotice(null);
    try {
      await downloadCardAsPng(cardRef.current);
    } catch (error) {
      setExportNotice(`PNG export failed: ${error instanceof Error ? error.message : 'Unknown browser error'}`);
    } finally {
      setIsSavingImage(false);
    }
  };
  return <><article ref={cardRef} data-split-bill-export="true" className="agent-viz-card mx-auto w-full max-w-xl" aria-label={title}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[var(--ref-primary)]"><ReceiptText data-export-split-bill-icon="true" className="h-4 w-4" /><span data-export-split-bill-label="true" className="text-xs font-bold uppercase tracking-wide">Split bill</span></div>
        {activeHeaderField === 'merchant' ? <input autoFocus aria-label="Merchant or bill title" value={merchant || title} onChange={(event) => { setMerchant(event.target.value.slice(0, 120)); if (!merchant) setTitle(event.target.value.slice(0, 120)); }} onBlur={() => setActiveHeaderField(null)} className="mt-1 w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 py-1 text-base font-bold text-[var(--color-text-primary)]" /> : <button type="button" onClick={() => setActiveHeaderField('merchant')} className="group mt-1 flex items-center rounded px-1 -ml-1 text-left text-base font-bold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]">{merchant || title}</button>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-[var(--color-text-secondary)]">{activeHeaderField === 'date' ? <input autoFocus aria-label="Bill date" value={date} onChange={(event) => setDate(event.target.value.slice(0, 40))} onBlur={() => setActiveHeaderField(null)} placeholder="YYYY-MM-DD" className="w-24 rounded bg-[var(--ref-surface-container-lowest)] px-1.5 py-0.5 text-xs outline-none ring-[var(--ref-primary)] focus:ring-1" /> : <button type="button" onClick={() => setActiveHeaderField('date')} className="rounded px-1 -ml-1 hover:bg-[var(--ref-surface-container-low)]">{date || 'Calculation only'}</button>}<span>· {participants.length} people · {items.length} item{items.length === 1 ? '' : 's'}</span></div>
        {activeHeaderField === 'payer' ? <select autoFocus aria-label="Who paid" value={payerId} onChange={(event) => setPayerId(event.target.value)} onBlur={() => setActiveHeaderField(null)} className="mt-2 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 py-1 text-[11px] font-semibold text-[var(--ref-primary)]"><option value="">Payer not set</option>{participants.map((person) => <option key={person.id} value={person.id}>Paid by {person.name}</option>)}</select> : payer ? <button type="button" onClick={() => setActiveHeaderField('payer')} data-export-pill="paid-by" className="mt-2 inline-flex items-center rounded-full bg-[var(--ref-primary)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--ref-primary)]"><span data-export-pill-label="paid-by">Paid by {payer.name}</span></button> : <button type="button" onClick={() => setActiveHeaderField('payer')} className="mt-2 rounded-full bg-[var(--ref-surface-container-low)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container)]">Set payer</button>}
      </div>
      <div data-export-hide="true" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void saveImage()} disabled={isSavingImage} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" />{isSavingImage ? 'Preparing…' : 'Save PNG'}</button>
        <button type="button" onClick={() => void copySummary()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)]">{copiedSummary ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}{copiedSummary ? 'Copied' : 'Copy summary'}</button>
      </div>
    </div>
    {exportNotice && <p role="status" className="mt-2 text-[11px] text-[var(--color-danger)]">{exportNotice}</p>}

    {mobileSheet && <div data-export-hide="true" className="fixed inset-0 z-50 flex items-end sm:hidden" role="dialog" aria-modal="true" aria-label="Edit split bill"><button type="button" aria-label="Close editor" onClick={() => { setMobileSheet(null); setMobileItemId(null); }} className="absolute inset-0 bg-black/45" /><div className="relative z-10 max-h-[86vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--color-background)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h4 className="text-base font-bold text-[var(--color-text-primary)]">{mobileSheet === 'charges' ? 'Edit charges' : mobileSheet === 'shares' ? 'Edit people' : mobileSheet === 'payment' ? 'Payment details' : 'Edit item'}</h4><button type="button" onClick={() => { setMobileSheet(null); setMobileItemId(null); }} className="rounded px-2 py-1 text-sm font-semibold text-[var(--ref-primary)]">Done</button></div>{mobileSheet === 'charges' && <div className="space-y-3">{(['tax', 'service', 'discount', 'tip'] as ChargeKey[]).map((key) => <div key={key} className="rounded-lg border border-[var(--color-border)] p-3"><label className="block text-xs font-semibold capitalize text-[var(--color-text-secondary)]">{key}<input type="number" min="0" step="1" value={charges[key]} onChange={(event) => updateCharge(key, Math.trunc(Number(event.target.value) || 0))} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-base tabular-nums text-[var(--color-text-primary)]" /></label><select value={charges[chargeRuleKey(key)]} onChange={(event) => updateRule(key, event.target.value as SplitChargeRule)} className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-sm text-[var(--color-text-primary)]"><option value="proportional">Proportional split</option><option value="equal">Equal split</option><option value="payer">Paid by payer</option></select></div>)}</div>}{mobileSheet === 'item' && mobileItem && <div className="space-y-3"><label className="block text-xs font-semibold text-[var(--color-text-secondary)]">Item name<input autoFocus value={mobileItem.name} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === mobileItem.id ? { ...candidate, name: event.target.value.slice(0, 120) } : candidate))} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-base font-semibold text-[var(--color-text-primary)]" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-[var(--color-text-secondary)]">Quantity<input type="number" min="1" max="999" value={mobileItem.quantity} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === mobileItem.id ? { ...candidate, quantity: Math.min(999, Math.max(1, Math.trunc(Number(event.target.value) || 1))) } : candidate))} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-base tabular-nums text-[var(--color-text-primary)]" /></label><label className="text-xs font-semibold text-[var(--color-text-secondary)]">Amount<input type="number" min="0" step="1" value={mobileItem.amount} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === mobileItem.id ? { ...candidate, amount: Math.max(0, Math.trunc(Number(event.target.value) || 0)) } : candidate))} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-base tabular-nums text-[var(--color-text-primary)]" /></label></div><div><p className="text-xs font-semibold text-[var(--color-text-secondary)]">Split with</p><div className="mt-2 flex flex-wrap gap-2">{participants.map((person) => { const selected = mobileItem.participantIds.includes(person.id); return <button key={person.id} type="button" onClick={() => setItems((current) => current.map((candidate) => candidate.id !== mobileItem.id ? candidate : { ...candidate, participantIds: selected ? candidate.participantIds.filter((id) => id !== person.id) : [...candidate.participantIds, person.id] }))} className={'rounded-full border px-3 py-1.5 text-sm font-semibold ' + (selected ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}>{person.name}</button>; })}</div></div><button type="button" onClick={() => { setItems((current) => current.filter((candidate) => candidate.id !== mobileItem.id)); setMobileSheet(null); setMobileItemId(null); }} className="w-full rounded-md border border-[var(--color-danger)]/30 px-3 py-2 text-sm font-semibold text-[var(--color-danger)]">Remove item</button></div>}{mobileSheet === 'shares' && <div className="space-y-3">{participants.map((person) => <div key={person.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] p-3"><input value={person.name} onChange={(event) => setParticipants((current) => current.map((candidate) => candidate.id === person.id ? { ...candidate, name: event.target.value.slice(0, 60) } : candidate))} className="min-w-0 flex-1 bg-transparent text-base font-semibold text-[var(--color-text-primary)] outline-none" /><button type="button" disabled={person.id === 'me'} onClick={() => removeParticipant(person.id)} className="rounded p-2 text-[var(--color-danger)] disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>)}<button type="button" onClick={addParticipant} disabled={participants.length >= MAX_PARTICIPANTS} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--ref-primary)]"><UserPlus className="h-4 w-4" />Add guest</button></div>}{mobileSheet === 'payment' && <div className="space-y-2">{selectablePaymentAccounts.length > 0 ? selectablePaymentAccounts.map((account) => <label key={account.id} className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-primary)]"><input type="checkbox" checked={paymentAccountIds.includes(String(account.id))} onChange={() => setPaymentAccountIds((current) => current.includes(String(account.id)) ? current.filter((id) => id !== String(account.id)) : [...current, String(account.id)])} className="mt-0.5" /><span><span className="block font-semibold">{account.name}{account.provider ? ` · ${account.provider}` : ''}</span><span className="mt-0.5 block tabular-nums text-[var(--color-text-secondary)]">{account.accountNumber}</span></span></label>) : <p className="text-sm text-[var(--color-text-secondary)]">Add an account number in Accounts first.</p>}</div>}</div></div>}

    <div className="mt-4 rounded-lg bg-[var(--ref-surface-container-low)] p-4">
      <p data-export-total-label="true" className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Total</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1"><p data-export-total-amount="true" className="text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">{formatCurrency(calculation.total)}</p><p data-export-total-items="true" className="pb-0.5 text-[11px] text-[var(--color-text-secondary)]">Items {formatCurrency(calculation.itemSubtotal)}</p></div>
    </div>

    <div className="mt-3 border-b border-[var(--color-border)] pb-3">
      <div className="flex items-center justify-between gap-3"><button type="button" onClick={() => setEditingSection(isChargesEditing ? null : 'charges')} className="group/charges hidden items-center gap-1 rounded px-1 -ml-1 text-xs font-bold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)] sm:inline-flex">Charges<Pencil className="h-3 w-3 text-[var(--color-text-secondary)] opacity-0 transition-opacity group-hover/charges:opacity-70" /></button><button type="button" onClick={() => setMobileSheet('charges')} className="inline-flex items-center gap-1 rounded px-1 -ml-1 text-xs font-bold text-[var(--color-text-primary)] sm:hidden">Charges<Pencil className="h-3 w-3 text-[var(--color-text-secondary)]" /></button>{isChargesEditing && <button type="button" onClick={() => setEditingSection(null)} className="hidden text-[11px] font-semibold text-[var(--ref-primary)] sm:block">Done</button>}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-[var(--color-text-secondary)]">{isChargesEditing ? (['tax', 'service', 'discount', 'tip'] as ChargeKey[]).map((key) => <label key={key} className="inline-flex items-center gap-1.5 capitalize"><span className="font-semibold text-[var(--color-text-primary)]">{key}</span><input aria-label={`${key} amount`} type="number" min="0" step="1" value={charges[key]} onChange={(event) => updateCharge(key, Math.trunc(Number(event.target.value) || 0))} className="w-20 rounded border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-1.5 py-1 text-[11px] tabular-nums text-[var(--color-text-primary)]" /><select aria-label={`${key} split rule`} value={charges[chargeRuleKey(key)]} onChange={(event) => updateRule(key, event.target.value as SplitChargeRule)} className="rounded border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-1.5 py-1 text-[11px] text-[var(--color-text-primary)]"><option value="proportional">Proportional</option><option value="equal">Equal</option><option value="payer">Payer</option></select></label>) : <>
        {([['Tax', charges.tax, charges.taxRule], ['Service', charges.service, charges.serviceRule], ['Discount', charges.discount, charges.discountRule], ['Tip', charges.tip, charges.tipRule]] as Array<[string, number, SplitChargeRule]>).filter(([, amount]) => amount > 0).map(([label, amount, rule]) => <span key={label}><span className="font-semibold text-[var(--color-text-primary)]">{label} {label === 'Discount' ? '−' : ''}{formatCurrency(amount)}</span> ({chargeRuleLabel(rule)})</span>)}
        {charges.tax === 0 && charges.service === 0 && charges.discount === 0 && charges.tip === 0 && <span>No charges</span>}
      </>}</div>
    </div>

    <div className="mt-4 border-b border-[var(--color-border)] pb-4">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-[var(--color-text-primary)]">Items</p><div className="flex items-center gap-2"><button type="button" onClick={addItem} disabled={items.length >= MAX_ITEMS} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ref-primary)] disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Add item</button><p className="text-[11px] text-[var(--color-text-secondary)]">{items.length} line{items.length === 1 ? '' : 's'}</p></div></div>
      <div data-export-divider-list="items" className="mt-2 divide-y divide-[var(--color-border)]/60">
        {items.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            {editingItemId === item.id ? <input autoFocus aria-label={`${item.name} name`} value={item.name} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, name: event.target.value.slice(0, 120) } : candidate))} className="w-full rounded bg-[var(--ref-surface-container-lowest)] px-1.5 py-0.5 text-sm font-semibold text-[var(--color-text-primary)] outline-none ring-[var(--ref-primary)] focus:ring-1" /> : <button type="button" onClick={() => { if (window.matchMedia('(max-width: 639px)').matches) { setMobileItemId(item.id); setMobileSheet('item'); } else setEditingItemId(item.id); }} className="group/item flex max-w-full items-center gap-1 rounded px-1 -ml-1 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]"><span className="truncate">{item.name}</span><Pencil className="hidden h-3 w-3 shrink-0 text-[var(--color-text-secondary)] opacity-0 transition-opacity group-hover/item:opacity-70 sm:block" /></button>}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-[var(--color-text-secondary)]">{editingItemId === item.id ? <><input aria-label={`${item.name} quantity`} type="number" min="1" max="999" step="1" value={item.quantity} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, quantity: Math.min(999, Math.max(1, Math.trunc(Number(event.target.value) || 1))) } : candidate))} className="w-12 rounded bg-[var(--ref-surface-container-lowest)] px-1 py-0.5 tabular-nums outline-none ring-[var(--ref-primary)] focus:ring-1" /><span>pcs · {formatCurrency(Math.round(item.amount / item.quantity))} each ·</span><div className="flex flex-wrap gap-1">{participants.map((person) => { const selected = item.participantIds.includes(person.id); return <button key={person.id} type="button" onClick={() => setItems((current) => current.map((candidate) => candidate.id !== item.id ? candidate : { ...candidate, participantIds: selected ? candidate.participantIds.filter((id) => id !== person.id) : [...candidate.participantIds, person.id] }))} className={'rounded-full px-1.5 py-0.5 text-[10px] font-semibold ' + (selected ? 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)]')}>{person.name}</button>; })}</div></> : <span>{item.quantity} pcs · {formatCurrency(Math.round(item.amount / item.quantity))} each · {item.participantIds.map((id) => participants.find((person) => person.id === id)?.name ?? id).join(', ') || 'Needs assignment'}</span>}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">{editingItemId === item.id ? <><input aria-label={`${item.name} amount`} type="number" min="0" step="1" value={item.amount} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, amount: Math.max(0, Math.trunc(Number(event.target.value) || 0)) } : candidate))} className="w-24 rounded bg-[var(--ref-surface-container-lowest)] px-1.5 py-0.5 text-right text-sm font-semibold tabular-nums text-[var(--color-text-primary)] outline-none ring-[var(--ref-primary)] focus:ring-1" /><button type="button" onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))} className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]" aria-label={'Remove ' + item.name}><Trash2 className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setEditingItemId(null)} className="text-[11px] font-semibold text-[var(--ref-primary)]">Done</button></> : <p className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">{formatCurrency(item.amount)}</p>}</div>
        </div>)}
      </div>
    </div>

    <div className="mt-4 border-b border-[var(--color-border)] pb-4">
      <div className="flex items-center justify-between gap-3"><button type="button" onClick={() => setEditingSection(isSharesEditing ? null : 'shares')} className="group/shares hidden items-center gap-1 rounded px-1 -ml-1 text-xs font-bold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)] sm:inline-flex">Shares<Pencil className="h-3 w-3 text-[var(--color-text-secondary)] opacity-0 transition-opacity group-hover/shares:opacity-70" /></button><button type="button" onClick={() => setMobileSheet('shares')} className="inline-flex items-center gap-1 rounded px-1 -ml-1 text-xs font-bold text-[var(--color-text-primary)] sm:hidden">Shares<Pencil className="h-3 w-3 text-[var(--color-text-secondary)]" /></button>{isSharesEditing ? <div className="hidden items-center gap-2 sm:flex"><button type="button" onClick={addParticipant} disabled={participants.length >= MAX_PARTICIPANTS} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ref-primary)] disabled:opacity-50"><UserPlus className="h-3.5 w-3.5" />Add guest</button><button type="button" onClick={() => setEditingSection(null)} className="text-[11px] font-semibold text-[var(--ref-primary)]">Done</button></div> : null}</div>
      <div data-export-divider-list="shares" className="mt-2 divide-y divide-[var(--color-border)]/60">
      {participants.map((person) => <div key={person.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
        <div className="min-w-0 flex-1">{isSharesEditing ? <div className="flex items-center gap-2"><input value={person.name} onChange={(event) => setParticipants((current) => current.map((candidate) => candidate.id === person.id ? { ...candidate, name: event.target.value.slice(0, 60) } : candidate))} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm font-semibold text-[var(--color-text-primary)]" aria-label={'Name for ' + person.name} /><button type="button" onClick={() => removeParticipant(person.id)} disabled={person.id === 'me'} className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] disabled:opacity-30" aria-label={'Remove ' + person.name}><Trash2 className="h-3.5 w-3.5" /></button></div> : <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{person.name}</p>{person.id === payerId && <span data-export-pill="payer" className="shrink-0 rounded-full bg-[var(--ref-primary)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--ref-primary)]"><span data-export-pill-label="payer">Payer</span></span>}</div>}<p className="text-[11px] text-[var(--color-text-secondary)]">Items {formatCurrency(calculation.subtotals[person.id] ?? 0)} · Tax {formatCurrency(calculation.tax[person.id] ?? 0)} · Service {formatCurrency(calculation.service[person.id] ?? 0)}</p></div>
        <p className="shrink-0 text-base font-bold tabular-nums text-[var(--ref-primary)]">{formatCurrency(calculation.totals[person.id] ?? 0)}</p>
      </div>)}
      </div>
    </div>

    {payerId === 'me' && <div className="mt-4 border-b border-[var(--color-border)] pb-4"><div className="flex items-center justify-between gap-3"><button type="button" onClick={() => setIsPaymentPickerOpen(true)} className="group/payment hidden items-center gap-1 rounded px-1 -ml-1 text-xs font-bold text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)] sm:inline-flex">Payment details<Pencil className="h-3 w-3 text-[var(--color-text-secondary)] opacity-0 transition-opacity group-hover/payment:opacity-70" /></button><button type="button" onClick={() => setMobileSheet('payment')} className="inline-flex items-center gap-1 rounded px-1 -ml-1 text-xs font-bold text-[var(--color-text-primary)] sm:hidden">Payment details<Pencil className="h-3 w-3 text-[var(--color-text-secondary)]" /></button><p className="text-[11px] text-[var(--color-text-secondary)]">For repayment</p></div>{selectedPaymentAccounts.length > 0 ? <div className="mt-2 space-y-2">{selectedPaymentAccounts.map((account) => <div key={account.id} className="text-xs"><p className="font-semibold text-[var(--color-text-primary)]">{account.name}{account.provider ? ` · ${account.provider}` : ''}</p><p className="mt-0.5 tabular-nums text-[var(--color-text-secondary)]">{account.accountNumber}</p></div>)}</div> : <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Choose an account to show on the card.</p>}</div>}

    <div className="mt-4 flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-xs font-bold text-[var(--color-text-primary)]">Note</p>{isNoteEditing ? <textarea autoFocus value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} onBlur={() => setEditingSection(null)} placeholder="Optional note for your friend" rows={2} className="mt-1 w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm text-[var(--color-text-primary)]" /> : <button type="button" onClick={() => setEditingSection('note')} className="mt-1 rounded px-1 -ml-1 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)]">{calculatedNote}</button>}</div><button data-export-hide="true" type="button" onClick={() => void copyNote()} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10">{copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy note'}</button></div>
    {(calculation.unassignedItems > 0 || calculation.chargeNeedsPayer || calculation.allocated !== calculation.total) && <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-text-primary)]"><Calculator className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" /><span>{calculation.unassignedItems > 0 ? `${formatCurrency(calculation.unassignedItems)} of items still need a person. ` : ''}{calculation.chargeNeedsPayer ? 'Choose who paid to use a “paid by payer” charge rule. ' : ''}{calculation.allocated !== calculation.total ? `Assigned total is ${formatCurrency(calculation.allocated)}; bill total is ${formatCurrency(calculation.total)}.` : ''}</span></div>}
  </article><Modal isOpen={isPaymentPickerOpen} onClose={() => setIsPaymentPickerOpen(false)} title="Payment details" subtitle="Choose accounts to show for repayment" footer={<div className="flex justify-end"><button type="button" onClick={() => setIsPaymentPickerOpen(false)} className="rounded-md bg-[var(--ref-primary)] px-3 py-2 text-sm font-semibold text-white">Done</button></div>}><div className="space-y-2 p-4">{selectablePaymentAccounts.length > 0 ? selectablePaymentAccounts.map((account) => <label key={account.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-primary)]"><input type="checkbox" checked={paymentAccountIds.includes(String(account.id))} onChange={() => setPaymentAccountIds((current) => current.includes(String(account.id)) ? current.filter((id) => id !== String(account.id)) : [...current, String(account.id)])} className="mt-0.5" /><span><span className="block font-semibold">{account.name}{account.provider ? ` · ${account.provider}` : ''}</span><span className="mt-0.5 block tabular-nums text-[var(--color-text-secondary)]">{account.accountNumber}</span></span></label>) : <p className="text-sm text-[var(--color-text-secondary)]">Add an account number in Accounts first.</p>}</div></Modal></>;
}
