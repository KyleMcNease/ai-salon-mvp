export type MemoryScope = 'global' | 'local-safe';

export const GLOBAL_SCOPE: MemoryScope = 'global';
export const LOCAL_SCOPE: MemoryScope = 'local-safe';
export const SAFE_MODE_PROVIDER = 'local';

export function deriveScope(isSafeMode: boolean): MemoryScope {
  return isSafeMode ? LOCAL_SCOPE : GLOBAL_SCOPE;
}

export function isLocalSafeScope(scope: unknown): boolean {
  return typeof scope === 'string' && scope.toLowerCase() === LOCAL_SCOPE;
}
