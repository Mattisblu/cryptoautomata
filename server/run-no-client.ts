import runApp from './app';

async function noopSetup(app: any, server: any) {
  // no-op: do not attach Vite middleware so backend runs standalone
  return Promise.resolve();
}

(async () => {
  await runApp(noopSetup as any);
})();
