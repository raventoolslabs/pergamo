---
name: write-code
description: Convenciones obligatorias al escribir o modificar codigo en Pergamo — codigo en ingles, comentarios en espanol y sinteticos — junto al flujo de git que envuelve la tarea (pull de development, rama de trabajo, push y PR). Usar SIEMPRE antes de crear o editar cualquier fichero de codigo, test, migracion, script o estilo, y al terminar la tarea.
---

# Escribir codigo en Pergamo

Dos partes, ambas obligatorias: el **flujo de git** que envuelve la tarea y las
**convenciones de escritura** que aplican a cada fichero que se toca.

## 1. Antes de escribir: preparar la rama

Nunca se escribe codigo sobre una rama desactualizada ni directamente sobre
`development` o `main`.

```bash
git fetch origin
git rev-parse --abbrev-ref HEAD          # en que rama estamos
```

**Si la rama actual es `development` o `main`** — hay que salir de ahi:

```bash
git checkout development
git pull --ff-only origin development
git checkout -b <tipo>/<descripcion-en-kebab-case>
```

**Si ya estamos en una rama de trabajo** — se actualiza contra development:

```bash
git pull --ff-only origin development     # o: git fetch origin && git rebase origin/development
```

Con cambios sin confirmar el pull falla. En ese caso: `git stash push -u`,
actualizar, y `git stash pop`. No se descarta trabajo ajeno sin preguntar.

Prefijos de rama: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`, `ci/`.

## 2. Mientras se escribe: convenciones

### El codigo, en ingles

Todo lo que es codigo va en ingles, sin excepcion:

- Variables, funciones, clases, componentes, tipos, interfaces, props y enums.
- Nombres de fichero y de directorio (`07-mobile.spec.ts`, no `07-movil.spec.ts`).
- Clases CSS y custom properties (`--parchment`, `.login__panel`).
- Rutas de la URL, claves de API, nombres de columna y de tabla.
- Mensajes de commit, titulos y descripciones de PR.
- Claves de traduccion, mensajes de log y textos de error internos.

### El texto de cara al usuario, en espanol y fuera del codigo

La interfaz de Pergamo esta en espanol. Ese texto no se escribe suelto en el
JSX: vive en el catalogo de traducciones (`web/src/i18n/`), con **clave en
ingles y valor en espanol**.

```tsx
// mal: literal incrustado
<button>Subir documento</button>

// bien: clave en ingles, traduccion en el catalogo
<button>{t('documents.upload')}</button>
```

### Los comentarios, en espanol y sinteticos

Se comenta el **porque**, nunca el **que**. Si el comentario se limita a
traducir a prosa la linea que tiene debajo, sobra.

```ts
// mal: repite lo que el codigo ya dice
// Incrementa el contador en uno
counter += 1;

// bien: explica una decision que el codigo no puede expresar
// Se cuentan los intentos por IP y no por cuenta: el ataque prueba muchas
// cuentas desde un mismo origen.
attempts.set(ip, attempts.get(ip) + 1);
```

Reglas concretas:

- **Una o dos lineas.** Un comentario que pasa de cuatro apunta a codigo que
  habria que dividir, o a documentacion que va en el README.
- **Nada de historia.** "antes esto fallaba porque...", "se cambio en la
  version X": eso es el trabajo de `git log`, no del fichero.
- **Nada de bloques decorativos** ni separadores de seccion.
- **Sin JSDoc redundante.** Si la firma tipada ya lo dice todo, no se anota;
  se reserva para lo que los tipos no capturan.
- **Sin comentarios obvios** sobre imports, returns triviales o getters.

Al editar un fichero se aplica tambien hacia atras: si al pasar por un
comentario se ve que es historia o parrafo redundante, se recorta.

### Markdown y skills, en espanol

Los `.md` del proyecto (README, documentacion, skills bajo `.claude/skills/`)
se escriben en espanol. Los identificadores que citan —comandos, rutas,
nombres de variable— se dejan tal cual estan en el codigo, en ingles.

## 3. Al terminar: subir y abrir PR

No se da una tarea por terminada con el trabajo solo en local.

```bash
npx tsc --noEmit                  # compila
npx jest                          # tests
git add -A && git commit
git push -u origin <rama>
```

Despues, PR **siempre contra `development`** (`main` es solo publicacion y
dispara la release):

```bash
gh pr list --head <rama> --state open        # comprobar si ya existe
gh pr create --base development --title "..." --body "..."
```

Si la PR ya existe, el push la actualiza: no se abre una segunda.

El titulo y el cuerpo de la PR van en ingles. El cuerpo explica que cambia y
por que, no enumera ficheros —el diff ya los lista.
