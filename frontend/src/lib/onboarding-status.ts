/** Used in route beforeLoad — public fetch, same-origin + cookies */
export async function fetchOnboardingStatus(): Promise<{
  needsOnboarding: boolean;
} | null> {
  try {
    const res = await fetch('/api/auth/onboarding-status', { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as { needsOnboarding: boolean };
  } catch {
    return null;
  }
}
