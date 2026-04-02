(async () => {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node poll-proposal.js <proposalId>');
    process.exit(2);
  }

  const timeoutMs = 120000; // 2 minutes
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://127.0.0.1:5000/api/agent/proposals');
      const body = await res.json();
      if (body && Array.isArray(body.proposals)) {
        const p = body.proposals.find(x => x.id === id);
        if (p) {
          console.log('FOUND', JSON.stringify(p, null, 2));
          if (p.status !== 'pending' || p.algorithm) {
            console.log('Proposal analysis appears complete.');
            process.exit(0);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching proposals:', err);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  console.error('Timed out waiting for proposal analysis');
  process.exit(1);
})();
