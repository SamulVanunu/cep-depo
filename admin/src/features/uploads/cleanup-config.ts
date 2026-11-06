// Budget chain (spec 7): the route's maxDuration (60s) bounds the run budget,
// the run budget bounds the batch, and the per-job budget stays below the
// lease so a job cannot outlive its own lease.
export const BATCH_LIMIT = 25;
export const RUN_BUDGET_MS = 20_000;
export const JOB_BUDGET_MS = 15_000;
export const STORAGE_CALL_TIMEOUT_MS = 5_000;
export const RPC_TIMEOUT_MS = 2_000;
// The tail of the run is reserved for the terminal write of a job that already
// started. The claim gate never begins a job that cannot fit in the remaining
// usable window.
export const FAIL_RESERVE_MS = RPC_TIMEOUT_MS;
export const USABLE_BUDGET_MS = RUN_BUDGET_MS - FAIL_RESERVE_MS;
export const LEASE_SECONDS = 120;
export const SWEEP_GRACE_MS = 86_400_000;
export const SWEEP_FOLDER_LIMIT = 1_000;
export const MAX_ATTEMPTS = 5;
