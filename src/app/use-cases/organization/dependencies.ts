import { OrganizationRepository } from '@/app/ports/repositories/organization.repository';
import { TokenService } from '@/app/ports/services/token.service';

export interface OrganizationDeps {
  organizations: OrganizationRepository;
  tokens: TokenService;
}
