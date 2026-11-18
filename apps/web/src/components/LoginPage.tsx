import { errorMessage } from '@cvs/shared';
import { useState } from 'react';
import { api } from '../api';

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white p-2.5 text-base focus:border-indigo-500 sm:text-sm focus:outline-none';

export function LoginPage({ onLoggedIn }: { onLoggedIn(email: string): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      onLoggedIn(res.email ?? email);
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 sm:px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <h1 className="text-2xl font-bold">Creative Video Studio</h1>
          <p className="text-sm text-slate-500">Sign in to continue.</p>
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
        </div>
        {error && <div className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</div>}
        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
