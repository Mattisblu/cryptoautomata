/*
  Deployment smoke test for proposal lifecycle endpoints.

  Validates:
  1) create pending proposal via async agent trade
  2) approve path marks status approved and returns success
  3) create another pending proposal
  4) reject path marks status rejected
*/

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5000';
const TIMEOUT_MS = Number(process.env.PROPOSAL_TIMEOUT_MS || 60000);
const POLL_MS = Number(process.env.PROPOSAL_POLL_MS || 3000);
const RETRY_ATTEMPTS = Number(process.env.PROPOSAL_RETRY_ATTEMPTS || 3);
const APPROVE_REQUEST_TIMEOUT_MS = Number(process.env.APPROVE_REQUEST_TIMEOUT_MS || 15000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getProposals() {
  const res = await fetch(`${BASE_URL}/api/agent/proposals`);
  if (!res.ok) throw new Error(`GET /api/agent/proposals failed: ${res.status}`);
  const body = await res.json();
  return Array.isArray(body.proposals) ? body.proposals : [];
}

async function createPendingProposal(tag) {
  const objective = `deploy-lifecycle-${tag}-${Date.now()} immediate entry, take profit 4%, stop loss 2%`;
  const payload = {
    symbol: 'BTCUSDT',
    exchange: 'bitunix',
    side: 'buy',
    quantity: 0.001,
    userId: 'deploy-lifecycle-user',
    objective,
    autoApprove: false,
    tradingMode: 'agent',
    executionMode: 'paper',
    timeframe: '15m',
  };

  const tradeRes = await fetch(`${BASE_URL}/api/agent/trade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const tradeBody = await tradeRes.text();
  if (tradeRes.status !== 202) {
    throw new Error(`Expected 202 from /api/agent/trade, got ${tradeRes.status}: ${tradeBody}`);
  }

  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const proposals = await getProposals();
    const proposal = proposals.find(
      (p) => p?.request?.objective === objective && p?.request?.userId === 'deploy-lifecycle-user',
    );

    if (proposal) {
      if (!proposal.algorithm) {
        throw new Error(`Proposal ${proposal.id} found without algorithm`);
      }
      return proposal;
    }

    await sleep(POLL_MS);
  }

  throw new Error(`Timed out waiting for proposal for objective: ${objective}`);
}

async function createPendingProposalWithRetries(tag) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      console.log(`[lifecycle] create ${tag} attempt ${attempt}/${RETRY_ATTEMPTS}`);
      return await createPendingProposal(`${tag}-a${attempt}`);
    } catch (err) {
      lastErr = err;
      console.warn(`[lifecycle] create ${tag} attempt ${attempt} failed:`, err?.message || err);
    }
  }
  throw lastErr || new Error(`Failed to create pending proposal for ${tag}`);
}

async function approveProposal(id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APPROVE_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/agent/proposals/${id}/approve`, {
      method: 'POST',
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Approve failed (${res.status}): ${body}`);

    const json = JSON.parse(body);
    if (!json.success) throw new Error(`Approve returned success=false: ${body}`);
  } catch (err) {
    // The endpoint can take time while execution runs; status is set before execution.
    // If request timeout/abort happens, we still verify outcome via status polling.
    if (err?.name !== 'AbortError') {
      throw err;
    }
    console.warn('[lifecycle] approve request timed out; will verify status via polling');
  } finally {
    clearTimeout(timeout);
  }
}

async function rejectProposal(id) {
  const res = await fetch(`${BASE_URL}/api/agent/proposals/${id}/reject`, { method: 'POST' });
  const body = await res.text();
  if (!res.ok) throw new Error(`Reject failed (${res.status}): ${body}`);

  const json = JSON.parse(body);
  if (!json.success) throw new Error(`Reject returned success=false: ${body}`);
}

async function waitForStatus(id, expectedStatus) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const proposals = await getProposals();
    const proposal = proposals.find((p) => p.id === id);
    if (proposal?.status === expectedStatus) return;
    await sleep(POLL_MS);
  }
  throw new Error(`Proposal ${id} did not reach status '${expectedStatus}'`);
}

(async () => {
  console.log('[lifecycle] base url:', BASE_URL);

  console.log('[lifecycle] creating proposal for approve path...');
  const approveCandidate = await createPendingProposalWithRetries('approve');
  console.log('[lifecycle] approve candidate:', approveCandidate.id);

  console.log('[lifecycle] approving proposal...');
  await approveProposal(approveCandidate.id);
  await waitForStatus(approveCandidate.id, 'approved');
  console.log('[lifecycle] approve path PASS');

  console.log('[lifecycle] creating proposal for reject path...');
  const rejectCandidate = await createPendingProposalWithRetries('reject');
  console.log('[lifecycle] reject candidate:', rejectCandidate.id);

  console.log('[lifecycle] rejecting proposal...');
  await rejectProposal(rejectCandidate.id);
  await waitForStatus(rejectCandidate.id, 'rejected');
  console.log('[lifecycle] reject path PASS');

  console.log('[lifecycle] PASS: proposal lifecycle working');
})().catch((err) => {
  console.error('[lifecycle] FAIL:', err?.message || err);
  process.exit(1);
});
