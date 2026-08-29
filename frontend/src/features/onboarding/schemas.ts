import { z } from 'zod';

export const onboardingFormSchema = z.object({
  selectedWallets: z.array(z.string().trim().min(1)).max(50),
  customWalletName: z.string().max(100),
  newCategoryName: z.string().max(100),
  periodName: z.string().max(200),
  periodStart: z.string(),
  periodEnd: z.string(),
  budgets: z.record(z.string(), z.string().max(32)),
});

export type OnboardingFormValues = z.infer<typeof onboardingFormSchema>;

export const onboardingFormDefaults: OnboardingFormValues = {
  selectedWallets: ['Cash', 'BCA'],
  customWalletName: '',
  newCategoryName: '',
  periodName: '',
  periodStart: '',
  periodEnd: '',
  budgets: {},
};
