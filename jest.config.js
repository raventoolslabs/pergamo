/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  // Un solo worker: las suites no estan aisladas entre si. Todas hablan con la
  // MISMA base de datos y con la misma organizacion 'pergamo', y
  // 01-organization.test.ts le cambia la contrasena a mitad de recorrido: en
  // paralelo, cualquier otra suite que entre en esa ventana recibe un 401 que
  // no tiene nada que ver con lo que estaba probando.
  //
  // El coste es despreciable (la bateria entera baja de cinco segundos) y a
  // cambio el resultado deja de depender de como reparta Jest los ficheros.
  maxWorkers: 1,

  // El alias @/ de tsconfig.json: ts-jest compila, pero quien resuelve el
  // modulo en tiempo de ejecucion es Jest.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
