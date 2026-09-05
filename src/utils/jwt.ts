import fs from "fs";
import path from "path"
import jwt from 'jsonwebtoken';

import Config from "../config";
import { StatusCodes, ValidationError } from "../middleware/error.middleware";

const privateKey = fs.readFileSync(path.join(Config.path_base, '.key', 'private-key.pem'), 'utf8');
const publicKey = fs.readFileSync(path.join(Config.path_base, '.key', 'public-key.pem'), 'utf8');

const generateToken = (payload) => {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: Config.jwt_expires_in
  });
};

const verifyToken = async (token) => {
  try {
    return await jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  } catch(err) {
    throw new ValidationError(StatusCodes.UNAUTHORIZED, 'MALFORMED_TOKEN','Malformed token')
  }
};

export default{
  generateToken,
  verifyToken
}