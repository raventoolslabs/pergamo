import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import Config from '@/shared/config';
import { NotFoundError, ValidationError } from '@/domain/exceptions/domain.exception';
import {
  GitHubNotConfiguredError, GitHubNotConnectedError, GitHubUnavailableError
} from '@/domain/exceptions/github.exception';
import { GitHubEntry, GitHubFile, MARKDOWN_EXTENSIONS } from '@/domain/entities/github';
import { GitHubClient } from '@/app/ports/services/github.service';
import { githubSettingsRepository } from '@/infrastructure/db/repositories/github-settings.repository';

const REQUEST_TIMEOUT_MS = 60000;
const DOWNLOAD_TIMEOUT_MS = 300000;
const PAGE_SIZE = 100;
// GitHub pagina sin fin; el selector no necesita mas que esto.
const MAX_PAGES = 20;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 1000;

const sleep = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));

// 403 y 429 son la misma cosa aqui: cuota agotada o peticiones demasiado
// seguidas. Lo dice la cabecera, no el codigo.
const rateLimited = (response:Response) =>
  (response.status === 403 || response.status === 429) &&
  (response.headers.get('x-ratelimit-remaining') === '0' || !!response.headers.get('retry-after'));

const waitOf = (response:Response, attempt:number) => {

  const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '');
  if(Number.isFinite(retryAfter)) return Math.min(retryAfter * 1000, 60000);

  const reset = Number.parseInt(response.headers.get('x-ratelimit-reset') ?? '');
  if(Number.isFinite(reset)) return Math.min(Math.max(reset * 1000 - Date.now(), 0), 60000);

  return BACKOFF_MS * 2 ** (attempt - 1);
};

const credentialsOf = async (organization:string) => {

  const credentials = await githubSettingsRepository.credentials(organization);

  if(!credentials) throw new GitHubNotConfiguredError(
    `Organization ${organization} has no GitHub token configured`);

  return credentials;
};

/**
 * Espera acotada ante limites de cuota; agotada, GitHubUnavailableError. Los 404
 * se devuelven: que falte algo lo decide quien llama.
 */
const request = async (organization:string, pathAndQuery:string, accept:string, timeout = REQUEST_TIMEOUT_MS):Promise<Response> => {

  const { apiUrl, token } = await credentialsOf(organization);

  for(let attempt = 1; ; attempt++) {

    let response:Response;
    try {
      response = await fetch(`${apiUrl}${pathAndQuery}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'pergamo'
        },
        signal: AbortSignal.timeout(timeout)
      });
    } catch(error:any) {
      throw new GitHubUnavailableError(`GitHub request failed: ${error.message}`);
    }

    if(response.ok || response.status === 404) return response;

    // 401 es un token que no vale; 403 sin cuota agotada, uno sin permiso: los
    // dos se arreglan escribiendo otro, y ninguno se reintenta.
    if(response.status === 401 || (response.status === 403 && !rateLimited(response))) {
      throw new GitHubNotConnectedError(`GitHub rejected the token of organization ${organization}`);
    }

    if(rateLimited(response) && attempt < MAX_ATTEMPTS) {
      const wait = waitOf(response, attempt);
      await response.body?.cancel();
      await sleep(wait);
      continue;
    }

    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new GitHubUnavailableError(`GitHub answered ${response.status}: ${detail}`);
  }
};

const json = async (organization:string, pathAndQuery:string) => {

  const response = await request(organization, pathAndQuery, 'application/vnd.github+json');

  return response.status === 404 ? null : response.json() as Promise<any>;
};

// Paginado por pagina y no por Link: solo se listan repositorios y ramas.
async function* pages(organization:string, pathAndQuery:string):AsyncGenerator<any[]> {

  const separator = pathAndQuery.includes('?') ? '&' : '?';

  for(let page = 1; page <= MAX_PAGES; page++) {

    const body = await json(organization, `${pathAndQuery}${separator}per_page=${PAGE_SIZE}&page=${page}`);

    if(!Array.isArray(body) || !body.length) return;

    yield body;

    if(body.length < PAGE_SIZE) return;
  }
}

const segment = (value:string) => encodeURIComponent(value);

const isMarkdown = (filePath:string) => MARKDOWN_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

export const githubClient:GitHubClient = {

  async repositories(organization) {

    const entries:GitHubEntry[] = [];

    for await (const page of pages(organization, '/user/repos?sort=full_name&affiliation=owner,collaborator,organization_member')) {
      for(const repository of page) {
        entries.push({
          owner: repository.owner.login,
          repository: repository.name,
          defaultBranch: repository.default_branch,
          private: repository.private
        });
      }
    }

    return entries.sort((a, b) => `${a.owner}/${a.repository}`.localeCompare(`${b.owner}/${b.repository}`));
  },

  async branches(organization, owner, repository) {

    const branches:string[] = [];

    for await (const page of pages(organization, `/repos/${segment(owner)}/${segment(repository)}/branches`)) {
      for(const branch of page) branches.push(branch.name);
    }

    if(!branches.length) throw new NotFoundError('GITHUB_REPOSITORY_NOT_FOUND',
      `GitHub repository ${owner}/${repository} not found`);

    return branches.sort((a, b) => a.localeCompare(b));
  },

  async head(organization, owner, repository, branch) {

    const commit = await json(organization,
      `/repos/${segment(owner)}/${segment(repository)}/commits/${segment(branch)}`);

    if(!commit?.sha) throw new NotFoundError('GITHUB_BRANCH_NOT_FOUND',
      `GitHub branch ${branch} of ${owner}/${repository} not found`);

    return commit.sha as string;
  },

  /**
   * El arbol del commit de una vez: un recorrido por directorios serian cientos
   * de peticiones para un repositorio de documentacion.
   */
  async *walk(organization, owner, repository, commit) {

    // El enlace es a la web, no a la API: en Enterprise la sirve el mismo host
    // sin el /api/v3.
    const { apiUrl } = await credentialsOf(organization);
    const webUrl = apiUrl === 'https://api.github.com' ? 'https://github.com' : apiUrl.replace(/\/api\/v3$/, '');

    const tree = await json(organization,
      `/repos/${segment(owner)}/${segment(repository)}/git/trees/${segment(commit)}?recursive=1`);

    if(!tree) throw new NotFoundError('GITHUB_COMMIT_NOT_FOUND',
      `GitHub commit ${commit} of ${owner}/${repository} not found`);

    // Un arbol cortado listaria de menos, y el diff daria de baja lo que no
    // llego a ver: aborta el recorrido.
    // ponytail: recorrido por directorios si aparece un repositorio de mas de
    // 100.000 entradas, que es donde GitHub corta.
    if(tree.truncated) throw new GitHubUnavailableError(
      `GitHub truncated the tree of ${owner}/${repository}: the repository is too large to sync`);

    for(const entry of tree.tree as any[]) {

      if(entry.type !== 'blob' || !isMarkdown(entry.path)) continue;

      yield {
        path: entry.path,
        sha: entry.sha,
        size: entry.size ?? 0,
        viewLink: `${webUrl}/${owner}/${repository}/blob/${commit}/${entry.path.split('/').map(segment).join('/')}`
      };
    }
  },

  async download(organization, owner, repository, sha, target) {

    const response = await request(organization,
      `/repos/${segment(owner)}/${segment(repository)}/git/blobs/${segment(sha)}`,
      'application/vnd.github.raw', DOWNLOAD_TIMEOUT_MS);

    if(response.status === 404) return false;

    // El blob no declara tamano fiable: el tope se aplica mientras llega.
    let received = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(received > Config.max_file_size ?
          new ValidationError('FILE_TOO_LARGE', `GitHub blob ${sha} exceeds MAX_FILE_SIZE`) : null, chunk);
      }
    });

    await pipeline(Readable.fromWeb(response.body as any), limit, fs.createWriteStream(target));

    return true;
  }
};
