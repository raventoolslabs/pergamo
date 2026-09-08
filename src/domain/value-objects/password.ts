import owasp from 'owasp-password-strength-test';

import { ValidationError } from '@/domain/exceptions/domain.exception';

owasp.config({
  allowPassphrases: true,
  maxLength: 128,
  minLength: 10,
  minPhraseLength: 20,
  minOptionalTestsToPass: 4
});

export const assertPasswordStrength = (password:string) => {

  const result = owasp.test(password);

  if(result.errors?.length) throw new ValidationError('INVALID_PASSWORD', result.errors[0]);
}
