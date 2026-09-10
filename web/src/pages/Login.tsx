import { useState } from 'react';
import type { FormEvent } from 'react';

import { useSession } from '../auth/session';
import { ErrorNotice } from '../components/ui';
import { t } from '../i18n';

// La barra diagonal aparece cuando la contrasena esta a la vista: el icono dice
// lo que pasa ahora, no lo que haria el boton.
const EyeIcon = ({ crossed }: { crossed: boolean }) => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12Z" />
    <circle cx="12" cy="12" r="3.1" />
    {crossed ? <path d="M3.5 20.5 20.5 3.5" /> : null}
  </svg>
);

export const Login = () => {

  const { login } = useSession();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [entering, setEntering] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setEntering(true);

    try {
      await login(name.trim(), password);
    } catch (failure) {
      setError(failure);
    } finally {
      setEntering(false);
    }
  };

  const eyeLabel = showPassword ? t('a11y.hidePassword') : t('a11y.viewPassword');

  return (
    <div className="login">

      {/* El panel es lo unico que explica que es esto a quien llega sin
          saberlo. Por debajo de 900px desaparece y el logotipo sube. */}
      <aside className="login__brand">
        <div className="login__veil" aria-hidden="true" />
        <div className="login__weave" aria-hidden="true" />
        <div className="login__watermark" aria-hidden="true" />

        <div className="login__badge">
          <img src="/img/logo.png" alt="Pergamo" />
        </div>

        <div className="login__pitch">
          <h1>{t('login.headline')}</h1>
          <p>{t('login.pitch')}</p>
          <div className="login__rules" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <p className="login__footer">{t('login.copyright')}</p>
      </aside>

      <main className="login__panel">
        <div className="login__sheet">

          {/* En la columna el logotipo es decorativo: repetirlo no le dice nada
              a un lector de pantalla. */}
          <img src="/img/logo.png" alt="" className="login__logo-mobile" />

          <div className="login__heading">
            <h2>{t('login.title')}</h2>
            <p>{t('login.subtitle')}</p>
          </div>

          <ErrorNotice error={error} />

          <form onSubmit={submit} className="login__form">
            <div className="field">
              <label htmlFor="login-name">{t('login.nameLabel')}</label>
              <input
                id="login-name"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="login-password">{t('login.passwordLabel')}</label>
              <span className="login__secret">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={eyeLabel}
                  aria-pressed={showPassword}
                  title={eyeLabel}
                >
                  <EyeIcon crossed={showPassword} />
                </button>
              </span>
            </div>

            <button type="submit" className="login__submit" disabled={entering || !name || !password}>
              {entering
                ? <><span className="spinner" aria-hidden="true" /> {t('login.submitting')}</>
                : t('login.submit')}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
