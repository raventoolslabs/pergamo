/**
 * Un array enlazado como replacement lo expande Sequelize a una lista separada
 * por comas, que es lo que necesita un IN (...) y no un text[]: aqui viaja como
 * literal de array y se castea en la sentencia.
 */
export const toTextArray = (values:string[]) =>
  `{${values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
