# Corpus de PDF con contenido activo

Los once ficheros de este directorio proceden de [PayloadsAllThePDFs](https://github.com/luigigubello/PayloadsAllThePDFs) (Luigi Gubello, Apache-2.0), copiados de `pdf-payloads/` sin modificar un solo byte. Son PDF **estructuralmente validos** que llevan dentro JavaScript, anotaciones, URI `data:`, ficheros embebidos y formularios pensados para atacar al *visor* que los abre: XSS en los visores web, apertura de `calc.exe` en Acrobat, exfiltracion por formulario.

## Por que estan aqui

Pergamo tiene tres puertas de entrada y este corpus las cruza las tres:

- La **verificacion de contenido** (`utils/filetype.ts`) los acepta, y debe hacerlo: son PDF de verdad. No es un fallo, es la delimitacion de lo que esa comprobacion promete —que el contenido corresponde al mimetype declarado— y de lo que no promete —que el contenido sea inofensivo.
- El **antivirus** los ve enteros por INSTREAM. Lo que decida ClamAV con ellos es el dato que este corpus fija por escrito.
- El **filtro de contenido activo** (`utils/activecontent.ts`) es la capa que este corpus motivo, y su cobertura se mide aqui.

## Que detecta cada capa

Medido con `clamscan` 1.4.3, base de firmas 28116 (7 de septiembre de 2026), con y sin `--detect-pua`, y con el filtro de contenido activo de este repositorio:

| Fichero | ClamAV | Contenido activo |
| --- | --- | --- |
| `payload1.pdf` | `Html.Exploit.CVE_2016_3198-1` | JavaScript, OpenAction |
| `foxit-reader-poc`, `payload2`–`payload7`, `payload9`, `starter_pack` | limpio | JavaScript y OpenAction / AdditionalAction |
| `payload8.pdf` | limpio | FontMatrix |

**Diez de los once pasaban el antivirus.** No es un defecto de la instalacion: ClamAV busca firmas de codigo malicioso conocido, y un `/OpenAction` con `app.alert()` o un `/URI (javascript:...)` no lo es. Quien reciba estos documentos desde Pergamo y los abra en un visor vulnerable se lleva el ataque igual, y ninguna casilla de configuracion de clamd cambia eso.

## Que hace Pergamo con ellos

Las dos capas tienen politicas distintas a proposito:

- **Firma antivirica** (`payload1.pdf`): la subida se rechaza con un `400` y el fichero no llega a depositarse.
- **Contenido activo** (los otros diez): el documento **entra en el archivo y queda en cuarentena** (`scan_status = 'malicious'`). Se guarda, no se entrega —`423`— y no lo libera un reescaneo: `npm run rescan` excluye esas filas a proposito, porque un barrido las encontraria limpias y liberaria en lote lo que se decidio retener. La unica salida es `npm run scan:release -- <id>`, es decir, una persona que ha mirado el documento.

`payload8.pdf` es el que conviene mirar dos veces: no lleva `/JavaScript` ni `/OpenAction`, inyecta el codigo dentro de un array `/FontMatrix` contra el parser del propio visor (pdf.js, CVE-2024-4367). Lo retiene la regla `FontMatrix`, que no condena la clave —la lleva cualquier tipografia Type1 o Type3— sino su valor: seis numeros y nada mas. `test/assets/font-matrix-numbers.pdf` es la otra mitad de esa prueba, una Type3 corriente que no se retiene.

Que hiciera falta una regla nueva para verlo es la medida honesta de lo que cubre esta capa: reglas sobre bytes, sin parser —que el proyecto evita a proposito, porque seria superficie de ataque en la ruta de subida—, asi que **descarta contenido activo conocido, no certifica que un documento sea inofensivo**. La via siguiente tampoco se vera hasta que alguien la escriba aqui.

La defensa que no depende de ninguna capa es la de siempre: no renderizar nunca un documento del archivo dentro de la propia interfaz, servirlo solo como `attachment` con `X-Content-Type-Options: nosniff` —que es lo que hace `getFile`— y dejar que el visor de destino sea cosa de quien descarga.

## Cuidado al clonar

`payload1.pdf` tiene firma en ClamAV: un antivirus con vigilancia en tiempo real puede borrarlo o poner el directorio de trabajo en cuarentena al clonar el repositorio. Si falta un fichero, la prueba lo dice por su nombre en lugar de fallar de forma incomprensible.
