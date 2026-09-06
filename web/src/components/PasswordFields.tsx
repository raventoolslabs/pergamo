import type { ReactNode } from 'react';

/**
 * Las reglas que aplica el servidor con owasp-password-strength-test: minimo 10
 * caracteres, maximo 128, y hay que pasar las cuatro pruebas opcionales
 * (minuscula, mayuscula, digito y simbolo). Una frase de 20 caracteres o mas
 * queda exenta de esas cuatro.
 *
 * Se replican aqui para que el problema se vea antes de enviar, no como un 400
 * despues. El servidor sigue siendo quien decide.
 */
export const comprobaciones = (contrasena: string) => {
  const esFrase = contrasena.length >= 20;

  return [
    { texto: '10 caracteres o más', ok: contrasena.length >= 10 },
    { texto: '128 como mucho', ok: contrasena.length > 0 && contrasena.length <= 128 },
    { texto: 'una minúscula', ok: esFrase || /[a-z]/.test(contrasena) },
    { texto: 'una mayúscula', ok: esFrase || /[A-Z]/.test(contrasena) },
    { texto: 'un número', ok: esFrase || /\d/.test(contrasena) },
    { texto: 'un símbolo', ok: esFrase || /[^A-Za-z0-9]/.test(contrasena) }
  ];
};

export const contrasenaValida = (contrasena: string) =>
  comprobaciones(contrasena).every((comprobacion) => comprobacion.ok);

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
