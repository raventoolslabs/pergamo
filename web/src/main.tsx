import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { SessionProvider } from './auth/session';
import { ToastProvider } from './components/toast';
import './styles/app.css';

const container = document.getElementById('root');

if (!container) throw new Error('No existe el contenedor #root');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
