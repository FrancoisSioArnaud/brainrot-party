export const roomMetaKey = (code: string) => `brp:room:${code}:meta`;
export const roomStateKey = (code: string) => `brp:room:${code}:state`;

// Atomic lock for POST /room/:code/setup.
// If this key exists, the setup is considered irrevocably locked for that room.
export const roomSetupLockKey = (code: string) => `brp:room:${code}:setup_lock`;
