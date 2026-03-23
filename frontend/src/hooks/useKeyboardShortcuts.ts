import { useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

interface KeyboardShortcutsOptions {
  onNewTransaction?: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  isModalOpen?: boolean;
}

export function useKeyboardShortcuts({
  onNewTransaction,
  searchInputRef,
  isModalOpen = false,
}: KeyboardShortcutsOptions) {
  const navigate = useNavigate();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields (except for Escape)
      const target = e.target as HTMLElement;
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Handle Ctrl+Enter for form submission (when in modal)
      if (isModalOpen && e.ctrlKey && e.key === 'Enter') {
        // Find the submit button and click it
        const submitButton = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (submitButton && !submitButton.disabled) {
          e.preventDefault();
          submitButton.click();
        }
        return;
      }

      // Don't trigger other shortcuts when in input fields
      if (isInputField) {
        return;
      }

      // Don't trigger shortcuts when modal is open (except Ctrl+Enter handled above)
      if (isModalOpen) {
        return;
      }

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          if (onNewTransaction) {
            onNewTransaction();
          }
          break;

        case '/':
          e.preventDefault();
          if (searchInputRef?.current) {
            searchInputRef.current.focus();
          } else {
            // Try to find a search input on the page
            const searchInput = document.querySelector('input[type="text"], input[type="search"]') as HTMLInputElement;
            if (searchInput) {
              searchInput.focus();
            }
          }
          break;

        case 'Escape':
          // Let the modal handle its own escape key
          break;
      }
    },
    [onNewTransaction, searchInputRef, isModalOpen, navigate]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
