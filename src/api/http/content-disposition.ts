/**
 * El nombre viene del `originalname` del cliente: interpolarlo tal cual permite
 * inyectar parametros en la cabecera subiendo un fichero con comillas o saltos
 * de linea en el nombre.
 *
 * Se emite la forma doble de RFC 6266: `filename` ASCII para clientes antiguos
 * y `filename*` en RFC 5987, que prevalece cuando estan los dos.
 */
export const contentDisposition = (filename:string, type = 'attachment') => {

  // Los caracteres de control romperian la cabecera; el resto de no-ASCII viaja
  // en el parametro filename*, asi que aqui se sustituyen por un guion bajo.
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '\\$&');

  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
