export interface IndexQueue {
  /**
   * Encola la indexacion de un documento. El payload no lleva nada mas que los
   * dos identificadores: un trabajo puede pasar horas esperando, y todo lo
   * demas se relee de la base. Meter la ruta ahi es como se acaba convirtiendo
   * el fichero anterior despues de un reemplazo.
   */
  enqueue(document:string, organization:string): Promise<void>;
  close(): Promise<void>;
}
