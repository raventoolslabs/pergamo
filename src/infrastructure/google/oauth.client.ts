import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

import Config from '@/shared/config';
import { UnauthorizedError } from '@/domain/exceptions/domain.exception';
import { DriveNotConnectedError, DriveUnavailableError } from '@/domain/exceptions/drive.exception';
import { DriveGrant } from '@/app/ports/services/drive.service';
import { driveConnectionRepository } from '@/infrastructure/db/repositories/drive-connection.repository';
import { open, seal } from '@/infrastructure/security/secret-box';

// Solo lectura: Pergamo nunca escribe en Drive. email identifica la cuenta conectada.
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'openid', 'email'];
const STATE_TTL_MS = 10 * 60 * 1000;

interface State {
  organization: string;
  verifier: string;
  exp: number;
}

const newClient = () => new OAuth2Client({
  clientId: Config.drive.client_id,
  clientSecret: Config.drive.client_secret,
  redirectUri: Config.drive.redirect_uri
});

/**
 * El state es un sobre sellado: infalsificable sin SECRET_KEY y con caducidad,
 * asi que no hace falta guardar sesiones. El verificador PKCE viaja dentro.
 */
export const authUrl = async (organization:string) => {

  const client = newClient();
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
  const client = newClient();

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

// Un cliente por organizacion: cachea el access_token y lo renueva solo. Se
// rehace si el token sellado cambia, que es lo que pasa al reconectar.
const clients = new Map<string, { sealed:string; client:OAuth2Client }>();

export const accessToken = async (organization:string):Promise<string> => {

  const sealed = await driveConnectionRepository.sealedRefreshToken(organization);

  if(!sealed) throw new DriveNotConnectedError(`Organization ${organization} has no Drive connection`);

  let cached = clients.get(organization);

  if(!cached || cached.sealed !== sealed) {
    const client = newClient();
    client.setCredentials({ refresh_token: open(sealed) });
    cached = { sealed, client };
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
