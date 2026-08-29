import { getOnboardingStatus } from '../generated/client';

/** Used in route beforeLoad — generated transport keeps auth/error handling consistent. */
export async function fetchOnboardingStatus(): Promise<{
  needsOnboarding: boolean;
} | null> {
  try {
    const response = await getOnboardingStatus();
    if (response.status !== 200) return null;
    return response.data;
  } catch {
    return null;
  }
}
