import fs from "fs";
import path from "path"
import jwt from 'jsonwebtoken';

import Config from "@/shared/config";
import { UnauthorizedError } from "@/domain/exceptions/domain.exception";
import { TokenPayload, TokenService } from "@/app/ports/services/token.service";

const privateKey = fs.readFileSync(path.join(Config.path_base, '.key', 'private-key.pem'), 'utf8');
const publicKey = fs.readFileSync(path.join(Config.path_base, '.key', 'public-key.pem'), 'utf8');

const generate = (payload:TokenPayload) => {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: Config.jwt_expires_in
  });
};

const verify = async (token:string):Promise<TokenPayload> => {
  try {
    return await jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as TokenPayload;
  } catch(err) {
    throw new UnauthorizedError('MALFORMED_TOKEN', 'Malformed token');
  }
};

export const jwtService:TokenService = { generate, verify };

export default jwtService;