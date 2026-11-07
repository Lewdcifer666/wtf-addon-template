// Finite transport waits, not worker execution or authorization grants.
// GitHub workers retain their five-minute execution bound; health and
// interpretation reads keep the short request budget.
export const PRIVATE_REQUEST_MS=22000;
export const RESEARCH_REQUEST_MS=330000;
export const RESEARCH_RESULT_WAIT_MS=300000;
// Return an authenticated pending result before short-lived cloud clients
// abandon the HTTP call. The saved task's existing three identical read-backs
// can then observe the SAME five-minute worker, without a second execution.
export const RESEARCH_CALL_SLICE_MS=90000;
export const RESEARCH_POLL_SLICE_MS=75000;
export const GATEWAY_REQUEST_MS=30000;
export const GATEWAY_RESEARCH_MS=360000;
export const researchToolNames=new Set(['private_research_open','private_research_context','private_research_search','private_research_verify']);
