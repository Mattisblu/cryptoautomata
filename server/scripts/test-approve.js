(async () => {
  try {
    const body = {
      symbol: "BTCUSDT",
      exchange: "bitunix",
      side: "buy",
      quantity: 0.001,
      userId: "test-user",
      objective: "Buy on breakout",
      autoApprove: true
    };

    const res = await fetch('http://127.0.0.1:5000/api/agent/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    console.log('STATUS', res.status);
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('ERROR', err);
  }
})();
