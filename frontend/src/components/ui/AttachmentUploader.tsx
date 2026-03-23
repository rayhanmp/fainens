import { useState, useRef, useCallback } from 'react';
import { Paperclip, X, FileText, Image, File, Eye, Trash2, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatFileSize, cn } from '../../lib/utils';

interface Attachment {
  id: number;
  transactionId: number;
  filename: string;
  mimetype: string;
  fileSize: number;
}

interface PendingAttachment {
  id: string; // temporary ID
  file: File;
  filename: string;
  mimetype: string;
  fileSize: number;
  preview?: string; // base64 preview for images
}

interface AttachmentUploaderProps {
  transactionId?: number;
  attachments: Attachment[];
  pendingAttachments: PendingAttachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onPendingAttachmentsChange: (pending: PendingAttachment[]) => void;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function getFileIcon(mimetype: string) {
  if (mimetype.startsWith('image/')) return Image;
  if (mimetype === 'application/pdf') return FileText;
  return File;
}

// Generate unique ID for pending attachments
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function AttachmentUploader({
  transactionId,
  attachments,
  pendingAttachments,
  onAttachmentsChange,
  onPendingAttachmentsChange,
  disabled = false,
}: AttachmentUploaderProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<PendingAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const newPending: PendingAttachment[] = [];
    const errors: string[] = [];

    for (const file of files) {
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File size must be less than ${formatFileSize(MAX_FILE_SIZE)}`);
        continue;
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: File type not allowed`);
        continue;
      }

      // Create pending attachment
      const pending: PendingAttachment = {
        id: generateId(),
        file,
        filename: file.name,
        mimetype: file.type,
        fileSize: file.size,
      };

      // Generate preview for images
      if (file.type.startsWith('image/')) {
        try {
          const preview = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          pending.preview = preview;
        } catch {
          // Ignore preview errors
        }
      }

      newPending.push(pending);
    }

    if (errors.length > 0) {
      setUploadError(errors.join('\n'));
    } else {
      setUploadError(null);
    }

    if (newPending.length > 0) {
      onPendingAttachmentsChange([...pendingAttachments, ...newPending]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [pendingAttachments, onPendingAttachmentsChange]);

  const removePendingAttachment = useCallback((id: string) => {
    onPendingAttachmentsChange(pendingAttachments.filter(p => p.id !== id));
    if (previewFile?.id === id) {
      setPreviewFile(null);
    }
  }, [pendingAttachments, onPendingAttachmentsChange, previewFile]);

  const handleDeleteSaved = useCallback(async (attachmentId: number) => {
    setDeletingId(attachmentId);
    try {
      await api.attachments.delete(attachmentId);
      onAttachmentsChange(attachments.filter(a => a.id !== attachmentId));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to delete attachment');
    } finally {
      setDeletingId(null);
    }
  }, [attachments, onAttachmentsChange]);

  const handleDownload = useCallback(async (attachment: Attachment) => {
    try {
      const { url } = await api.attachments.getUrl(attachment.id, 3600);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to download file');
    }
  }, []);

  const FileIcon = getFileIcon;
  const totalAttachments = attachments.length + pendingAttachments.length;

  return (
    <div className="space-y-3">
      {/* Upload Area */}
      <div
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed border-[var(--color-border-strong)]/50 rounded-xl p-4',
          'flex flex-col items-center justify-center bg-[var(--ref-surface-container-lowest)]',
          'transition-colors cursor-pointer',
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-[var(--color-accent)]/50 hover:bg-[var(--ref-surface-container-low)]'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          disabled={disabled}
          className="hidden"
          accept={ALLOWED_TYPES.join(',')}
        />
        
        <Paperclip className="w-8 h-8 text-[var(--color-muted)] mb-2" />
        <span className="text-sm font-medium text-[var(--color-muted)]">
          Click or drop files to attach
        </span>
        <span className="text-xs text-[var(--color-muted)] mt-1">
          Max 10MB each. Images, PDF, Word, Excel
        </span>
      </div>

      {/* Error Message */}
      {uploadError && (
        <div className="flex items-start gap-2 text-sm text-[var(--color-danger)] bg-[var(--color-danger)]/10 rounded-lg px-3 py-2">
          <X className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1 whitespace-pre-line">{uploadError}</div>
          <button 
            onClick={() => setUploadError(null)}
            className="cursor-pointer text-[var(--color-danger)] hover:opacity-70 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Attachment List */}
      {totalAttachments > 0 && (
        <div className="space-y-2">
          {/* Saved Attachments */}
          {attachments.map((attachment) => {
            const Icon = FileIcon(attachment.mimetype);
            const isDeleting = deletingId === attachment.id;
            
            return (
              <div
                key={attachment.id}
                className="flex items-center gap-3 p-3 bg-[var(--ref-surface-container-low)] rounded-xl group"
              >
                <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-[var(--color-muted)]" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {attachment.filename}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {formatFileSize(attachment.fileSize)} • Saved
                  </p>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleDownload(attachment)}
                    disabled={isDeleting}
                    className={cn(
                      'cursor-pointer disabled:cursor-not-allowed h-8 w-8 rounded-lg flex items-center justify-center',
                      'text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--ref-surface-container-high)]',
                      'transition-colors disabled:opacity-50'
                    )}
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handleDeleteSaved(attachment.id)}
                    disabled={isDeleting}
                    className={cn(
                      'cursor-pointer disabled:cursor-not-allowed h-8 w-8 rounded-lg flex items-center justify-center',
                      'text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10',
                      'transition-colors disabled:opacity-50'
                    )}
                  >
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Pending Attachments */}
          {pendingAttachments.map((pending) => {
            const Icon = FileIcon(pending.mimetype);
            const isImage = pending.mimetype.startsWith('image/');
            
            return (
              <div
                key={pending.id}
                className="flex items-center gap-3 p-3 bg-[var(--ref-surface-container-low)]/50 border border-dashed border-[var(--color-border)] rounded-xl group"
              >
                {isImage && pending.preview ? (
                  <div 
                    className="w-10 h-10 rounded-lg overflow-hidden shrink-0 cursor-pointer"
                    onClick={() => setPreviewFile(pending)}
                  >
                    <img 
                      src={pending.preview} 
                      alt={pending.filename}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-[var(--ref-surface-container-high)] flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-[var(--color-muted)]" />
                  </div>
                )}
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {pending.filename}
                  </p>
                  <p className="text-xs text-[var(--color-accent)]">
                    {formatFileSize(pending.fileSize)} • Ready to upload
                  </p>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isImage && pending.preview && (
                    <button
                      type="button"
                      onClick={() => setPreviewFile(pending)}
                      className={cn(
                        'cursor-pointer h-8 w-8 rounded-lg flex items-center justify-center',
                        'text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--ref-surface-container-high)]',
                        'transition-colors'
                      )}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
                  
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(pending.id)}
                    className={cn(
                      'cursor-pointer h-8 w-8 rounded-lg flex items-center justify-center',
                      'text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10',
                      'transition-colors'
                    )}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image Preview Modal */}
      {previewFile && previewFile.preview && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div 
            className="bg-[var(--ref-surface-container-lowest)] rounded-xl overflow-hidden max-w-4xl max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
              <span className="font-medium truncate">{previewFile.filename}</span>
              <button 
                onClick={() => setPreviewFile(null)}
                className="cursor-pointer p-2 hover:bg-[var(--ref-surface-container-high)] rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-black">
              <img 
                src={previewFile.preview} 
                alt={previewFile.filename}
                className="max-w-full max-h-[70vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Utility function to upload all pending attachments
export async function uploadPendingAttachments(
  transactionId: number,
  pendingAttachments: PendingAttachment[]
): Promise<Attachment[]> {
  const uploaded: Attachment[] = [];
  
  for (const pending of pendingAttachments) {
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(pending.file);
    });

    const response = await api.attachments.upload({
      transactionId,
      filename: pending.filename,
      contentType: pending.mimetype,
      data: base64Data,
    });

    uploaded.push(response as Attachment);
  }
  
  return uploaded;
}

export type { PendingAttachment };
export default AttachmentUploader;
