import { useState, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Upload, FileText, AlertCircle, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface ImportCSVModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface PreviewRow {
  rowNumber: number;
  date: string;
  description: string;
  amount: number;
  type: 'expense' | 'income';
  accountName: string;
  categoryName: string | null;
  periodName: string;
  notes: string | null;
  reference: string | null;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  accountMatched: boolean;
  categoryMatched: boolean;
  periodMatched: boolean;
  accountId: number | null;
  categoryId: number | null;
  periodId: number | null;
}

interface PreviewData {
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    totalIncome: number;
    totalExpense: number;
    uniqueAccounts: string[];
    uniqueCategories: string[];
    uniquePeriods: string[];
    missingAccounts: string[];
    missingCategories: string[];
    missingPeriods: string[];
  };
  existingCategories: Array<{ id: number; name: string }>;
  existingAccounts: Array<{ id: number; name: string }>;
  existingPeriods: Array<{ id: number; name: string }>;
}

export function ImportCSVModal({ isOpen, onClose, onSuccess }: ImportCSVModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [csvText, setCsvText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [editedRows, setEditedRows] = useState<PreviewRow[]>([]);
  const [categoryMappings, setCategoryMappings] = useState<Record<string, number | null>>({});
  const [accountMappings, setAccountMappings] = useState<Record<string, number | null>>({});
  const [periodMappings, setPeriodMappings] = useState<Record<string, number | null>>({});
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setCsvText(event.target?.result as string);
        };
        reader.readAsText(file);
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvText(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  }, []);

  const handlePreview = async () => {
    if (!csvText.trim()) return;
    
    setIsLoading(true);
    try {
      const data = await api.transactions.importPreview(csvText);
      setPreviewData(data);
      setEditedRows(data.rows);
      
      // Initialize mappings
      const catMappings: Record<string, number | null> = {};
      const acctMappings: Record<string, number | null> = {};
      const perMappings: Record<string, number | null> = {};
      
      data.rows.forEach(row => {
        if (row.categoryName && !catMappings[row.categoryName]) {
          catMappings[row.categoryName] = row.categoryId;
        }
        if (!acctMappings[row.accountName]) {
          acctMappings[row.accountName] = row.accountId;
        }
        if (row.periodName && !perMappings[row.periodName]) {
          perMappings[row.periodName] = row.periodId;
        }
      });
      
      setCategoryMappings(catMappings);
      setAccountMappings(acctMappings);
      setPeriodMappings(perMappings);
      setStep('preview');
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRowEdit = (index: number, field: keyof PreviewRow, value: any) => {
    setEditedRows(prev => {
      const newRows = [...prev];
      newRows[index] = { ...newRows[index], [field]: value };
      return newRows;
    });
  };

  const handleCategoryMapping = (categoryName: string, categoryId: number | null) => {
    setCategoryMappings(prev => ({
      ...prev,
      [categoryName]: categoryId
    }));
    
    // Update all rows with this category
    setEditedRows(prev => prev.map(row => {
      if (row.categoryName === categoryName) {
        return { ...row, categoryId, categoryMatched: !!categoryId };
      }
      return row;
    }));
  };

  const handleAccountMapping = (accountName: string, accountId: number | null) => {
    setAccountMappings(prev => ({
      ...prev,
      [accountName]: accountId
    }));
    
    // Update all rows with this account
    setEditedRows(prev => prev.map(row => {
      if (row.accountName === accountName) {
        return { ...row, accountId, accountMatched: !!accountId };
      }
      return row;
    }));
  };

  const handlePeriodMapping = (periodName: string, periodId: number | null) => {
    setPeriodMappings(prev => ({
      ...prev,
      [periodName]: periodId
    }));
    
    // Update all rows with this period
    setEditedRows(prev => prev.map(row => {
      if (row.periodName === periodName) {
        return { ...row, periodId, periodMatched: !!periodId };
      }
      return row;
    }));
  };

  const handleImport = async () => {
    const validRows = editedRows.filter(row => row.isValid && row.accountId);
    
    if (validRows.length === 0) {
      alert('No valid transactions to import');
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.transactions.importConfirm({
        rows: validRows.map(row => ({
          date: row.date,
          description: row.description,
          amount: row.amount,
          type: row.type,
          accountId: row.accountId!,
          periodId: row.periodId,
          categoryId: row.categoryId,
          notes: row.notes,
          reference: row.reference
        })),
        categoryMappings,
        accountMappings,
        periodMappings
      });
      
      setImportResult(result);
      setStep('result');
      onSuccess();
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRowExpand = (rowNumber: number) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowNumber)) {
        newSet.delete(rowNumber);
      } else {
        newSet.add(rowNumber);
      }
      return newSet;
    });
  };

  const handleClose = () => {
    setStep('upload');
    setCsvText('');
    setPreviewData(null);
    setEditedRows([]);
    setCategoryMappings({});
    setAccountMappings({});
    setImportResult(null);
    setExpandedRows(new Set());
    onClose();
  };

  const getRowStatus = (row: PreviewRow) => {
    if (row.errors.length > 0) return 'error';
    if (row.warnings.length > 0) return 'warning';
    return 'success';
  };

  const renderUploadStep = () => (
    <div className="space-y-6">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          isDragging 
            ? 'border-[var(--color-accent)] bg-[var(--ref-primary-fixed)]/20' 
            : 'border-[var(--color-border)] bg-[var(--ref-surface-container-low)]'
        }`}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-[var(--color-muted)]" />
        <p className="text-[var(--color-text-primary)] font-medium mb-2">
          Drop your CSV file here
        </p>
        <p className="text-[var(--color-text-secondary)] text-sm mb-4">
          or click to browse
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
          id="csv-upload"
        />
        <label htmlFor="csv-upload">
          <Button variant="secondary" className="cursor-pointer">
            Choose File
          </Button>
        </label>
      </div>

      {csvText && (
        <div className="space-y-4">
          <div className="bg-[var(--ref-surface-container-low)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2 text-[var(--color-text-secondary)]">
              <FileText className="w-4 h-4" />
              <span className="text-sm font-medium">CSV Preview (first 5 lines)</span>
            </div>
            <pre className="text-xs text-[var(--color-text-primary)] overflow-x-auto whitespace-pre-wrap font-mono">
              {csvText.split('\n').slice(0, 5).join('\n')}
            </pre>
          </div>
          
          <div className="flex gap-3">
            <Button onClick={handlePreview} isLoading={isLoading} className="flex-1">
              Preview Import
            </Button>
            <Button variant="secondary" onClick={() => setCsvText('')}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="bg-[var(--ref-surface-container-low)] rounded-lg p-4">
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
          Expected CSV Format:
        </p>
        <code className="text-xs text-[var(--color-text-secondary)] block font-mono">
          Date,Amount,Description,Category,Account,Type,Notes,Reference,Period
        </code>
        <p className="text-xs text-[var(--color-text-secondary)] mt-2">
          Required: Date, Amount, Description, Type, Account<br />
          Optional: Period (auto-inferred from date if not provided)<br />
          Date format: DD/MM/YYYY | Amount format: Rp65,000 | Type: expense or income
        </p>
      </div>
    </div>
  );

  const renderPreviewStep = () => {
    if (!previewData) return null;

    const hasErrors = previewData.summary.errorRows > 0;
    const canImport = previewData.summary.validRows > 0;

    return (
      <div className="space-y-6 max-h-[70vh] overflow-hidden flex flex-col">
        {/* Summary Panel */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[var(--ref-surface-container-low)] rounded-lg p-3">
            <p className="text-xs text-[var(--color-text-secondary)]">Total Rows</p>
            <p className="text-xl font-bold text-[var(--color-text-primary)]">{previewData.summary.totalRows}</p>
          </div>
          <div className="bg-[var(--color-success)]/10 rounded-lg p-3">
            <p className="text-xs text-[var(--color-success)]">Ready</p>
            <p className="text-xl font-bold text-[var(--color-success)]">{previewData.summary.validRows}</p>
          </div>
          <div className="bg-[var(--color-warning)]/10 rounded-lg p-3">
            <p className="text-xs text-[var(--color-warning)]">Warnings</p>
            <p className="text-xl font-bold text-[var(--color-warning)]">{previewData.summary.warningRows}</p>
          </div>
          <div className="bg-[var(--color-danger)]/10 rounded-lg p-3">
            <p className="text-xs text-[var(--color-danger)]">Errors</p>
            <p className="text-xl font-bold text-[var(--color-danger)]">{previewData.summary.errorRows}</p>
          </div>
        </div>

        {/* Totals */}
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-[var(--color-text-secondary)]">Total Income:</span>
            <span className="ml-2 font-medium text-[var(--color-success)]">
              {formatCurrency(previewData.summary.totalIncome, 'Rp')}
            </span>
          </div>
          <div>
            <span className="text-[var(--color-text-secondary)]">Total Expense:</span>
            <span className="ml-2 font-medium text-[var(--color-danger)]">
              {formatCurrency(previewData.summary.totalExpense, 'Rp')}
            </span>
          </div>
        </div>

        {/* Missing Items */}
        {(previewData.summary.missingAccounts.length > 0 || previewData.summary.missingCategories.length > 0 || previewData.summary.missingPeriods.length > 0) && (
          <div className="bg-[var(--color-warning)]/10 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning)]" />
              <span className="font-medium text-[var(--color-warning)]">Missing Items</span>
            </div>
            
            {previewData.summary.missingAccounts.length > 0 && (
              <div className="mb-3">
                <p className="text-sm text-[var(--color-text-secondary)] mb-2">Accounts not found:</p>
                <div className="flex flex-wrap gap-2">
                  {previewData.summary.missingAccounts.map(account => (
                    <div key={account} className="flex items-center gap-2 bg-[var(--ref-surface-container)] rounded px-2 py-1">
                      <span className="text-sm">{account}</span>
                      <select
                        value={accountMappings[account] || ''}
                        onChange={(e) => handleAccountMapping(account, e.target.value ? parseInt(e.target.value) : null)}
                        className="text-xs border rounded px-1 py-0.5 bg-transparent"
                      >
                        <option value="">Select account...</option>
                        {previewData.existingAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {previewData.summary.missingCategories.length > 0 && (
              <div className="mb-3">
                <p className="text-sm text-[var(--color-text-secondary)] mb-2">Categories not found:</p>
                <div className="flex flex-wrap gap-2">
                  {previewData.summary.missingCategories.map(category => (
                    <div key={category} className="flex items-center gap-2 bg-[var(--ref-surface-container)] rounded px-2 py-1">
                      <span className="text-sm">{category}</span>
                      <select
                        value={categoryMappings[category] || ''}
                        onChange={(e) => handleCategoryMapping(category, e.target.value ? parseInt(e.target.value) : null)}
                        className="text-xs border rounded px-1 py-0.5 bg-transparent"
                      >
                        <option value="">Select category...</option>
                        {previewData.existingCategories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewData.summary.missingPeriods.length > 0 && (
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-2">Periods not found:</p>
                <div className="flex flex-wrap gap-2">
                  {previewData.summary.missingPeriods.map(period => (
                    <div key={period} className="flex items-center gap-2 bg-[var(--ref-surface-container)] rounded px-2 py-1">
                      <span className="text-sm">{period}</span>
                      <select
                        value={periodMappings[period] || ''}
                        onChange={(e) => handlePeriodMapping(period, e.target.value ? parseInt(e.target.value) : null)}
                        className="text-xs border rounded px-1 py-0.5 bg-transparent"
                      >
                        <option value="">Select period...</option>
                        {previewData.existingPeriods.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview Table */}
        <div className="flex-1 overflow-auto border border-[var(--color-border)] rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ref-surface-container-low)] sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">#</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">Date</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">Description</th>
                <th className="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]">Amount</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">Type</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">Account</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">Category</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">Period</th>
                <th className="px-3 py-2 text-center font-medium text-[var(--color-text-secondary)]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {editedRows.map((row, index) => {
                const status = getRowStatus(row);
                const isExpanded = expandedRows.has(row.rowNumber);
                
                return (
                  <>
                    <tr 
                      key={row.rowNumber}
                      className={`hover:bg-[var(--ref-surface-container-low)] cursor-pointer ${
                        status === 'error' ? 'bg-[var(--color-danger)]/5' :
                        status === 'warning' ? 'bg-[var(--color-warning)]/5' :
                        'bg-[var(--color-success)]/5'
                      }`}
                      onClick={() => toggleRowExpand(row.rowNumber)}
                    >
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.rowNumber}</td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={row.date ? new Date(row.date).toISOString().split('T')[0] : ''}
                          onChange={(e) => handleRowEdit(index, 'date', new Date(e.target.value).toISOString())}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-xs bg-transparent border border-[var(--color-border)] rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <input
                          type="text"
                          value={row.description}
                          onChange={(e) => handleRowEdit(index, 'description', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-xs bg-transparent border border-[var(--color-border)] rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCurrency(row.amount, 'Rp')}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.type}
                          onChange={(e) => handleRowEdit(index, 'type', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs bg-transparent border border-[var(--color-border)] rounded px-1 py-0.5"
                        >
                          <option value="expense">Expense</option>
                          <option value="income">Income</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.accountId || ''}
                          onChange={(e) => {
                            const accountId = e.target.value ? parseInt(e.target.value) : null;
                            handleRowEdit(index, 'accountId', accountId);
                            handleRowEdit(index, 'accountMatched', !!accountId);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs bg-transparent border border-[var(--color-border)] rounded px-1 py-0.5"
                        >
                          <option value="">Select...</option>
                          {previewData.existingAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.categoryId || ''}
                          onChange={(e) => {
                            const categoryId = e.target.value ? parseInt(e.target.value) : null;
                            handleRowEdit(index, 'categoryId', categoryId);
                            handleRowEdit(index, 'categoryMatched', !!categoryId);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs bg-transparent border border-[var(--color-border)] rounded px-1 py-0.5"
                        >
                          <option value="">None</option>
                          {previewData.existingCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.periodId || ''}
                          onChange={(e) => {
                            const periodId = e.target.value ? parseInt(e.target.value) : null;
                            handleRowEdit(index, 'periodId', periodId);
                            handleRowEdit(index, 'periodMatched', !!periodId);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs bg-transparent border border-[var(--color-border)] rounded px-1 py-0.5"
                        >
                          <option value="">Select...</option>
                          {previewData.existingPeriods.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {status === 'success' && <CheckCircle className="w-4 h-4 text-[var(--color-success)] mx-auto" />}
                        {status === 'warning' && <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] mx-auto" />}
                        {status === 'error' && <XCircle className="w-4 h-4 text-[var(--color-danger)] mx-auto" />}
                      </td>
                    </tr>
                    
                    {/* Expanded row with errors/warnings */}
                    {isExpanded && (row.errors.length > 0 || row.warnings.length > 0) && (
                      <tr className="bg-[var(--ref-surface-container-low)]">
                        <td colSpan={9} className="px-3 py-2">
                          {row.errors.length > 0 && (
                            <div className="mb-2">
                              {row.errors.map((error, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs text-[var(--color-danger)]">
                                  <XCircle className="w-3 h-3" />
                                  {error}
                                </div>
                              ))}
                            </div>
                          )}
                          {row.warnings.length > 0 && (
                            <div>
                              {row.warnings.map((warning, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs text-[var(--color-warning)]">
                                  <AlertTriangle className="w-3 h-3" />
                                  {warning}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-[var(--color-border)]">
          <Button 
            onClick={handleImport} 
            isLoading={isLoading}
            disabled={!canImport || hasErrors}
            className="flex-1"
          >
            Import {previewData.summary.validRows} Transaction{previewData.summary.validRows !== 1 ? 's' : ''}
          </Button>
          <Button variant="secondary" onClick={() => setStep('upload')}>
            Back
          </Button>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  const renderResultStep = () => {
    if (!importResult) return null;

    return (
      <div className="space-y-6 text-center">
        <div className="py-8">
          {importResult.errors.length === 0 ? (
            <>
              <CheckCircle className="w-16 h-16 text-[var(--color-success)] mx-auto mb-4" />
              <h3 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
                Import Successful!
              </h3>
              <p className="text-[var(--color-text-secondary)]">
                Successfully imported {importResult.imported} transaction{importResult.imported !== 1 ? 's' : ''}
              </p>
            </>
          ) : (
            <>
              <AlertCircle className="w-16 h-16 text-[var(--color-warning)] mx-auto mb-4" />
              <h3 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
                Import Partially Successful
              </h3>
              <p className="text-[var(--color-text-secondary)]">
                Imported {importResult.imported} of {importResult.imported + importResult.skipped} transactions
              </p>
            </>
          )}
        </div>

        {importResult.errors.length > 0 && (
          <div className="bg-[var(--color-danger)]/10 rounded-lg p-4 text-left">
            <p className="font-medium text-[var(--color-danger)] mb-2">Errors:</p>
            <ul className="space-y-1">
              {importResult.errors.map((error, i) => (
                <li key={i} className="text-sm text-[var(--color-danger)]">
                  Row {error.row}: {error.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button onClick={handleClose} className="w-full">
          Done
        </Button>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'upload' ? 'Import CSV' : step === 'preview' ? 'Preview Import' : 'Import Results'}
      size="xl"
    >
      {step === 'upload' && renderUploadStep()}
      {step === 'preview' && renderPreviewStep()}
      {step === 'result' && renderResultStep()}
    </Modal>
  );
}
