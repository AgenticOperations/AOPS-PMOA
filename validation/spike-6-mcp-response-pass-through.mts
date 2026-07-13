import assert from 'node:assert/strict';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

const merchantResponse = {
  attempt_id: 'payatt_spike',
  payment: { status: 'settled', receipt: { transaction: '0xabc' } },
  response: {
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
    content_type: 'application/octet-stream',
    body_encoding: 'base64',
    body: Buffer.from('paid-result').toString('base64'),
    bootstrap: { websocket_url: 'wss://merchant.example/session' },
  },
};
for (let run = 1; run <= 3; run += 1) {
  const result = CallToolResultSchema.parse({
    content: [{ type: 'text', text: JSON.stringify(merchantResponse) }],
    isError: false,
    structuredContent: { payment: merchantResponse },
  });
  assert.deepEqual(result.structuredContent, { payment: merchantResponse });
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  assert.deepEqual(JSON.parse(text), merchantResponse);
}

console.log(JSON.stringify({ result: 'PASS', runs: 3, bodyEncoding: 'base64', bootstrapPreserved: true }));
