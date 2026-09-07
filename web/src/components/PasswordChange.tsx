import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { t } from '../i18n';
import { isPasswordValid, passwordRules, strengthLevel } from './PasswordFields';
import { ErrorNotice } from './ui';

const LockIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" />
    <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
    <path d="M12 14.4v2" />
  </svg>
);

const EyeIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12z" />
    <circle cx="12" cy="12" r="2.9" />
  </svg>
);

const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.6l4.4 4.4L19 7.4" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.4" />
    <path d="M8.4 12.2l2.6 2.6 4.6-5" />
  </svg>
);

const TickIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 12.6l5 5 10-11" />
  </svg>
);

const WarnIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5 21.5 20h-19L12 3.5z" />
    <path d="M12 9.5v5" />
    <path d="M12 17.3h.01" />
  </svg>
);

const MATCH_MESSAGE = {
  match: t('password.match'),
  mismatch: t('password.mismatch')
} as const;

/**
 * Campo de contrasena con boton de mostrar/ocultar.
 *
 * El indicador de coincidencia va dentro del campo, junto al ojo: con el borde
 * ya tenido, repetirlo en texto justo debajo era decir lo mismo dos veces.
 */
const PasswordField = ({ id, label, placeholder, value, onChange, visible, onToggle, autoFocus, match, describedBy }: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoFocus?: boolean;
  /** Solo lo usa el campo de repeticion: tine el borde y activa el indicador. */
  match?: 'match' | 'mismatch';
  describedBy?: string;
}) => {

  const matchId = `${id}-match`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`password-field${match ? ` password-field--${match}` : ''}`}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          autoFocus={autoFocus}
          maxLength={128}
          placeholder={placeholder}
          value={value}
          aria-invalid={match === 'mismatch' || undefined}
          aria-describedby={[describedBy, match ? matchId : null].filter(Boolean).join(' ') || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {match ? (
          <span className="password-field__indicator">
            {match === 'match' ? <CheckIcon /> : <WarnIcon />}
          </span>
        ) : null}
        <button
          type="button"
          className="password-field__eye"
          onClick={onToggle}
          aria-pressed={visible}
          aria-label={visible ? t('a11y.hidePassword') : t('a11y.showPassword')}
        >
          <EyeIcon />
        </button>
      </div>
      {/* El icono basta a la vista; con lector de pantalla hace falta la misma
          informacion en texto. */}
      {match ? <span id={matchId} className="sr-only" aria-live="polite">{MATCH_MESSAGE[match]}</span> : null}
    </div>
  );
};

interface PasswordChangeProps {
  /** La sesion master lo usa para nombrar la organizacion. */
  title?: string;
  description?: ReactNode;
  onSubmit: (password: string) => Promise<unknown>;
  /** Ademas de limpiar los campos, que es lo que hace siempre Cancelar. Sin ella
      el boton solo limpia; con ella tambien cierra. */
  onCancel?: () => void;
  submitText?: string;
  autoFocus?: boolean;
  /** La nota de seguridad bajo la tarjeta. */
  note?: boolean;
  /** Sin fondo, borde ni radio propios: para cuando ya hay una superficie de
      sobra alrededor, como la seccion de Mi cuenta. */
  bare?: boolean;
}

/**
 * Es la misma tarjeta en Mi cuenta (cambia la propia) y en el dialogo del
 * master (cambia la de otra): las reglas del servidor son las mismas, asi que
 * entre un sitio y otro solo cambia el texto.
 */
export const PasswordChange = ({
  title = t('password.change'), description, onSubmit, onCancel,
  submitText = t('password.submit'), autoFocus = true, note = true, bare = false
}: PasswordChangeProps) => {

  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [showFirst, setShowFirst] = useState(false);
  const [showSecond, setShowSecond] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);

  const rules = passwordRules(password).filter((rule) => rule.visible);
  const met = rules.filter((rule) => rule.ok).length;
  const level = strengthLevel(password);

  const matches = password.length > 0 && password === repeated;
  const mismatches = repeated.length > 0 && !matches;
  const ready = isPasswordValid(password) && matches;

  // Cada requisito visible cuenta, y la coincidencia es uno mas: asi la pista es
  // exacta cuando faltan varias cosas a la vez.
  const missing = (rules.length - met) + (matches ? 0 : 1);

  const change = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setDone(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    setError(null);
    setSending(true);

    try {
      await onSubmit(password);
      setPassword('');
      setRepeated('');
      setDone(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  };

  const cancel = () => {
    setPassword('');
    setRepeated('');
    setDone(false);
    setError(null);
    onCancel?.();
  };

  const body = (
    <>
      <div className="password-card__header">
        <div className="password-card__icon"><LockIcon /></div>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>

      <form onSubmit={submit} className="form">
        {done ? (
          <div className="password-card__success">
            <CheckCircleIcon />
            <span>{t('password.updated')}</span>
          </div>
        ) : null}

        <ErrorNotice error={error} />

        <PasswordField
          id="password-new"
          label={t('password.newLabel')}
          placeholder={t('password.newPlaceholder')}
          value={password}
          onChange={change(setPassword)}
          visible={showFirst}
          onToggle={() => setShowFirst((current) => !current)}
          autoFocus={autoFocus}
          describedBy="password-requirements"
        />

        <div className={`meter${level ? ` meter--${level.key}` : ''}`}>
          <div className="meter__track">
            {rules.map((_, index) => (
              <div
                key={index}
                className={`meter__segment${level && index < met ? ' meter__segment--active' : ''}`}
              />
            ))}
          </div>
          <span className="meter__label">{level ? level.label : t('common.none')}</span>
        </div>

        <div className="requirements" id="password-requirements" aria-live="polite">
          {rules.map((rule) => (
            <div className={`requirement${rule.ok ? ' requirement--met' : ''}`} key={rule.text}>
              <span className="requirement__mark">{rule.ok ? <TickIcon /> : null}</span>
              {rule.text}
            </div>
          ))}
        </div>

        <PasswordField
          id="password-repeated"
          label={t('password.repeatLabel')}
          placeholder={t('password.repeatPlaceholder')}
          value={repeated}
          onChange={change(setRepeated)}
          visible={showSecond}
          onToggle={() => setShowSecond((current) => !current)}
          match={mismatches ? 'mismatch' : matches ? 'match' : undefined}
        />

        <div className="password-card__actions">
          <button type="submit" className="btn btn--primary" disabled={!ready || sending}>
            {sending
              ? <><span className="spinner" aria-hidden="true" /> {t('common.saving')}</>
              : <><CheckIcon />{submitText}</>}
          </button>
          {/* Sin onCancel no hay de que salir: un boton que solo limpia campos
              ya escritos sobra. */}
          {onCancel ? <button type="button" className="btn" onClick={cancel}>{t('common.cancel')}</button> : null}
          <span className="password-card__hint">
            {ready ? '' : t('password.pending', { count: missing })}
          </span>
        </div>
      </form>
    </>
  );

  return (
    <>
      {bare ? body : <div className="password-card">{body}</div>}

      {note ? <p className="password-card__note">{t('password.note')}</p> : null}
    </>
  );
};
