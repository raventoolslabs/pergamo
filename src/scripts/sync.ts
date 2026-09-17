import Config from '@/shared/config';
import log from '@/shared/logger';
import sequelize from '@/infrastructure/db/client';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { driveDeps } from '@/container';
import { syncDriveFolder } from '@/app/use-cases/drive/commands/sync-drive-folder.handler';

/**
 * Sincroniza ahora las carpetas de Drive, en este proceso y sin cola: sirve sin
 * worker y para ver en consola que pasa. `npm run sync -- <organizacion>` limita
 * a una organizacion.
 *
 * Una carpeta que falla no para las demas: su error queda en la carpeta.
 */
const sync = async () => {

  if(!Config.drive.enabled) throw new Error('DRIVE_ENABLED is not enabled: there is nothing to sync');

  const organization = process.argv[2];
  const folders = (await driveDeps.folders.listAll())
    .filter((folder) => !organization || folder.organization === organization);

  let failed = 0;

  for(const folder of folders) {
    try {
      const progress = await syncDriveFolder({ organization: folder.organization, folder: folder.id, trace: 'sync' }, driveDeps);
      log.info(`Folder "${folder.name}" (${folder.organization}): ${JSON.stringify(progress)}`);
    } catch(error:any) {
      failed++;
      log.error(`Folder "${folder.name}" (${folder.organization}) failed: ${error.message}`);
    }
  }

  log.info(`Sync finished: ${folders.length} folder(s), ${failed} failed`);

  return failed;
};

sync()
  .then(async (failed) => {
    await indexQueue.close();
    await sequelize.close();
    process.exit(failed ? 1 : 0);
  })
  .catch(async (error:any) => {
    log.error(`Sync failed: ${error.message}`);
    await indexQueue.close().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
