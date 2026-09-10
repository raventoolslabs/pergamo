import { z } from "zod";

/**
 * El numero de version llega en la ruta, siempre como cadena. Sin tope
 * superior: una version que no existe ya se resuelve con un 404, y el limite
 * real lo fija MAX_VERSION_FILES en el momento de archivar.
 */
export const documentVersionParamSchema = z.object({
  version: z.coerce.number().int().min(1)
});
