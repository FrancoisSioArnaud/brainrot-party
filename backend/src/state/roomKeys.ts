export const roomMetaKey = (code: string) => `brp:room:${code}:meta`;
export const roomStateKey = (code: string) => `brp:room:${code}:state`;

// If present, setup is irrevocably locked for that room.
export const roomSetupLockKey = (code: string) => `brp:room:${code}:setup_lock`;
