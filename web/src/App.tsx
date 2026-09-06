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

  // El token master no lleva organizacion: ninguna ruta de documentos
  // funcionaria con el, asi que el arbol de rutas es distinto segun quien entre
  // en lugar de ofrecer pantallas que solo pueden dar error.
  return (
    <ConfigProvider>
      <Routes>
        <Route element={<Layout />}>
          {session.master ? (
            <>
              <Route path="/organizaciones" element={<Organizations />} />
              <Route path="*" element={<Navigate to="/organizaciones" replace />} />
            </>
          ) : (
            <>
              <Route index element={<Documents />} />
              <Route path="/documento/:id" element={<DocumentDetail />} />
              <Route path="/cuenta" element={<Account />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Route>
      </Routes>
    </ConfigProvider>
  );
};
