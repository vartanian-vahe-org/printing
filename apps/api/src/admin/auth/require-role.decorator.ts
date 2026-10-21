import { SetMetadata } from '@nestjs/common';
import type { StaffIdentity } from './session.service.js';

export const REQUIRED_ROLES = 'admin:roles';

/** Only these roles may call the endpoint, reads included (e.g. staff accounts: owner only). */
export const RequireRole = (...roles: StaffIdentity['role'][]) => SetMetadata(REQUIRED_ROLES, roles);
