const [name, url, timeoutRaw = '60000'] = process.argv.slice(2);

if (name === undefined || url === undefined) {
  process.stderr.write('Usage: wait-for-http.mjs <name> <url> [timeout-ms]\n');
  process.exit(1);
}

const timeoutMs = Number(timeoutRaw);
const deadline = Date.now() + timeoutMs;
let lastError = 'no response';

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2_000) });
    if (response.status >= 200 && response.status < 400) {
      process.stdout.write(`${name} ready (${response.status})\n`);
      process.exit(0);
    }
    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

process.stderr.write(`${name} did not become ready at ${url}: ${lastError}\n`);
process.exit(1);
