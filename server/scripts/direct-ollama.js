(async () => {
  const host = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'glm-4.7-flash:latest';
  try {
    const system = `You are an expert cryptocurrency trading AI assistant. You generate trading algorithms as JSON based on user specifications.`;
    const user = `User request: Buy on breakout`;
    const resp = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: false }),
    });
    const data = await resp.json();
    console.log('OLLAMA RESP', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('OLLAMA ERR', err);
  }
})();
