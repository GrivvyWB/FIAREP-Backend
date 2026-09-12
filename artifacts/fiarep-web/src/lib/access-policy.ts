export type Persona = 'resident' | 'vendor' | 'staff' | null;

export interface AccessEvaluation {
  redirect?: string;
  setPersona?: 'staff' | 'resident' | 'vendor';
  clearAuth?: boolean;
}

export function evaluateAccess(
  persona: Persona,
  path: string,
  isAuthenticated: boolean
): AccessEvaluation {
  const isProcurement = path === '/procurement' || path.startsWith('/procurement/');

  if (!persona) {
    if (isAuthenticated) {
      return { setPersona: 'staff' };
    }
    if (isProcurement) {
      return { setPersona: 'staff' };
    }
    if (path !== '/') {
      return { redirect: '/' };
    }
    return {};
  }

  if (persona === 'resident') {
    if (isAuthenticated) {
      return { clearAuth: true };
    }
    if (path !== '/resident') {
      return { redirect: '/resident' };
    }
    return {};
  }

  if (persona === 'vendor') {
    if (isAuthenticated) {
      return { clearAuth: true };
    }
    if (path !== '/vendor') {
      return { redirect: '/vendor' };
    }
    return {};
  }

  if (persona === 'staff') {
    if (path === '/' || path === '/resident' || path === '/vendor') {
      return { redirect: isAuthenticated ? '/dashboard' : '/login' };
    }
    return {};
  }

  return {};
}

export const PERSONA_KEY = 'fiarep_persona';

export function choosePersona(
  existing: Persona,
  requested: Exclude<Persona, null>,
): Exclude<Persona, null> {
  return existing || requested;
}

export function getStoredPersona(): Persona {
  try {
    const p = localStorage.getItem(PERSONA_KEY);
    if (p === 'resident' || p === 'vendor' || p === 'staff') return p as Persona;
  } catch (e) {
    // ignore
  }
  return null;
}

export function setStoredPersona(persona: Exclude<Persona, null>): Persona {
  try {
    const chosen = choosePersona(getStoredPersona(), persona);
    localStorage.setItem(PERSONA_KEY, chosen);
    return chosen;
  } catch {
    return null;
  }
}
