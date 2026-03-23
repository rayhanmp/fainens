import { describe, it, expect, vi } from 'vitest';
import { createJournalEntry } from './ledger';

describe('Ledger Service', () => {
  describe('createJournalEntry', () => {
    it('should reject unbalanced journal entries', async () => {
      const mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{ id: 1, type: 'asset' }]))
          }))
        })),
        transaction: vi.fn(async (fn) => {
          const txClient = {
            insert: vi.fn(() => ({
              values: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([{ id: 1 }]))
              }))
            })),
            select: vi.fn(() => ({
              from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([{ balance: 1000 }]))
              }))
            }))
          };
          try {
            return await fn(txClient);
          } catch (e) {
            throw e;
          }
        })
      };
      
      await expect(createJournalEntry({
        date: new Date(),
        description: 'Test unbalanced entry',
        lines: [
          { accountId: 1, debit: 1000, credit: 0, description: 'Test' },
          { accountId: 2, debit: 0, credit: 500, description: 'Test' }
        ]
      }, mockDb)).rejects.toThrow();
    });

    it('should validate line amounts are non-negative', async () => {
      const mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{ id: 1, type: 'asset' }]))
          }))
        })),
        transaction: vi.fn()
      };
      
      await expect(createJournalEntry({
        date: new Date(),
        description: 'Test negative amounts',
        lines: [
          { accountId: 1, debit: -100, credit: 0, description: 'Test' },
          { accountId: 2, debit: 0, credit: -100, description: 'Test' }
        ]
      }, mockDb)).rejects.toThrow();
    });

    it('should require at least two lines', async () => {
      const mockDb = {
        transaction: vi.fn()
      };
      
      await expect(createJournalEntry({
        date: new Date(),
        description: 'Test single line',
        lines: [
          { accountId: 1, debit: 1000, credit: 0, description: 'Test' }
        ]
      }, mockDb)).rejects.toThrow('At least two lines required');
    });
  });
});
