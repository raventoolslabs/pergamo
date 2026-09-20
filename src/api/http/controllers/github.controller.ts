import { StatusCodes } from 'http-status-codes';

import { githubDeps as deps } from '@/container';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { formatIssues } from '@/shared/validation';
import {
  githubBranchesQuerySchema, githubExcludesBodySchema, githubRepositoryBodySchema, githubSettingsBodySchema,
  toGitHubEntryResponse, toGitHubRepositoryResponse, toGitHubSettingsResponse, toGitHubSyncResponse
} from '@/api/http/dto/github.dto';
import { saveGitHubSettings } from '@/app/use-cases/github/commands/save-github-settings.handler';
import { removeGitHubSettings } from '@/app/use-cases/github/commands/remove-github-settings.handler';
import { addGitHubRepository } from '@/app/use-cases/github/commands/add-github-repository.handler';
import { removeGitHubRepository } from '@/app/use-cases/github/commands/remove-github-repository.handler';
import { updateGitHubExcludes } from '@/app/use-cases/github/commands/update-github-excludes.handler';
import { startGitHubSync } from '@/app/use-cases/github/commands/start-github-sync.handler';
import { getGitHubSettings } from '@/app/use-cases/github/queries/get-github-settings.handler';
import { listGitHubRepositories } from '@/app/use-cases/github/queries/list-github-repositories.handler';
import { getGitHubSync } from '@/app/use-cases/github/queries/get-github-sync.handler';
import { browseGitHub, listGitHubBranches } from '@/app/use-cases/github/queries/browse-github.handler';

const trace = (req:any) => `${req.method} ${req.originalUrl} - ${req.id}`;

const parse = <T>(schema:{ safeParse:(value:unknown) => any }, value:unknown, code:string):T => {
  const result = schema.safeParse(value);
  if(!result.success) throw new ValidationError(code, formatIssues(result.error));
  return result.data;
};

const settings = async (req, res, next) => {
  try {
    res.status(StatusCodes.OK).json(toGitHubSettingsResponse(await getGitHubSettings(req.user.organization, deps)));
  } catch (error) {
    next(error);
  }
};

const saveSettings = async (req, res, next) => {
  try {
    const body = parse<{ api_url?:string | null; token?:string | null }>(
      githubSettingsBodySchema, req.body, 'INVALID_BODY');
    const saved = await saveGitHubSettings({
      organization: req.user.organization,
      apiUrl: body.api_url ?? null,
      // Sin la comprobacion de la clave, «quitar» y «mantener» llegan aqui
      // igual: zod deja los dos en undefined al desestructurar.
      token: 'token' in body ? body.token : undefined
    }, deps);
    res.status(StatusCodes.OK).json(toGitHubSettingsResponse(saved));
  } catch (error) {
    next(error);
  }
};

const removeSettings = async (req, res, next) => {
  try {
    await removeGitHubSettings(req.user.organization, deps);
    res.status(StatusCodes.NO_CONTENT).end();
  } catch (error) {
    next(error);
  }
};

const browse = async (req, res, next) => {
  try {
    const entries = await browseGitHub(req.user.organization, deps);
    res.status(StatusCodes.OK).json(entries.map(toGitHubEntryResponse));
  } catch (error) {
    next(error);
  }
};

const branches = async (req, res, next) => {
  try {
    const query = parse<{ owner:string; repository:string }>(githubBranchesQuerySchema, req.query, 'INVALID_QUERY');
    res.status(StatusCodes.OK).json(await listGitHubBranches(req.user.organization, query.owner, query.repository, deps));
  } catch (error) {
    next(error);
  }
};

const repositories = async (req, res, next) => {
  try {
    res.status(StatusCodes.OK).json(
      (await listGitHubRepositories(req.user.organization, deps)).map(toGitHubRepositoryResponse));
  } catch (error) {
    next(error);
  }
};

const addRepository = async (req, res, next) => {
  try {
    const body = parse<{ owner:string; repository:string; branch:string; index:boolean; store_content:boolean; excludes:string[] }>(
      githubRepositoryBodySchema, req.body, 'INVALID_BODY');
    const repository = await addGitHubRepository({
      organization: req.user.organization,
      owner: body.owner,
      repository: body.repository,
      branch: body.branch,
      index: body.index,
      storeContent: body.store_content,
      excludes: body.excludes,
      trace: trace(req)
    }, deps);
    res.status(StatusCodes.CREATED).json(toGitHubRepositoryResponse(repository));
  } catch (error) {
    next(error);
  }
};

const updateRepository = async (req, res, next) => {
  try {
    const body = parse<{ excludes:string[] }>(githubExcludesBodySchema, req.body, 'INVALID_BODY');
    const repository = await updateGitHubExcludes({
      organization: req.user.organization,
      repository: req.params.id,
      excludes: body.excludes,
      trace: trace(req)
    }, deps);
    res.status(StatusCodes.OK).json(toGitHubRepositoryResponse(repository));
  } catch (error) {
    next(error);
  }
};

const removeRepository = async (req, res, next) => {
  try {
    await removeGitHubRepository(req.user.organization, req.params.id, deps);
    res.status(StatusCodes.NO_CONTENT).end();
  } catch (error) {
    next(error);
  }
};

const startSync = async (req, res, next) => {
  try {
    res.status(StatusCodes.ACCEPTED).json(
      toGitHubSyncResponse(await startGitHubSync(req.user.organization, req.params.id, deps)));
  } catch (error) {
    next(error);
  }
};

const syncState = async (req, res, next) => {
  try {
    res.status(StatusCodes.OK).json(
      toGitHubSyncResponse(await getGitHubSync(req.user.organization, req.params.id, deps)));
  } catch (error) {
    next(error);
  }
};

export {
  addRepository, branches, browse, removeRepository, removeSettings,
  repositories, saveSettings, settings, startSync, syncState, updateRepository
};
