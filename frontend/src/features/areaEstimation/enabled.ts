/**
 * Area estimation is off until its backend exists: every call in `api.ts` still
 * answers from fixtures and keeps plans in the browser. While off, no entry point
 * shows it and no task set is treated as belonging to an estimate.
 */
export const AREA_ESTIMATION_ENABLED = false;
