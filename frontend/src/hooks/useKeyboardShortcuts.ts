import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsOptions {
  onNewTransaction?: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  isModalOpen?: boolean;
}

export function useKeyboardShortcuts({
  onNewTransaction,
  searchInputRef,
  isModalOpen: isModalOpenProp = false,
}: KeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // A page-level instance of this hook handles the key first; the shell's instance then stands down.
      if (e.defaultPrevented) return;
      const isModalOpen = isModalOpenProp || document.querySelector('[aria-modal="true"]') != null;
      // Don't trigger shortcuts when typing in input fields (except for Escape)
      const target = e.target as HTMLElement;
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Ctrl/Cmd+Enter submits the top-most open dialog, never a form behind it.
      if (isModalOpen && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
        const dialog = dialogs[dialogs.length - 1];
        const submitButton = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button[type="submit"]') ?? [])
          .find((button) => !button.disabled && button.getClientRects().length > 0);
        if (submitButton) {
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
    [onNewTransaction, searchInputRef, isModalOpenProp]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
