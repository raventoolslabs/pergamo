import Config from '@/shared/config';
import { ValidationError } from '@/domain/exceptions/domain.exception';

export const assertDriveEnabled = () => {
  if(!Config.drive.enabled) throw new ValidationError('DRIVE_DISABLED', 'This deployment has no Google Drive integration');
};
