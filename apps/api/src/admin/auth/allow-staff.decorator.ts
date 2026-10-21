import { SetMetadata } from '@nestjs/common';

export const ALLOW_STAFF = 'admin:allow-staff';

/**
 * Lets the read-only 'staff' role use this write endpoint too (production floor work:
 * printing, tracking, notes). Decision for open issue A6.
 */
export const AllowStaff = () => SetMetadata(ALLOW_STAFF, true);
