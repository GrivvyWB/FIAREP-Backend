export type InstallationPersona = 'resident' | 'vendor' | 'staff';

export function inferInstallationPersona(
  savedMode: string | null | undefined,
  sessionRole?: string | null,
): InstallationPersona | null {
  const evidence = [savedMode, sessionRole].filter((value): value is string => !!value);
  if (evidence.includes('resident')) return 'resident';
  if (evidence.includes('vendor')) return 'vendor';
  if (evidence.length) return 'staff';
  return null;
}

export function isModeAllowedForPersona(
  persona: InstallationPersona,
  mode: string,
): boolean {
  if (persona === 'resident') return mode === 'resident';
  if (persona === 'vendor') return mode === 'vendor';
  return mode !== 'resident' && mode !== 'vendor' && mode !== 'procurement';
}