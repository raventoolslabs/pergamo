import Config from '@/shared/config';
import log from '@/shared/logger';
import sequelize from '@/infrastructure/db/client';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { driveDeps, githubDeps } from '@/container';
import { syncDriveFolder } from '@/app/use-cases/drive/commands/sync-drive-folder.handler';
import { syncGitHubRepository } from '@/app/use-cases/github/commands/sync-github-repository.handler';

/**
 * Sincroniza ahora las carpetas de Drive y los repositorios de GitHub, en este
 * proceso y sin cola: sirve sin worker y para ver en consola que pasa.
 * `npm run sync -- <organizacion>` limita a una organizacion.
 *
 * Un origen que falla no para los demas: su error queda apuntado en el.
 */
const sync = async () => {

  if(!Config.drive.enabled && !Config.github.enabled) throw new Error(
    'Neither DRIVE_ENABLED nor GITHUB_ENABLED is enabled: there is nothing to sync');

  const organization = process.argv[2];
  const mine = (source:{ organization:string }) => !organization || source.organization === organization;

  const folders = Config.drive.enabled ? (await driveDeps.folders.listAll()).filter(mine) : [];
  const repositories = Config.github.enabled ? (await githubDeps.repositories.listAll()).filter(mine) : [];

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

  for(const repository of repositories) {
    try {
      const progress = await syncGitHubRepository(
        { organization: repository.organization, repository: repository.id, trace: 'sync' }, githubDeps);
      log.info(`Repository "${repository.name}@${repository.branch}" (${repository.organization}): ${JSON.stringify(progress)}`);
    } catch(error:any) {
      failed++;
      log.error(`Repository "${repository.name}@${repository.branch}" (${repository.organization}) failed: ${error.message}`);
    }
  }

  log.info(`Sync finished: ${folders.length} folder(s), ${repositories.length} repository(ies), ${failed} failed`);

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
