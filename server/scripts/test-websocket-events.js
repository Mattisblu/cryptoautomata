/**
 * Smoke test: WebSocket event emission
 * Connects to ws://127.0.0.1:5000/ws, submits an agent trade request,
 * then asserts both 'agent' and 'proposal.created' events arrive.
 */

import WebSocket from 'ws';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5000';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';
const EVENT_TIMEOUT_MS = parseInt(process.env.WS_EVENT_TIMEOUT_MS || '90000', 10);

async function waitForEvents() {
  return new Promise((resolve, reject) => {
    let gotAgent = false;
    let gotProposal = false;
    let ws;

    const timer = setTimeout(() => {
      ws && ws.terminate();
      reject(new Error(
        `Timeout waiting for WS events (gotAgent=${gotAgent}, gotProposal=${gotProposal})`
      ));
    }, EVENT_TIMEOUT_MS);

    ws = new WebSocket(WS_URL);

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket connection error: ${err.message}`));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'agent') {
        gotAgent = true;
        console.log(`  [WS] agent event received`);
      }
      if (msg.type === 'proposal' && msg.data && msg.data.type === 'proposal.created') {
        gotProposal = true;
        console.log(`  [WS] proposal.created event received (id=${msg.data.proposal?.id})`);
      }

      if (gotAgent && gotProposal) {
        clearTimeout(timer);
        ws.terminate();
        resolve({ gotAgent, gotProposal });
      }
    });

    ws.on('open', async () => {
      console.log('  [WS] connected, submitting agent trade request...');
      // Submit trade request after WS is connected so we catch the broadcast
      const res = await fetch(`${BASE_URL}/api/agent/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'ws-smoke-test',
          exchange: 'coinstore',
          symbol: 'BTCUSDT',          side: 'buy',
          quantity: 0.001,          tradingMode: 'agent',
          autoApprove: false,
          objective: `ws smoke test ${Date.now()}: immediate entry, take profit 4%, stop loss 2%`,
        })
      });
      if (res.status !== 202) {
        const text = await res.text();
        clearTimeout(timer);
        ws.terminate();
        reject(new Error(`POST /api/agent/trade returned ${res.status}: ${text}`));
      } else {
        console.log('  [WS] trade request accepted (202), waiting for events...');
      }
    });
  });
}

(async () => {
  console.log(`[smoke:ws] connecting to ${WS_URL}`);
  const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS || '3', 10);

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      console.log(`[smoke:ws] attempt ${attempt}/${RETRY_ATTEMPTS}`);
      const result = await waitForEvents();
      console.log(`[smoke:ws] PASS: agent=${result.gotAgent}, proposal.created=${result.gotProposal}`);
      process.exit(0);
    } catch (err) {
      console.error(`[smoke:ws] attempt ${attempt} FAILED: ${err.message}`);
      if (attempt < RETRY_ATTEMPTS) {
        console.log(`[smoke:ws] retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  console.error('[smoke:ws] FAIL: all attempts exhausted');
  process.exit(1);
})();
