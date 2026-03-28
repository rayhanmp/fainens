import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';

interface NewContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (contactId: number) => void;
}

const RELATIONSHIP_TYPES = [
  { value: 'family', label: 'Family' },
  { value: 'friend', label: 'Friend' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'professional', label: 'Professional' },
  { value: 'others', label: 'Others' },
];

export function NewContactModal({ isOpen, onClose, onSuccess }: NewContactModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    fullName: '',
    email: '',
    phone: '',
    relationshipType: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const contact = await api.contacts.create({
        name: formData.name.trim(),
        fullName: formData.fullName.trim() || null,
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        relationshipType: formData.relationshipType || null,
        notes: formData.notes.trim() || null,
      });
      onSuccess(contact.id);
      setFormData({
        name: '',
        fullName: '',
        email: '',
        phone: '',
        relationshipType: '',
        notes: '',
      });
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to create contact');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Contact"
      size="default"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-[var(--ref-error-container)] text-[var(--ref-on-error-container)] rounded-lg text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
            Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--ref-surface-container-low)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:border-primary focus:outline-none"
            placeholder="Contact name"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
            Full Name
          </label>
          <input
            type="text"
            value={formData.fullName}
            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--ref-surface-container-low)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:border-primary focus:outline-none"
            placeholder="Full name (optional)"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--ref-surface-container-low)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:border-primary focus:outline-none"
              placeholder="Phone number"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Relationship
            </label>
            <select
              value={formData.relationshipType}
              onChange={(e) => setFormData({ ...formData, relationshipType: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--ref-surface-container-low)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:border-primary focus:outline-none"
            >
              <option value="">Select...</option>
              {RELATIONSHIP_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
            Email
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--ref-surface-container-low)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:border-primary focus:outline-none"
            placeholder="Email address"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--ref-surface-container-low)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:border-primary focus:outline-none resize-none"
            rows={2}
            placeholder="Additional notes..."
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !formData.name.trim()}
          >
            {isSubmitting ? 'Creating...' : 'Add Contact'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
