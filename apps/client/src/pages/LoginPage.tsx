import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { safeInternalPath } from '@/lib/paths';

export function LoginPage() {
  const { user, login, loading } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [searchParams] = useSearchParams();
  const next = safeInternalPath(searchParams.get('from')) ?? '/apps';

  if (loading) return null;
  if (user) return <Navigate to={next} replace />;

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
        <h1 className="text-lg font-semibold text-slate-900">Sign in to Swiftly</h1>
        <p className="mt-1 mb-5 text-sm text-slate-500">Build business apps without code</p>

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

        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
          Single sign-on through Active Directory is configured per organization by an
          administrator; this form is the local fallback.
        </p>
      </form>
    </div>
  );
}
