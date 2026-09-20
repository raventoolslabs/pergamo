import { DriveDeps } from '../dependencies';
import { assertDriveEnabled } from '../drive-enabled';

// Los mismos que la sincronizacion. Importarlos de alli acoplaria dos casos de
// uso por una constante.
const PAGE_SIZE = 1000;
const DISCHARGE_BATCH = 500;

const liveDocuments = async (organization:string, deps:DriveDeps):Promise<string[]> => {

  const live:string[] = [];

  for(let afterId:string = null; ;) {

    const page = await deps.documents.listRemoteState(organization, 'drive', afterId, PAGE_SIZE);

    page.forEach((state) => { if(!state.discharged) live.push(state.id); });

    if(page.length < PAGE_SIZE) return live;
    afterId = page[page.length - 1].id;
  }
};

/**
 * Desmonta Drive en la organizacion: baja de lo importado, carpetas, conexion y
 * cliente. El binario nunca estuvo aqui —vive en Drive—, asi que conservar la
 * ficha de un documento que ya no se puede descargar no serviria de nada.
 *
 * La baja es logica: id y metadatos se conservan, y volver a conectar y
 * sincronizar revive cada documento con su mismo id.
 *
 * El orden importa. Las credenciales se borran al final para que un fallo a
 * mitad deje la conexion en pie y el desmontaje se pueda repetir.
 */
export const disconnectDrive = async (organization:string, deps:DriveDeps):Promise<void> => {

  assertDriveEnabled();

  const live = await liveDocuments(organization, deps);

  for(let start = 0; start < live.length; start += DISCHARGE_BATCH) {

    const batch = live.slice(start, start + DISCHARGE_BATCH);

    await deps.unitOfWork.run(async (scope) => {
      for(const id of batch) await deps.chunks.deleteByDocument(id, scope);
      await deps.documents.discharge(organization, batch, scope);
    });
  }

  // Sin retirar el planificador, Redis seguiria encolando pasadas de una carpeta
  // que ya no existe.
  for(const folder of await deps.folders.list(organization)) {
    await deps.syncQueue.unschedule(organization, folder.id);
    await deps.folders.remove(organization, folder.id);
  }

  await deps.connections.remove(organization);
  await deps.settings.remove(organization);
}
