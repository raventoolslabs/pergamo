import { es } from './es';

type CatalogKey = keyof typeof es;

/** Las claves con plural se citan por su base: `t` elige la variante. */
type PluralBase<K> = K extends `${infer Base}_one` ? Base : never;

export type TranslationKey = Exclude<CatalogKey, `${string}_one` | `${string}_other`> | PluralBase<CatalogKey>;

type Params = Record<string, string | number>;

/**
 * Catalogo unico: la interfaz esta en espanol y no hay conmutador de idioma.
 * Vive aqui, y no incrustado en el JSX, para que el codigo quede en ingles y el
 * texto se pueda revisar entero de una sentada.
 */
const catalog: Record<string, string> = es;

/**
 * Con `count`, se busca antes la variante `<clave>_one` o `<clave>_other`: el
 * espanol distingue singular y plural en casi todas las frases con numero.
 */
export const t = (key: TranslationKey, params?: Params): string => {
  const plural = typeof params?.count === 'number'
    ? catalog[`${key}_${params.count === 1 ? 'one' : 'other'}`]
    : undefined;

  const template = plural ?? catalog[key];

  // Una clave sin traducir se muestra tal cual: es un fallo visible en pantalla
  // en lugar de un hueco en blanco que nadie relaciona con su origen.
  if (template === undefined) return key;

  return params
    ? template.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
    : template;
};
