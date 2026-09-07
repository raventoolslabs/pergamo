import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { comprobaciones, contrasenaValida, nivelDeFuerza } from './PasswordFields';
import { AvisoDeError } from './ui';

const IconoCandado = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" />
    <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
    <path d="M12 14.4v2" />
  </svg>
);

const IconoOjo = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12z" />
    <circle cx="12" cy="12" r="2.9" />
  </svg>
);

const IconoCheck = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.6l4.4 4.4L19 7.4" />
  </svg>
);

const IconoCheckCirculo = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.4" />
    <path d="M8.4 12.2l2.6 2.6 4.6-5" />
  </svg>
);

const IconoMarca = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 12.6l5 5 10-11" />
  </svg>
);

const IconoAviso = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5 21.5 20h-19L12 3.5z" />
    <path d="M12 9.5v5" />
    <path d="M12 17.3h.01" />
  </svg>
);

const MENSAJE_ESTADO = {
  coincide: 'Las contraseñas coinciden.',
  'no-coincide': 'Las contraseñas no coinciden.'
} as const;

/**
 * Campo de contraseña con boton de mostrar/ocultar.
 *
 * Independiente por campo a proposito: el de repetir tiene ademas su propio
 * indicador de coincidencia, que este componente no conoce. Va dentro del
 * campo —tick verde o aviso ambar, junto al ojo— y no en una linea aparte:
 * con el campo ya teñido de borde, repetirlo en texto justo debajo era decir
 * lo mismo dos veces.
 */
const CampoContrasena = ({ id, etiqueta, placeholder, value, onChange, mostrar, onMostrar, autoFocus, estado, describedBy }: {
  id: string;
  etiqueta: string;
  placeholder: string;
  value: string;
  onChange: (valor: string) => void;
  mostrar: boolean;
  onMostrar: () => void;
  autoFocus?: boolean;
  /** Solo lo usa el campo de repetición: tiñe el borde, activa el indicador. */
  estado?: 'coincide' | 'no-coincide';
  describedBy?: string;
}) => {

  const idEstado = `${id}-estado`;

  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <div className={`campo-contrasena${estado ? ` campo-contrasena--${estado}` : ''}`}>
        <input
          id={id}
          type={mostrar ? 'text' : 'password'}
          autoComplete="new-password"
          autoFocus={autoFocus}
          maxLength={128}
          placeholder={placeholder}
          value={value}
          aria-invalid={estado === 'no-coincide' || undefined}
          aria-describedby={[describedBy, estado ? idEstado : null].filter(Boolean).join(' ') || undefined}
          onChange={(evento) => onChange(evento.target.value)}
        />
        {estado ? (
          <span className="campo-contrasena__indicador">
            {estado === 'coincide' ? <IconoCheck /> : <IconoAviso />}
          </span>
        ) : null}
        <button
          type="button"
          className="campo-contrasena__ojo"
          onClick={onMostrar}
          aria-pressed={mostrar}
          aria-label={mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          <IconoOjo />
        </button>
      </div>
      {/* El icono basta a la vista; quien usa lector de pantalla necesita la
          misma informacion en texto, asi que va aqui, oculta visualmente. */}
      {estado ? <span id={idEstado} className="sr-only" aria-live="polite">{MENSAJE_ESTADO[estado]}</span> : null}
    </div>
  );
};

interface CambiarContrasenaProps {
  /** Por defecto "Cambiar la contraseña"; la sesion master lo usa para nombrar la organización. */
  titulo?: string;
  descripcion?: ReactNode;
  onSubmit: (contrasena: string) => Promise<unknown>;
  /** Ademas de limpiar los campos, que es lo que hace siempre Cancelar. Sin ella
      (Mi cuenta) el boton solo limpia; con ella (un dialogo) tambien cierra. */
  onCancel?: () => void;
  textoEnvio?: string;
  autoFocus?: boolean;
  /** La nota de seguridad bajo la tarjeta. false la quita cuando el contexto ya la da (poco frecuente). */
  nota?: boolean;
  /** Sin fondo, borde ni radio propios: para cuando ya hay una superficie de
      sobra alrededor, como el `.seccion` de Mi cuenta. El dialogo del master
      SI necesita la tarjeta —es lo unico que le da forma de dialogo, via
      `Dialogo desnudo`— asi que ese uso deja esta prop en su valor por
      defecto. */
  desnudo?: boolean;
}

/**
 * Formulario de cambio de contraseña con validacion en vivo: medidor de
 * fortaleza, checklist de requisitos, coincidencia y mostrar/ocultar en ambos
 * campos.
 *
 * Es la misma tarjeta en "Mi cuenta" (cambia la propia) y en el dialogo de
 * organizaciones que ve el master (cambia la de otra): las reglas del servidor
 * son las mismas y no hay razon para que la interfaz que las explica sea
 * distinta. Lo que cambia entre un sitio y otro es solo texto, via props.
 */
export const CambiarContrasena = ({
  titulo = 'Cambiar la contraseña', descripcion, onSubmit, onCancel,
  textoEnvio = 'Cambiar contraseña', autoFocus = true, nota = true, desnudo = false
}: CambiarContrasenaProps) => {

  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [mostrar1, setMostrar1] = useState(false);
  const [mostrar2, setMostrar2] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);

  const reglas = comprobaciones(contrasena).filter((regla) => regla.visible);
  const cumplidas = reglas.filter((regla) => regla.ok).length;
  const nivel = nivelDeFuerza(contrasena);

  const coincide = contrasena.length > 0 && contrasena === repetida;
  const noCoincide = repetida.length > 0 && !coincide;
  const lista = contrasenaValida(contrasena) && coincide;

  // Cada requisito visible cuenta, y la coincidencia es uno mas: asi la pista
  // es exacta incluso cuando faltan varias cosas a la vez, no solo la ultima.
  const pendientes = (reglas.length - cumplidas) + (coincide ? 0 : 1);

  const cambiar = (setter: (valor: string) => void) => (valor: string) => {
    setter(valor);
    setHecho(false);
  };

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!lista) return;

    setError(null);
    setEnviando(true);

    try {
      await onSubmit(contrasena);
      setContrasena('');
      setRepetida('');
      setHecho(true);
    } catch (fallo) {
      setError(fallo);
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = () => {
    setContrasena('');
    setRepetida('');
    setHecho(false);
    setError(null);
    onCancel?.();
  };

  const cuerpo = (
    <>
      <div className="tarjeta-contrasena__cabecera">
        <div className="tarjeta-contrasena__icono"><IconoCandado /></div>
        <div>
          <h2>{titulo}</h2>
          {descripcion ? <p>{descripcion}</p> : null}
        </div>
      </div>

      <form onSubmit={enviar} className="formulario">
        {hecho ? (
          <div className="tarjeta-contrasena__exito">
            <IconoCheckCirculo />
            <span>Contraseña actualizada correctamente.</span>
          </div>
        ) : null}

        <AvisoDeError error={error} />

        <CampoContrasena
          id="contrasena-nueva"
          etiqueta="Contraseña nueva"
          placeholder="Mínimo 10 caracteres"
          value={contrasena}
          onChange={cambiar(setContrasena)}
          mostrar={mostrar1}
          onMostrar={() => setMostrar1((estado) => !estado)}
          autoFocus={autoFocus}
          describedBy="contrasena-requisitos"
        />

        <div className={`medidor${nivel ? ` medidor--${nivel.clave}` : ''}`}>
          <div className="medidor__pista">
            {reglas.map((_, indice) => (
              <div
                key={indice}
                className={`medidor__segmento${nivel && indice < cumplidas ? ' medidor__segmento--activo' : ''}`}
              />
            ))}
          </div>
          <span className="medidor__etiqueta">{nivel ? nivel.etiqueta : '—'}</span>
        </div>

        <div className="requisitos" id="contrasena-requisitos" aria-live="polite">
          {reglas.map((regla) => (
            <div className={`requisito${regla.ok ? ' requisito--cumple' : ''}`} key={regla.texto}>
              <span className="requisito__marca">{regla.ok ? <IconoMarca /> : null}</span>
              {regla.texto}
            </div>
          ))}
        </div>

        <CampoContrasena
          id="contrasena-repetida"
          etiqueta="Repetir contraseña"
          placeholder="Vuelve a escribirla"
          value={repetida}
          onChange={cambiar(setRepetida)}
          mostrar={mostrar2}
          onMostrar={() => setMostrar2((estado) => !estado)}
          estado={noCoincide ? 'no-coincide' : coincide ? 'coincide' : undefined}
        />

        <div className="tarjeta-contrasena__acciones">
          <button type="submit" className="btn btn--principal" disabled={!lista || enviando}>
            {enviando
              ? <><span className="girando" aria-hidden="true" /> Guardando…</>
              : <><IconoCheck />{textoEnvio}</>}
          </button>
          {/* Sin onCancel (Mi cuenta) no hay de que "salir": el formulario no
              cierra nada, y un boton que solo limpia campos ya escritos sobra. */}
          {onCancel ? <button type="button" className="btn" onClick={cancelar}>Cancelar</button> : null}
          <span className="tarjeta-contrasena__pista">
            {lista ? '' : `Falta${pendientes === 1 ? '' : 'n'} ${pendientes} requisito${pendientes === 1 ? '' : 's'} por cumplir`}
          </span>
        </div>
      </form>
    </>
  );

  return (
    <>
      {desnudo ? cuerpo : <div className="tarjeta-contrasena">{cuerpo}</div>}

      {nota ? (
        <p className="tarjeta-contrasena__nota">
          Usa una contraseña que no reutilices en otros servicios. Si sospechas de un acceso
          indebido, cierra sesión en todos los dispositivos después de cambiarla.
        </p>
      ) : null}
    </>
  );
};
