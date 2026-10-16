import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { digest, encrypt, decrypt } from '../server/crypto.js';
import { sessionSchema } from '../server/tuya.js';

process.umask(0o077);
const [file, label] = process.argv.slice(2);
if (!file || !label) throw new Error('Usage: npm run import-session -- /private/session.json "Account label"');
const config = loadConfig();
const session = sessionSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const db = openDatabase(path.join(config.dataDir, 'monitor.sqlite'));
try {
  const check = db.prepare("SELECT value FROM metadata WHERE key='key_check'").get() as { value: string } | undefined;
  if (check) decrypt(check.value, config.encryptionKey);
  else db.prepare("INSERT INTO metadata(key,value) VALUES('key_check',?)").run(encrypt('monitor', config.encryptionKey));
  db.prepare(`INSERT INTO accounts(id,label,identity,secret) VALUES(?,?,?,?)
    ON CONFLICT(identity) DO UPDATE SET label=excluded.label,secret=excluded.secret,error=NULL`)
    .run(randomUUID(), label, digest(session.token_info.uid), encrypt(session, config.encryptionKey));
  console.log('Account session imported. Start the app to collect readings.');
} finally { db.close(); }
