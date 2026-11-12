import { ApplicationError } from './ApplicationError';

// The OAuth sign-up form repeats the password to prevent accidental typos.
// This is password confirmation, not two-factor authentication.
export class RegistrationCredentials {
  static confirm(password: string, confirmation: string): void {
    if (!confirmation) {
      throw new ApplicationError(400, 'confirmation_required', 'Confirm your password before creating an account.');
    }

    if (confirmation !== password) {
      throw new ApplicationError(400, 'password_mismatch', 'Passwords do not match. Please try again.');
    }
  }
}
