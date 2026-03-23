import { createFileRoute, redirect, isRedirect } from '@tanstack/react-router';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/login')({
  component: LoginPage,
  beforeLoad: async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        throw redirect({ to: '/' });
      }
    } catch (e) {
      if (isRedirect(e)) throw e;
    }
  },
} as any);

function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100 font-sans text-slate-900 antialiased">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(148, 163, 184, 0.25), transparent 45%), radial-gradient(circle at 80% 0%, rgba(125, 211, 252, 0.2), transparent 40%)',
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-14 md:flex-row md:items-center md:gap-16 md:px-10 md:py-0">
        <div className="flex-1 pb-12 md:pb-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Personal finance
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
            Fainens
          </h1>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-slate-600">
            Salary-to-salary personal finance, simplified. One calm place to track
            spending, stay on budget, and breathe easier between paychecks.
          </p>
        </div>

        <div className="flex w-full max-w-md shrink-0 flex-col justify-center md:min-h-screen md:py-20">
          <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-8 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.25)] backdrop-blur-md">
            <button
              type="button"
              onClick={login}
              className="cursor-pointer flex w-full items-center justify-center gap-3 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </button>
            <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
              Private, single-user app. Only authorized emails can sign in.
            </p>
          </div>

          <footer className="mt-10 text-center text-xs text-slate-400 md:mt-8">
            Fainens · v{import.meta.env.VITE_APP_VERSION ?? '0.0.0'}
          </footer>
        </div>
      </div>
    </div>
  );
}
