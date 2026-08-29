import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { simpleTransactionFormSchema, type SimpleFormValues } from './schemas';
import { createSimpleFormDefaults } from './modal-helpers';

type SimpleFormUpdate = SimpleFormValues | ((current: SimpleFormValues) => SimpleFormValues);

/**
 * Owns the server-facing simple transaction draft. The modal can keep map,
 * attachment, and animation state local while this controller guarantees that
 * conditional fields and validation share one recoverable form snapshot.
 */
export function useSimpleTransactionForm() {
  const methods = useForm<SimpleFormValues>({
    resolver: zodResolver(simpleTransactionFormSchema),
    defaultValues: createSimpleFormDefaults(),
    mode: 'onSubmit',
  });
  const values = methods.watch();
  const update = (nextOrUpdater: SimpleFormUpdate) => {
    const current = methods.getValues();
    const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
    (Object.keys(next) as Array<keyof SimpleFormValues>).forEach((field) => {
      methods.setValue(field, next[field], { shouldDirty: true, shouldValidate: false });
    });
  };
  return { methods, values, update };
}
