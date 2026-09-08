/**
 * Ambito transaccional, opaco para la capa app: quien lo crea y lo entiende es
 * la implementacion en infrastructure. Asi un caso de uso decide DONDE empieza
 * y acaba la transaccion sin conocer el ORM.
 */
export type TransactionScope = unknown;

export interface UnitOfWork {
  run<T>(work:(scope:TransactionScope) => Promise<T>): Promise<T>;
}
