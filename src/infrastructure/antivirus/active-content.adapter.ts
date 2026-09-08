import { ActiveContentDetector } from '@/app/ports/services/document-scanner.service';
import { activeContentSignature, detectActiveContent } from '@/infrastructure/antivirus/active-content';

export const activeContentDetector:ActiveContentDetector = {
  detect: (filePath, mimetype) => detectActiveContent(filePath, mimetype),
  signature: (markers) => activeContentSignature(markers)
};
