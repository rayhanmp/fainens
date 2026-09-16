export type SavedSplitShare = {
  personId: number;
  personName: string;
  total: number;
  subtotal?: number;
  taxShare?: number;
  serviceShare?: number;
  discountShare?: number;
  assignedItems?: SavedSplitItem[];
};

export type SavedSplitItem = { name: string; quantity: number; totalPrice: number };

function savedItems(rows: unknown): SavedSplitItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is SavedSplitItem => row != null && typeof row === 'object'
    && typeof row.name === 'string' && typeof row.quantity === 'number' && Number.isFinite(row.quantity) && row.quantity > 0
    && Number.isSafeInteger(row.totalPrice) && row.totalPrice >= 0);
}

export function parseSavedSplitItems(json: string | null): SavedSplitItem[] {
  try { return savedItems(JSON.parse(json ?? 'null')); } catch { return []; }
}

export function parseSavedSplitShares(json: string | null): SavedSplitShare[] {
  try {
    const rows: unknown = JSON.parse(json ?? 'null');
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => row != null && typeof row === 'object'
      && Number.isSafeInteger(row.personId) && typeof row.personName === 'string'
      && Number.isSafeInteger(row.total) && row.total >= 0).map((row) => {
        const amount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
        return { personId: row.personId, personName: row.personName, total: row.total,
          subtotal: amount(row.subtotal), taxShare: amount(row.taxShare),
          serviceShare: amount(row.serviceShare), discountShare: amount(row.discountShare),
          assignedItems: savedItems(row.assignedItems),
        };
      });
  } catch { return []; }
}

export function splitBillOutstandingAmount(loans: readonly { status: string; remainingCents: number }[]) {
  return loans.filter((loan) => loan.status === 'active' || loan.status === 'defaulted')
    .reduce((sum, loan) => sum + loan.remainingCents, 0);
}

export function splitLoanStatusLabel(status: string) {
  switch (status) {
    case 'repaid': return 'Repaid';
    case 'cancelled': return 'Cancelled';
    case 'written_off': return 'Written off';
    case 'defaulted': return 'Defaulted';
    default: return 'Outstanding';
  }
}
