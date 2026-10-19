import { createFileRoute, redirect, isRedirect } from '@tanstack/react-router';
import { CalendarClock, Landmark, LockKeyhole, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getCurrentUser } from '../generated/client';
import mountainHero from '../assets/dashboard-mountain-hero.png';

export const Route = createFileRoute('/login')({
  component: LoginPage,
  beforeLoad: async () => {
    try {
      const response = await getCurrentUser();
      if (response.status === 200) {
        throw redirect({ to: '/' });
      }
    } catch (e) {
      if (isRedirect(e)) throw e;
    }
  },
});

const features = [
  { icon: Landmark, title: 'Every rupiah accounted for', detail: 'Double-entry books across banks, cash, e-wallets and loans.' },
  { icon: CalendarClock, title: 'Budgets that follow payday', detail: 'Periods run salary to salary, with a safe daily pace.' },
  { icon: Sparkles, title: 'An agent that knows your books', detail: 'Ask questions and draft entries in plain language.' },
];

const version = import.meta.env.VITE_APP_VERSION as string | undefined;

function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-background)] font-sans text-[var(--color-text-primary)] antialiased lg:flex-row">
      {/* The brand panel is dark in both themes, so it uses fixed colours rather than theme tokens. */}
      <section className="relative isolate flex min-h-[44svh] flex-col overflow-hidden bg-[#102b4d] px-6 pb-14 pt-6 text-white sm:px-10 lg:min-h-svh lg:w-[55%] lg:px-14 lg:py-12">
        <img src={mountainHero} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover object-center" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(160deg,rgba(7,29,55,0.94)_0%,rgba(9,35,66,0.66)_50%,rgba(12,41,72,0.2)_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(5,24,44,0.7),transparent_60%)]" />

        <div className="flex items-center gap-2.5">
          <BrandMark className="h-9 w-9 text-[26px]" />
          <span className="font-[family-name:var(--font-heading)] text-lg font-bold tracking-tight">Fainens</span>
        </div>

        <div className="mt-auto max-w-xl pt-10 lg:mb-auto lg:pt-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Personal finance</p>
          <h1 className="mt-3 font-[family-name:var(--font-heading)] text-[2rem] font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            Salary to salary,<br />in one calm place.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/75 max-sm:hidden">
            Track spending, stay on budget and see what each payday leaves you with.
          </p>
          <ul className="mt-9 hidden gap-5 lg:grid">
            {features.map(({ icon: Icon, title, detail }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 backdrop-blur-sm">
                  <Icon className="h-[18px] w-[18px] text-white/90" strokeWidth={1.8} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-white/65">{detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* On phones the sign-in panel rises over the brand panel like a sheet. */}
      <main className="relative -mt-7 flex flex-1 flex-col rounded-t-[28px] bg-[var(--color-background)] px-6 pb-8 pt-10 sm:px-10 lg:mt-0 lg:rounded-none lg:px-14 lg:py-12">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <BrandMark className="h-12 w-12 text-[34px] shadow-[0_10px_24px_-10px_rgba(0,86,210,0.6)] max-lg:hidden" />
          <h2 className="font-[family-name:var(--font-heading)] text-2xl font-bold tracking-tight lg:mt-7 lg:text-3xl">Welcome back</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">Sign in to open your books.</p>

          <button
            type="button"
            onClick={login}
            className="mt-8 flex min-h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 text-sm font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-sm)] transition hover:border-[var(--color-muted)] hover:shadow-[var(--shadow-md)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] active:scale-[0.99]"
          >
            <GoogleLogo />
            Continue with Google
          </button>

          <div className="mt-6 flex items-start gap-3 rounded-2xl bg-[var(--ref-surface-container-low)] p-4">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" strokeWidth={2} aria-hidden />
            <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              A private, single-user app. Only approved Google accounts can sign in.
            </p>
          </div>
        </div>

        <footer className="mx-auto mt-10 w-full max-w-sm text-xs text-[var(--color-muted)]">
          Fainens{version ? ` · v${version}` : ''}
        </footer>
      </main>
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-[30%] bg-[#0056d2] font-[Georgia,serif] font-semibold italic leading-none text-white ${className ?? ''}`}>
      f
    </span>
  );
}

function GoogleLogo() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
