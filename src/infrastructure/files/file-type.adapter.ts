import { FileTypeVerifier } from '@/app/ports/services/file-type.service';
import { verifyMimetype } from '@/infrastructure/files/filetype';

export const fileTypeVerifier:FileTypeVerifier = {
  verify: (filePath, mimetype) => verifyMimetype(filePath, mimetype)
};
