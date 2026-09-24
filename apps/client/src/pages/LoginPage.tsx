import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/lib/session';

/**
 * Sign in.
 *
 * The seeded accounts are prefilled during development only. They come from
 * `prisma/seed.ts` and exist on a local database, so they are not a secret — but
 * the whole block sits behind `import.meta.env.DEV`, which Vite evaluates at build
 * time and then tree-shakes, so none of it reaches a production bundle.
 */

const DEV_ACCOUNTS = [
  {
    email: 'builder@acme.test',
    password: 'Password123!',
    role: 'App Builder',
    note: 'Builds and submits, cannot publish',
  },
  {
    email: 'reviewer@acme.test',
    password: 'Password123!',
    role: 'IT Reviewer',
    note: 'Reviews and publishes, cannot edit',
  },
  {
    email: 'admin@acme.test',
    password: 'Password123!',
    role: 'Org Admin',
    note: 'Everything',
  },
] as const;

const DEFAULT_ACCOUNT = DEV_ACCOUNTS[0];

export function LoginPage() {
  const { user, login, loading } = useSession();
  const [email, setEmail] = useState(import.meta.env.DEV ? DEFAULT_ACCOUNT.email : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? DEFAULT_ACCOUNT.password : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/apps" replace />;

  const signIn = async (withEmail: string, withPassword: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await login(withEmail, withPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email, password);
        }}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 mb-5 text-sm text-slate-500">Low-code application platform</p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="username"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>

        {error && (
          <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {import.meta.env.DEV && (
          <section className="mt-5 rounded border border-dashed border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-amber-800 uppercase">
              Development accounts
            </p>
            <div className="flex flex-col gap-1">
              {DEV_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    void signIn(account.email, account.password);
                  }}
                  className="flex items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-amber-100 disabled:opacity-50"
                >
                  <span className="text-xs font-medium text-amber-900">{account.role}</span>
                  <span className="truncate text-[11px] text-amber-700">{account.note}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 px-2 text-[11px] text-amber-700">
              Seeded by <code>prisma/seed.ts</code>, password{' '}
              <code>{DEFAULT_ACCOUNT.password}</code>. This block is stripped from production
              builds.
            </p>
          </section>
        )}

        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
          Single sign-on through Active Directory is configured per organization by an
          administrator; this form is the local fallback.
        </p>
      </form>
    </div>
  );
}
