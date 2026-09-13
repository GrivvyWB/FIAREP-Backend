import { NYCHA_DEVELOPMENT_NAMES } from "@workspace/api-client-react";

// Idempotent seeding is handled in lib/store.ts.
export const DEVELOPMENT_NAMES: string[] = [...NYCHA_DEVELOPMENT_NAMES];
