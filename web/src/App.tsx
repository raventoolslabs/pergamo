import { Navigate, Route, Routes } from 'react-router-dom';

import { ConfigProvider } from './api/config';
import { useSession } from './auth/session';
import { Layout } from './components/layout';
import { Account } from './pages/Account';
import { DocumentDetail } from './pages/DocumentDetail';
import { Documents } from './pages/Documents';
import { Login } from './pages/Login';
import { Organizations } from './pages/Organizations';

export const App = () => {

  const { session } = useSession();

  if (!session) return <Login />;

  // El token master no lleva organizacion: las rutas de documentos no
  // funcionarian con el, asi que el arbol cambia segun quien entre.
  return (
    <ConfigProvider>
      <Routes>
        <Route element={<Layout />}>
          {session.master ? (
            <>
              <Route path="/organizations" element={<Organizations />} />
              <Route path="*" element={<Navigate to="/organizations" replace />} />
            </>
          ) : (
            <>
              <Route index element={<Documents />} />
              <Route path="/documents/:id" element={<DocumentDetail />} />
              <Route path="/account" element={<Account />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Route>
      </Routes>
    </ConfigProvider>
  );
};
