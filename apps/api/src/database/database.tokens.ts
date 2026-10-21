/** Injection tokens. Kept free of runtime imports so services can be built in tests without env config. */
export const DATABASE = Symbol('DATABASE');
export const DATABASE_POOL = Symbol('DATABASE_POOL');
