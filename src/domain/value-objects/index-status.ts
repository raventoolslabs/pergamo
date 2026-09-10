export const INDEX_STATUS = ['none', 'pending', 'indexing', 'indexed', 'error', 'unsupported'] as const;

export type IndexStatus = typeof INDEX_STATUS[number];

/**
 * Estados de los que no se sale reintentando.
 *
 * 'unsupported' es un mimetype sin conversor y 'error' un fallo del documento
 * —fichero ausente, extraccion vacia—: los dos exigen que alguien cambie algo,
 * y volver a encolarlos solo gasta la maquina de inferencia.
 */
export const TERMINAL_INDEX_STATUS:IndexStatus[] = ['indexed', 'error', 'unsupported'];
