(async () => {
  try {
    const body = { content: "Buy on breakout" };
    const res = await fetch('http://127.0.0.1:5000/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await res.json();
    console.log('STATUS', res.status);
    console.log(JSON.stringify(json, null, 2));
  } catch (err) { console.error('ERROR', err); }
})();
