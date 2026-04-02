(async ()=>{
  // use global fetch in modern Node
  const body = {
    symbol: 'BTCUSDT',
    exchange: 'bitunix',
    side: 'buy',
    quantity: 1000, // intentionally large to exceed paper balance
    userId: 'test-user',
    objective: 'Large size to trigger balance guard',
    autoApprove: true,
    executionMode: 'paper'
  };

  try {
    const res = await fetch('http://127.0.0.1:5000/api/agent/trade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)});
    const txt = await res.text();
    console.log('STATUS', res.status);
    console.log(txt);
  } catch (err) {
    console.error('ERROR', err);
  }
})();
