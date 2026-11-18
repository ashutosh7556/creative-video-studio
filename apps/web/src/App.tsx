import { errorMessage } from '@cvs/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { LoginPage } from './components/LoginPage';
import { Dashboard } from './Dashboard';

type Session = { state: 'loading' } | { state: 'out' } | { state: 'in'; email: string } | { state: 'error'; message: string };

/** Login gate: the dashboard is only rendered for a valid session (the API enforces this too). */
export default function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' });

  useEffect(() => {
    api
      .me()
      .then((s) => setSession(s.authenticated && s.email ? { state: 'in', email: s.email } : { state: 'out' }))
      .catch((e) =>
        setSession({ state: 'error', message: `API not reachable (${errorMessage(e)}). Start it with \`npm run dev:api\`.` }),
      );
  }, []);

  const onAuthLost = useCallback(() => setSession({ state: 'out' }), []);
  const onLogout = useCallback(() => {
    api.logout().finally(() => setSession({ state: 'out' }));
  }, []);

  switch (session.state) {
    case 'loading':
      return null;
    case 'error':
      return (
        <div className="mx-auto max-w-xl px-6 py-16">
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{session.message}</div>
        </div>
      );
    case 'out':
      return <LoginPage onLoggedIn={(email) => setSession({ state: 'in', email })} />;
    case 'in':
      return <Dashboard email={session.email} onLogout={onLogout} onAuthLost={onAuthLost} />;
  }
}
