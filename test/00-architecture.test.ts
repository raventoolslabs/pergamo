import fs from 'fs';
import path from 'path';

/**
 * La regla de dependencias de la skill ddd-architecture, comprobada. Un import
 * prohibido no rompe la compilacion ni ninguna otra prueba: sin esto, la
 * arquitectura se erosiona sin que nada avise.
 */

const SRC = path.join(__dirname, '..', 'src');

// Fuera de las capas: cablean implementaciones concretas, que es su trabajo.
const COMPOSITION = ['container.ts', 'server.ts', 'index.ts', 'init.ts', 'worker.ts'];

const FORBIDDEN:Record<string, string[]> = {
  domain: ['api', 'app', 'infrastructure'],
  app: ['api', 'infrastructure'],
  infrastructure: ['api'],
  api: ['infrastructure']
};

const sources = (directory:string):string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if(entry.isDirectory()) return sources(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });

const importsOf = (file:string) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]@\/([^/'"]+)\/?/g)].map((match) => match[1]);

describe('Layer dependencies', () => {

  const files = sources(SRC).filter((file) => !COMPOSITION.includes(path.relative(SRC, file)));

  it('Should not have any file outside a layer or the composition root', () => {

    const stray = files
      .map((file) => path.relative(SRC, file))
      .filter((file) => !['api', 'app', 'domain', 'infrastructure', 'shared', 'scripts'].includes(file.split(path.sep)[0]));

    expect(stray).toEqual([]);
  });

  it.each(Object.keys(FORBIDDEN))('Should not import forbidden layers from %s', (layer) => {

    const offences = files
      .filter((file) => path.relative(SRC, file).startsWith(`${layer}${path.sep}`))
      .flatMap((file) => importsOf(file)
        .filter((target) => FORBIDDEN[layer].includes(target))
        .map((target) => `${path.relative(SRC, file)} -> @/${target}`));

    expect(offences).toEqual([]);
  });

  /**
   * Ni el dominio ni los casos de uso abren ficheros: lo que necesiten pasa por
   * un puerto. Es la unica dependencia de infraestructura que no se ve en un
   * import de @/, y por eso se comprueba aparte.
   *
   * `path` no cuenta: manipular una cadena de ruta no es tocar el disco.
   */
  it('Should not touch the filesystem from domain or app', () => {

    const offences = files
      .filter((file) => ['domain', 'app'].includes(path.relative(SRC, file).split(path.sep)[0]))
      .filter((file) => /from\s+['"](fs|fs\/promises|fs-extra)['"]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(offences).toEqual([]);
  });

  // La excepcion que define un adaptador: implementa una interfaz declarada en
  // app/ports. Cualquier otra entrada en app/ desde infrastructure esta mal.
  it('Should only reach app/ports from infrastructure', () => {

    const offences = files
      .filter((file) => path.relative(SRC, file).startsWith(`infrastructure${path.sep}`))
      .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/from\s+['"](@\/app\/[^'"]+)['"]/g)]
        .map((match) => match[1])
        .filter((target) => !target.startsWith('@/app/ports'))
        .map((target) => `${path.relative(SRC, file)} -> ${target}`));

    expect(offences).toEqual([]);
  });
});
