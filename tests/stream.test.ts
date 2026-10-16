import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TuyaStream } from '../server/stream.js';
import type { TuyaSession } from '../server/tuya.js';

const session: TuyaSession = {
  user_code: 'u',
  terminal_id: 't',
  endpoint: 'https://apigw.tuyaeu.com',
  token_info: {
    t: 0,
    uid: 'u',
    expire_time: 999999,
    access_token: 'secret',
    refresh_token: 'secret',
  },
};

test('persistent transport separates responses, token rotations and energy events, and closes pending work', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tuya-stream-'));
  const script = path.join(dir, 'worker.py');
  writeFileSync(
    script,
    `import sys, json
json.loads(sys.stdin.readline())
for line in sys.stdin:
    request=json.loads(line)
    if request['operation']=='hang':
        continue
    print(json.dumps({'type':'energy','report':{'kwh':0.12}}),flush=True)
    print(json.dumps({'type':'response','id':request['id'],'response':{'ok':True,'operation':request['operation']}}),flush=True)
`,
  );
  const messages: any[] = [];
  const stream = new TuyaStream(session, (message) => messages.push(message), 'python3', script);
  try {
    const [read, states] = await Promise.all([stream.call('read', {}), stream.call('states', {})]);
    assert.equal(read.operation, 'read');
    assert.equal(states.operation, 'states');
    assert.equal(messages.filter((m) => m.type === 'energy').length, 2);
    const pending = assert.rejects(stream.call('hang', {}), /closed/);
    await stream.stop();
    await pending;
    assert.equal(stream.alive, false);
  } finally {
    await stream.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed worker output fails closed and breaks stream health', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tuya-stream-'));
  const script = path.join(dir, 'bad.py');
  writeFileSync(
    script,
    'import sys\nsys.stdin.readline()\nsys.stdin.readline()\nprint("not-json",flush=True)\n',
  );
  const messages: any[] = [];
  const stream = new TuyaStream(session, (m) => messages.push(m), 'python3', script);
  try {
    await assert.rejects(stream.call('read', {}));
    assert.equal(stream.alive, false);
    assert.ok(messages.some((m) => m.type === 'stream' && !m.connected));
  } finally {
    await stream.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
