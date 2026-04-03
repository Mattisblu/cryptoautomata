/*
  Deployment smoke test for async agent proposal lifecycle.

  Validates:
  1) /api/agent/trade returns 202 in agent mode with objective + manual approval
  2) proposal appears in /api/agent/proposals within timeout
  3) proposal has algorithm payload
*/

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5000';
const TIMEOUT_MS = Number(process.env.PROPOSAL_TIMEOUT_MS || 45000);
const POLL_MS = Number(process.env.PROPOSAL_POLL_MS || 3000);
const RETRY_ATTEMPTS = Number(process.env.PROPOSAL_RETRY_ATTEMPTS || 3);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getProposals() {
  const res = await fetch(`${BASE_URL}/api/agent/proposals`);
  if (!res.ok) {
    throw new Error(`GET /api/agent/proposals failed: ${res.status}`);
  }
  const body = await res.json();
  return Array.isArray(body.proposals) ? body.proposals : [];
}

async function submitTrade(objective) {
  const payload = {
    symbol: 'BTCUSDT',
    exchange: 'bitunix',
    side: 'buy',
    quantity: 0.001,
    userId: 'deploy-smoke-user',
    objective,
    autoApprove: false,
    tradingMode: 'agent',
    executionMode: 'paper',
    timeframe: '15m',
  };

  const res = await fetch(`${BASE_URL}/api/agent/trade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  return { status: res.status, bodyText };
}

async function waitForProposal(objective) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const proposals = await getProposals();
    const target = proposals.find(
      (p) => p?.request?.objective === objective && p?.request?.userId === 'deploy-smoke-user',
    );

    if (target) {
      const hasAlgorithm = !!target.algorithm;
      console.log('[smoke] proposal found:', target.id);
      console.log('[smoke] proposal status:', target.status);
      console.log('[smoke] proposal has algorithm:', hasAlgorithm);

      if (!hasAlgorithm) {
        throw new Error('proposal exists but algorithm is missing');
      }

      return;
    }

    console.log('[smoke] waiting for proposal...');
    await sleep(POLL_MS);
  }

  throw new Error(`proposal not found within ${TIMEOUT_MS}ms`);
}

(async () => {
  console.log('[smoke] base url:', BASE_URL);

  const before = await getProposals();
  console.log('[smoke] proposals before:', before.length);

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const objective = `deploy-smoke-${Date.now()}-a${attempt} immediate entry, take profit 4%, stop loss 2%`;
    console.log(`[smoke] objective (attempt ${attempt}/${RETRY_ATTEMPTS}):`, objective);

    const trade = await submitTrade(objective);
    console.log('[smoke] trade status:', trade.status);
    console.log('[smoke] trade body:', trade.bodyText);

    if (trade.status !== 202) {
      console.error('[smoke] FAIL: expected HTTP 202 from /api/agent/trade');
      process.exit(1);
    }

    try {
      await waitForProposal(objective);
      console.log('[smoke] PASS: async proposal flow is working');
      process.exit(0);
    } catch (err) {
      console.warn(`[smoke] attempt ${attempt} failed:`, err?.message || err);
    }
  }

  console.error(`[smoke] FAIL: all ${RETRY_ATTEMPTS} attempts failed`);
  process.exit(3);
})().catch((err) => {
  console.error('[smoke] ERROR:', err?.message || err);
  process.exit(9);
});
