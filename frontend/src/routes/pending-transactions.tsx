import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { formatCurrency } from "../lib/utils";
import { ArrowLeft, Check, X, RefreshCw, Clock, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/pending-transactions")({
  component: PendingTransactionsPage,
});

interface ParsedData {
  type: string;
  amount: number;
  description: string;
  category: string;
  date?: string;
  place?: string;
  notes?: string;
  confidence: number;
}

interface PendingTransaction {
  id: number;
  rawMessage: string;
  parsedData: ParsedData;
  status: string;
  parseAttempts: number;
  lastError: string | null;
  createdAt: number;
}

function PendingTransactionsPage() {
  const navigate = useNavigate({ from: "/pending-transactions" });
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);

  useEffect(() => {
    loadPending();
  }, []);

  const loadPending = async () => {
    try {
      const data = await api.pendingTransactions.list();
      setPending(data);
    } catch (e) {
      console.error("Failed to load pending:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: number) => {
    setProcessing(id);
    try {
      await api.pendingTransactions.approve(id);
      await loadPending();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: number) => {
    if (!confirm("Reject this transaction?")) return;
    setProcessing(id);
    try {
      await api.pendingTransactions.reject(id);
      await loadPending();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reject");
    } finally {
      setProcessing(null);
    }
  };

  const handleRetry = async (id: number) => {
    setProcessing(id);
    try {
      await api.pendingTransactions.retry(id);
      await loadPending();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to retry");
    } finally {
      setProcessing(null);
    }
  };

  const formatDate = (ms: number) => {
    return new Date(ms).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "income":
        return "text-green-600 bg-green-50";
      case "transfer":
        return "text-blue-600 bg-blue-50";
      default:
        return "text-red-600 bg-red-50";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent)]"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          className="p-2 rounded-full hover:bg-[var(--ref-surface-container-low)] cursor-pointer"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="font-headline text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)]">
            Pending Transactions
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Transactions from WhatsApp waiting for approval
          </p>
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="h-12 w-12 mx-auto text-[var(--color-muted)] mb-4" />
          <p className="text-[var(--color-text-secondary)]">No pending transactions</p>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Send a message via WhatsApp to create a new pending transaction
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((tx) => (
            <div
              key={tx.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getTypeColor(
                        tx.parsedData.type
                      )}`}
                    >
                      {tx.parsedData.type}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {formatDate(tx.createdAt)}
                    </span>
                    {tx.parsedData.confidence < 0.5 && (
                      <span className="flex items-center gap-1 text-xs text-orange-600">
                        <AlertCircle className="h-3 w-3" />
                        Low confidence
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-[var(--color-text-secondary)] mb-2 line-clamp-2">
                    "{tx.rawMessage}"
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-[var(--color-muted)]">Amount</span>
                      <p className="font-bold text-[var(--color-text-primary)]">
                        {formatCurrency(tx.parsedData.amount)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-[var(--color-muted)]">Description</span>
                      <p className="font-medium text-[var(--color-text-primary)] truncate">
                        {tx.parsedData.description}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-[var(--color-muted)]">Category</span>
                      <p className="text-[var(--color-text-primary)]">
                        {tx.parsedData.category}
                      </p>
                    </div>
                    {tx.parsedData.date && (
                      <div>
                        <span className="text-xs text-[var(--color-muted)]">Date</span>
                        <p className="text-[var(--color-text-primary)]">
                          {tx.parsedData.date}
                        </p>
                      </div>
                    )}
                  </div>

                  {tx.parsedData.place && (
                    <p className="text-xs text-[var(--color-muted)] mt-2">
                      Place: {tx.parsedData.place}
                    </p>
                  )}
                </div>

                <div className="flex sm:flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={processing === tx.id}
                    onClick={() => handleApprove(tx.id)}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={processing === tx.id}
                    onClick={() => handleReject(tx.id)}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-600 text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </button>
                  {tx.lastError && (
                    <button
                      type="button"
                      disabled={processing === tx.id || tx.parseAttempts >= 3}
                      onClick={() => handleRetry(tx.id)}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] font-semibold text-sm hover:bg-[var(--ref-surface-container-low)] disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}