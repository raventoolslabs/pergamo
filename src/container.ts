/**
 * Punto de composicion: el unico sitio donde las implementaciones concretas se
 * enchufan a los puertos.
 *
 * Existe porque los casos de uso reciben sus dependencias por parametro y no
 * pueden importarlas: `app` no conoce `infrastructure`. Aqui si, porque este
 * fichero no es una capa, es el cableado.
 */
import { DocumentDeps } from '@/app/use-cases/document/dependencies';
import { OrganizationDeps } from '@/app/use-cases/organization/dependencies';

import { documentRepository } from '@/infrastructure/db/repositories/document.repository';
import { organizationRepository } from '@/infrastructure/db/repositories/organization.repository';
import { sequelizeUnitOfWork } from '@/infrastructure/db/unit-of-work';
import { documentStorage } from '@/infrastructure/files/document-storage';
import { fileTypeVerifier } from '@/infrastructure/files/file-type.adapter';
import { activeContentDetector } from '@/infrastructure/antivirus/active-content.adapter';
import antivirus from '@/infrastructure/antivirus/clamav.service';
import { jwtService } from '@/infrastructure/security/jwt';

export const documentDeps:DocumentDeps = {
  documents: documentRepository,
  storage: documentStorage,
  scanner: antivirus,
  activeContent: activeContentDetector,
  fileType: fileTypeVerifier,
  unitOfWork: sequelizeUnitOfWork
};

export const organizationDeps:OrganizationDeps = {
  organizations: organizationRepository,
  tokens: jwtService
};
