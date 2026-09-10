import type { ReactNode } from 'react';

import { t } from '../i18n';

/**
 * Las reglas que aplica el servidor con owasp-password-strength-test: entre 10
 * y 128 caracteres y las cuatro pruebas opcionales (minuscula, mayuscula,
 * digito y simbolo), de las que queda exenta una frase de 20 o mas.
 *
 * Se replican aqui para ver el problema antes de enviar, no como un 400
 * despues. El servidor sigue siendo quien decide.
 *
 * El maximo va como `visible: false`: lo aplica el `maxLength` del input, asi
 * que es un requisito que no se puede incumplir escribiendo.
 */
export const passwordRules = (password: string) => {
  const isPassphrase = password.length >= 20;

  return [
    { text: t('password.ruleLength'), ok: password.length >= 10, visible: true },
    { text: t('password.ruleMaxLength'), ok: password.length > 0 && password.length <= 128, visible: false },
    { text: t('password.ruleLowercase'), ok: isPassphrase || /[a-z]/.test(password), visible: true },
    { text: t('password.ruleUppercase'), ok: isPassphrase || /[A-Z]/.test(password), visible: true },
    { text: t('password.ruleDigit'), ok: isPassphrase || /\d/.test(password), visible: true },
    { text: t('password.ruleSymbol'), ok: isPassphrase || /[^A-Za-z0-9]/.test(password), visible: true }
  ];
};

export const isPasswordValid = (password: string) =>
  passwordRules(password).every((rule) => rule.ok);

/**
 * Nivel para el medidor: la clave decide el color por CSS, y la cuenta se hace
 * solo sobre las reglas visibles —el maximo de 128 no dice nada sobre lo fuerte
 * que es una contrasena de 12 caracteres—.
 */
const STRENGTH_LEVELS = [
  { key: 'very-weak', label: t('password.strengthVeryWeak') },
  { key: 'weak', label: t('password.strengthWeak') },
  { key: 'fair', label: t('password.strengthFair') },
  { key: 'good', label: t('password.strengthGood') },
  { key: 'excellent', label: t('password.strengthExcellent') }
] as const;

export const strengthLevel = (password: string) => {
  if (!password) return null;

  const visible = passwordRules(password).filter((rule) => rule.visible);
  const met = visible.filter((rule) => rule.ok).length;

  return STRENGTH_LEVELS[Math.max(0, Math.min(met, visible.length) - 1)];
};

export const PasswordChecklist = ({ password }: { password: string }): ReactNode => (
  <>
    <ul className="checklist">
      {passwordRules(password).map((rule) => (
        <li key={rule.text} className={rule.ok ? 'met' : undefined}>{rule.text}</li>
      ))}
    </ul>
    {password.length >= 20
      ? <p className="field__hint">{t('password.passphraseHint')}</p>
      : null}
  </>
);
