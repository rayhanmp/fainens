import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import transactionsRoute from './transactions';

// Mock dependencies
vi.mock('../db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  }
}));

vi.mock('../services/ledger', () => ({
  createJournalEntry: vi.fn(),
  createSimpleTransaction: vi.fn(),
}));

vi.mock('../services/audit', () => ({
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
  auditDelete: vi.fn(),
}));

vi.mock('../cache/invalidation', () => ({
  invalidateAndRecomputeOnTransactionMutation: vi.fn(),
}));

import { db } from '../db/client';

// Helper to create a fresh Fastify instance with the route registered
async function createTestServer() {
  const fastify = Fastify();
  fastify.decorate('authenticate', async () => {});
  await transactionsRoute(fastify);
  return fastify;
}

describe('Transactions Route - N+1 Query Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupTestTransactions(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      date: Date.now(),
      description: `Transaction ${i + 1}`,
      reference: null,
      notes: null,
      place: null,
      txType: 'expense',
      periodId: null,
      linkedTxId: null,
      categoryId: 1,
      installmentMonths: null,
      interestRatePercent: null,
      adminFeeCents: null,
      totalInstallments: null,
      originLat: null,
      originLng: null,
      originName: null,
      destLat: null,
      destLng: null,
      destName: null,
      distanceKm: null,
      createdAt: Date.now(),
    }));
  }

  describe('GET /api/transactions - Query Count Verification', () => {
    it('should use constant query count regardless of result size when filtering by accountId', async () => {
      const queryCounts: number[] = [];
      
      for (const txCount of [1, 5, 10]) {
        const fastify = await createTestServer();
        vi.clearAllMocks();
        
        let selectCount = 0;
        const mockTransactions = await setupTestTransactions(txCount);
        const mockLines = mockTransactions.map(tx => ({
          id: tx.id,
          transactionId: tx.id,
          accountId: 1,
          debit: 100,
          credit: 0,
          description: null,
        }));
        const mockTags: { transactionId: number; tagId: number; name: string; color: string }[] = [];

        // Track how many times select is called
        (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
          selectCount++;
          return {
            from: vi.fn((table: any) => {
              const tableName = typeof table === 'string' ? table : table?.name;
              
              // Return transactions for the main query
              if (tableName === 'transaction' || (tableName && tableName.includes('transaction'))) {
                return {
                  innerJoin: vi.fn(() => ({
                    where: vi.fn(() => ({
                      orderBy: vi.fn(() => ({
                        limit: vi.fn(() => ({
                          offset: vi.fn(() => Promise.resolve(mockTransactions))
                        }))
                      }))
                    }))
                  })),
                  where: vi.fn(() => ({
                    orderBy: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        offset: vi.fn(() => Promise.resolve(mockTransactions))
                      }))
                    }))
                  })),
                };
              }
              
              // Return lines for the lines query
              if (tableName?.includes('transaction_line')) {
                return {
                  where: vi.fn(() => Promise.resolve(mockLines)),
                };
              }
              
              // Return tags for the tags query
              if (tableName?.includes('tag') || tableName?.includes('transaction_tag')) {
                return {
                  where: vi.fn(() => Promise.resolve(mockTags)),
                  innerJoin: vi.fn(() => ({
                    where: vi.fn(() => Promise.resolve(mockTags))
                  })),
                };
              }
              
              return {
                where: vi.fn(() => Promise.resolve([])),
                innerJoin: vi.fn(() => ({
                  where: vi.fn(() => Promise.resolve([]))
                })),
              };
            }),
          };
        });

        await fastify.inject({
          method: 'GET',
          url: `/api/transactions?accountId=1&limit=${txCount}`,
        });

        queryCounts.push(selectCount);
        await fastify.close();
      }

      // All query counts should be the same (constant complexity)
      // If N+1 exists, query count would increase with result size
      const firstCount = queryCounts[0];
      expect(queryCounts.every(count => count === firstCount)).toBe(true);
    });

    it('should NOT use N+1 queries when filtering by tagId', async () => {
      const fastify = await createTestServer();
      const mockTransactions = await setupTestTransactions(5);
      const mockLines = mockTransactions.map(tx => ({
        id: tx.id,
        transactionId: tx.id,
        accountId: 1,
        debit: 100,
        credit: 0,
        description: null,
      }));
      const mockTags: { transactionId: number; tagId: number; name: string; color: string }[] = [];

      let selectCallCount = 0;
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++;
        return {
          from: vi.fn((table: any) => {
            const tableName = typeof table === 'string' ? table : table?.name;
            
            if (tableName === 'transaction' || (tableName && tableName.includes('transaction'))) {
              return {
                innerJoin: vi.fn(() => ({
                  where: vi.fn(() => ({
                    orderBy: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        offset: vi.fn(() => Promise.resolve(mockTransactions))
                      }))
                    }))
                  }))
                })),
                where: vi.fn(() => ({
                  orderBy: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      offset: vi.fn(() => Promise.resolve(mockTransactions))
                    }))
                  }))
                })),
              };
            }
            
            if (tableName?.includes('transaction_line')) {
              return {
                where: vi.fn(() => Promise.resolve(mockLines)),
              };
            }
            
            if (tableName?.includes('tag') || tableName?.includes('transaction_tag')) {
              return {
                where: vi.fn(() => Promise.resolve(mockTags)),
                innerJoin: vi.fn(() => ({
                  where: vi.fn(() => Promise.resolve(mockTags))
                })),
              };
            }
            
            return {
              where: vi.fn(() => Promise.resolve([])),
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([]))
              })),
            };
          }),
        };
      });

      await fastify.inject({
        method: 'GET',
        url: '/api/transactions?tagId=1&limit=5',
      });

      expect(selectCallCount).toBeLessThanOrEqual(3);
      await fastify.close();
    });

    it('should fetch transactions with lines and tags efficiently', async () => {
      const fastify = await createTestServer();
      const mockTransactions = await setupTestTransactions(3);
      const mockLines = mockTransactions.map(tx => ({
        id: tx.id,
        transactionId: tx.id,
        accountId: 1,
        debit: 100,
        credit: 0,
        description: null,
      }));
      const mockTags: { transactionId: number; tagId: number; name: string; color: string }[] = [];

      let transactionDetailsQueryCount = 0;
      
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return {
          from: vi.fn((table: any) => {
            const tableName = typeof table === 'string' ? table : table?.name;
            
            if (tableName === 'transaction' || (tableName && tableName.includes('transaction'))) {
              return {
                innerJoin: vi.fn(() => ({
                  where: vi.fn(() => ({
                    orderBy: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        offset: vi.fn(() => Promise.resolve(mockTransactions))
                      }))
                    }))
                  }))
                })),
                where: vi.fn(() => ({
                  orderBy: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      offset: vi.fn(() => Promise.resolve(mockTransactions))
                    }))
                  }))
                })),
              };
            }
            
            if (tableName?.includes('transaction_line')) {
              transactionDetailsQueryCount++;
              return {
                where: vi.fn(() => Promise.resolve(mockLines)),
              };
            }
            
            if (tableName?.includes('tag') || tableName?.includes('transaction_tag')) {
              return {
                where: vi.fn(() => Promise.resolve(mockTags)),
                innerJoin: vi.fn(() => ({
                  where: vi.fn(() => Promise.resolve(mockTags))
                })),
              };
            }
            
            return {
              where: vi.fn(() => Promise.resolve([])),
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([]))
              })),
            };
          }),
        };
      });

      await fastify.inject({
        method: 'GET',
        url: '/api/transactions?limit=3',
      });

      // Without N+1: should query lines and tags once for all transactions
      // With N+1: would query lines and tags for each transaction (3 times)
      expect(transactionDetailsQueryCount).toBeLessThanOrEqual(1);
      await fastify.close();
    });
  });


});
