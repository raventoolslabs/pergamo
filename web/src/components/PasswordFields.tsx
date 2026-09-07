import type { ReactNode } from 'react';

/**
 * Las reglas que aplica el servidor con owasp-password-strength-test: minimo 10
 * caracteres, maximo 128, y hay que pasar las cuatro pruebas opcionales
 * (minuscula, mayuscula, digito y simbolo). Una frase de 20 caracteres o mas
 * queda exenta de esas cuatro.
 *
 * Se replican aqui para que el problema se vea antes de enviar, no como un 400
 * despues. El servidor sigue siendo quien decide.
 *
 * El maximo va como `visible:false`: se aplica con `maxLength` en el propio
 * input, asi que nunca hay nada que mostrar por el — un requisito que no se
 * puede incumplir escribiendo no aporta nada en una lista pensada para guiar.
 */
export const comprobaciones = (contrasena: string) => {
  const esFrase = contrasena.length >= 20;

  return [
    { texto: '10 caracteres o más', ok: contrasena.length >= 10, visible: true },
    { texto: '128 como mucho', ok: contrasena.length > 0 && contrasena.length <= 128, visible: false },
    { texto: 'una minúscula', ok: esFrase || /[a-z]/.test(contrasena), visible: true },
    { texto: 'una mayúscula', ok: esFrase || /[A-Z]/.test(contrasena), visible: true },
    { texto: 'un número', ok: esFrase || /\d/.test(contrasena), visible: true },
    { texto: 'un símbolo', ok: esFrase || /[^A-Za-z0-9]/.test(contrasena), visible: true }
  ];
};

export const contrasenaValida = (contrasena: string) =>
  comprobaciones(contrasena).every((comprobacion) => comprobacion.ok);

/**
 * Nivel de fortaleza para el medidor: la clave decide el color por CSS (mismo
 * patron que ESTADO/Veredicto en ui.tsx) y la cuenta se hace solo sobre las
 * reglas visibles — el maximo de 128 no dice nada sobre lo fuerte que es una
 * contraseña de 12 caracteres.
 */
const NIVELES = [
  { clave: 'muy-debil', etiqueta: 'Muy débil' },
  { clave: 'debil', etiqueta: 'Débil' },
  { clave: 'aceptable', etiqueta: 'Aceptable' },
  { clave: 'buena', etiqueta: 'Buena' },
  { clave: 'excelente', etiqueta: 'Excelente' }
] as const;

export const nivelDeFuerza = (contrasena: string) => {
  if (!contrasena) return null;

  const visibles = comprobaciones(contrasena).filter((regla) => regla.visible);
  const cumplidas = visibles.filter((regla) => regla.ok).length;

  return NIVELES[Math.max(0, Math.min(cumplidas, visibles.length) - 1)];
};

export const Comprobacion = ({ contrasena }: { contrasena: string }): ReactNode => (
  <>
    <ul className="comprobacion">
      {comprobaciones(contrasena).map((comprobacion) => (
        <li key={comprobacion.texto} className={comprobacion.ok ? 'cumple' : undefined}>{comprobacion.texto}</li>
      ))}
    </ul>
    {contrasena.length >= 20
      ? <p className="campo__pista">Una frase de 20 caracteres o más se acepta aunque no mezcle tipos.</p>
      : null}
  </>
);
