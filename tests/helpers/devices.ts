import { openDatabase } from '../../server/db.js';
import { getDevice, ingestSnapshot } from '../../server/energy.js';
import type { DeviceDetail } from '../../shared/types.js';

export function deviceFixture(): DeviceDetail {
  const db = openDatabase(':memory:');
  try {
    db.exec("INSERT INTO accounts(id,label,secret) VALUES('a','Account','unused')");
    ingestSnapshot(
      db,
      'a',
      {
        homes: [
          {
            id: 'h',
            name: 'Apartment',
            devices: [
              {
                id: 'd',
                name: 'Heater',
                category: 'wk',
                online: true,
                energyKind: 'unsupported',
                energyCode: null,
                counterKwh: null,
                temperature: 21.5,
                humidity: 0,
                powerW: null,
                statusFields: [
                  { code: 'work_state', value: 'heating', values: ['heating', 'idle'] },
                ],
              },
            ],
          },
        ],
      },
      Date.now(),
    );
    const { id } = db.prepare('SELECT id FROM devices').get() as { id: string };
    return getDevice(db, id, Date.now())!;
  } finally {
    db.close();
  }
}
