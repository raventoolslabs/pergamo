export const SCAN_STATUS = ['pending', 'clean', 'infected', 'error', 'malicious'] as const;

export type ScanStatus = typeof SCAN_STATUS[number];

/**
 * Estados que retienen el documento; todo lo demas se entrega.
 *
 * La regla no es «solo se entrega lo aprobado» sino «no se entrega lo que
 * alguien tiene que mirar»: los tres exigen una intervencion y ninguno se
 * arregla esperando.
 *
 * 'pending' no esta aqui a proposito: es una verificacion que falta, no un
 * hallazgo, y la resuelve el siguiente barrido.
 */
export const QUARANTINED_STATUS:ScanStatus[] = ['infected', 'malicious', 'error'];

export const isQuarantined = (status:ScanStatus) => QUARANTINED_STATUS.includes(status);
