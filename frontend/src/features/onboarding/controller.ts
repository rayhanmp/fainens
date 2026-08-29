import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { onboardingFormDefaults, onboardingFormSchema, type OnboardingFormValues } from './schemas';

/**
 * Owns all server-facing onboarding fields. Step navigation and request
 * pending state remain local to the route, while this controller keeps the
 * multi-step draft valid and recoverable as the user moves between steps.
 */
export function useOnboardingForm() {
  const methods = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingFormSchema),
    defaultValues: onboardingFormDefaults,
    mode: 'onSubmit',
  });
  const { control, getValues, setValue } = methods;
  const values = useWatch({ control }) as OnboardingFormValues;

  const setField = useCallback((field: keyof OnboardingFormValues, value: OnboardingFormValues[keyof OnboardingFormValues]) => {
    setValue(field as never, value as never, { shouldDirty: true, shouldValidate: false });
  }, [setValue]);

  const toggleWallet = useCallback((name: string) => {
    const selected = getValues('selectedWallets');
    setField('selectedWallets', selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]);
  }, [getValues, setField]);

  const addCustomWallet = useCallback(() => {
    const name = getValues('customWalletName').trim();
    if (!name) return;
    const selected = getValues('selectedWallets');
    if (!selected.includes(name)) setField('selectedWallets', [...selected, name]);
    setField('customWalletName', '');
  }, [getValues, setField]);

  const setBudget = useCallback((categoryId: number, value: string) => {
    setField('budgets', { ...getValues('budgets'), [categoryId]: value });
  }, [getValues, setField]);

  return { methods, values, setField, toggleWallet, addCustomWallet, setBudget };
}
