export type VectorDistance = 'cosine' | 'dot' | 'l2';

/**
 * Identidad de un indice. Dos proveedores nunca comparten espacio vectorial, y
 * el modelo decide si dos vectores son comparables: por eso cambiar de modelo
 * es crear la version siguiente, no reescribir la actual.
 */
export interface SearchIndexDescriptor {
  name: string;
  provider: string;
  model: string;
  dimension: number;
  distance: VectorDistance;
  chunkerVersion: string;
  version: number;
}
