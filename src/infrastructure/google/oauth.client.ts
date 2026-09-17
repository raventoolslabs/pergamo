import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

import Config from '@/shared/config';
import { UnauthorizedError } from '@/domain/exceptions/domain.exception';
import { DriveNotConfiguredError, DriveNotConnectedError, DriveUnavailableError } from '@/domain/exceptions/drive.exception';
import { DRIVE_SCOPE } from '@/domain/entities/drive';
import { DriveGrant } from '@/app/ports/services/drive.service';
import { DriveCredentials } from '@/app/ports/repositories/drive-settings.repository';
import { driveConnectionRepository } from '@/infrastructure/db/repositories/drive-connection.repository';
import { driveSettingsRepository } from '@/infrastructure/db/repositories/drive-settings.repository';
import { open, seal } from '@/infrastructure/security/secret-box';

// email identifica la cuenta conectada.
const SCOPES = [DRIVE_SCOPE, 'openid', 'email'];
const STATE_TTL_MS = 10 * 60 * 1000;

interface State {
  organization: string;
  verifier: string;
  exp: number;
}

// Las credenciales son de la organizacion; la URL de retorno es del despliegue,
// la misma para todas, y cada una la registra en su proyecto de Google.
const newClient = (credentials:DriveCredentials) => new OAuth2Client({
  clientId: credentials.clientId,
  clientSecret: credentials.clientSecret,
  redirectUri: Config.drive.redirect_uri
});

const credentialsOf = async (organization:string):Promise<DriveCredentials> => {

  const credentials = await driveSettingsRepository.credentials(organization);

  if(!credentials) throw new DriveNotConfiguredError(
    `Organization ${organization} has no Google Drive OAuth client configured`);

  return credentials;
};

/**
 * El state es un sobre sellado: infalsificable sin SECRET_KEY y con caducidad,
 * asi que no hace falta guardar sesiones. El verificador PKCE viaja dentro.
 */
export const authUrl = async (organization:string) => {

  const client = newClient(await credentialsOf(organization));
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state:State = { organization, verifier: codeVerifier, exp: Date.now() + STATE_TTL_MS };

  return client.generateAuthUrl({
    scope: SCOPES,
    // offline y consent: sin ellos Google no entrega refresh_token al reconectar.
    access_type: 'offline',
    prompt: 'consent',
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
    state: seal(JSON.stringify(state))
  });
};

const readState = (sealed:string):State => {

  try {
    const state:State = JSON.parse(open(sealed));
    if(state.exp > Date.now() && state.organization && state.verifier) return state;
  } catch {
    // Manipulado, de otra clave o ilegible: se trata igual que caducado.
  }

  throw new UnauthorizedError('DRIVE_STATE_INVALID', 'Drive authorization state is invalid or expired');
};

export const exchange = async (sealedState:string, code:string):Promise<DriveGrant> => {

  const state = readState(sealedState);
  const client = newClient(await credentialsOf(state.organization));

  let tokens;
  try {
    ({ tokens } = await client.getToken({ code, codeVerifier: state.verifier }));
  } catch(error:any) {
    throw new UnauthorizedError('DRIVE_GRANT_INVALID', `Google rejected the authorization code: ${error.message}`);
  }

  if(!tokens.refresh_token) {
    throw new UnauthorizedError('DRIVE_GRANT_INVALID', 'Google did not return a refresh token');
  }

  const info = await client.getTokenInfo(tokens.access_token);

  return {
    organization: state.organization,
    googleAccount: info.email ?? 'unknown',
    sealedRefreshToken: seal(tokens.refresh_token),
    scope: tokens.scope ?? SCOPES.join(' ')
  };
};

/**
 * Un cliente por organizacion: cachea el access_token y lo renueva solo. La
 * huella lleva el token sellado y la fecha de las credenciales, asi que
 * reconectar o rotar el cliente OAuth lo rehacen sin que nadie avise.
 *
 * Se comprueba al leer y no con un aviso desde el caso de uso porque el worker
 * puede vivir en otro proceso: no lo recibiria, y seguiria sincronizando con el
 * secreto viejo hasta reiniciar.
 */
const clients = new Map<string, { fingerprint:string; client:OAuth2Client }>();

export const accessToken = async (organization:string):Promise<string> => {

  const sealed = await driveConnectionRepository.sealedRefreshToken(organization);

  if(!sealed) throw new DriveNotConnectedError(`Organization ${organization} has no Drive connection`);

  // Antes de mirar las credenciales: una SECRET_KEY rotada invalida la conexion
  // pase lo que pase con ellas, y eso es lo que hay que contar.
  let refreshToken:string;
  try {
    refreshToken = open(sealed);
  } catch {
    clients.delete(organization);
    await driveConnectionRepository.markRevoked(organization);
    throw new DriveNotConnectedError(`Drive token of organization ${organization} was sealed with another SECRET_KEY`);
  }

  const credentials = await credentialsOf(organization);
  const fingerprint = `${sealed}|${credentials.modificationDate.getTime()}`;

  let cached = clients.get(organization);

  if(!cached || cached.fingerprint !== fingerprint) {
    const client = newClient(credentials);
    client.setCredentials({ refresh_token: refreshToken });
    cached = { fingerprint, client };
    clients.set(organization, cached);
  }

  try {
    const { token } = await cached.client.getAccessToken();
    return token;
  } catch(error:any) {

    // invalid_grant: el usuario retiro el permiso o Google caduco el token.
    if(error?.response?.data?.error === 'invalid_grant') {
      clients.delete(organization);
      await driveConnectionRepository.markRevoked(organization);
      throw new DriveNotConnectedError(`Drive access revoked for organization ${organization}`);
    }

    throw new DriveUnavailableError(`Could not refresh the Drive token: ${error.message}`);
  }
};

// Tras un 401 de la API: el token cacheado ya no sirve.
export const forget = (organization:string) => clients.delete(organization);
