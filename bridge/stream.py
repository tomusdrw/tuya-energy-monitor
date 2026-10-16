"""One account, one token owner: HTTP polling and MQTT share a serialized API.

Only newline-delimited, sanitized application messages go to stdout. Never log
SDK exceptions: they can contain credentials. The parent owns process lifetime.
"""
import json
import logging
import math
import sys
import threading
from tuya import create_api, normalize_device, run


def report_time(value):
    if isinstance(value, str) and value.isdigit():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    # Older cloud payloads express the same device timestamp in seconds.
    return value * 1000 if value < 100000000000 else value


def energy_reports(message, targets):
    from tuya_sharing.strategy import strategy
    if not isinstance(message, dict) or message.get('protocol') != 4:
        return []
    data = message.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('devId'), str):
        return []
    target = targets.get(data['devId'])
    if not target or not isinstance(data.get('status'), list):
        return []
    result = []
    for item in data['status']:
        if not isinstance(item, dict):
            continue
        at = report_time(item.get('t'))
        if at is None:  # Receipt time cannot identify a replay or date the consumption.
            continue
        try:
            code, value = item.get('code'), item.get('value')
            if target['device'].support_local:
                mapping = target['device'].local_strategy.get(item.get('dpId'))
                if not mapping:
                    continue
                code, value = strategy.convert(mapping['value_convert'],
                    (mapping['status_code'], value), mapping['config_item'])
            if code != target['code']:
                continue
            normalized = normalize_device({'id': data['devId'], 'status': [{'code': code, 'value': value}]},
                                          target['specification'], target['reports'])
            kwh = normalized['incrementKwh']
            if normalized['energyKind'] == 'incremental' and kwh is not None and math.isfinite(kwh):
                report = {'deviceId': data['devId'], 'code': code, 'at': at, 'kwh': kwh}
                identity = data.get('dataId')
                if isinstance(identity, str) and 0 < len(identity) <= 256:
                    report['reportId'] = identity
                result.append(report)
        except Exception:
            continue
    return result


class SerializedApi:
    def __init__(self, api):
        self.api = api
        self.lock = threading.RLock()

    def get(self, *args, **kwargs):
        with self.lock:
            return self.api.get(*args, **kwargs)

    def post(self, *args, **kwargs):
        with self.lock:
            return self.api.post(*args, **kwargs)


class AccountStream:
    def __init__(self, session, emit):
        self.session = session
        self.emit = emit
        self.api = SerializedApi(create_api(session, lambda s: emit({'type': 'session', 'session': s})))
        self.targets = {}
        self.pending = {}
        self.mq = None
        self.stopped = threading.Event()
        self.heartbeat = threading.Thread(target=self.pulse, daemon=True)
        self.heartbeat.start()

    def pulse(self):
        while not self.stopped.wait(30):
            mq = self.mq
            self.emit({'type': 'stream', 'connected': bool(mq and mq.ready and mq.client and mq.client.is_connected()),
                       'deviceIds': list(self.targets)})

    def collect_target(self, device, specification, reports):
        normalized = normalize_device(device, specification, reports)
        if normalized['energyKind'] == 'incremental':
            self.pending[device['id']] = {'specification': specification, 'reports': reports, 'code': normalized['energyCode']}

    def call(self, operation, payload):
        if operation == 'subscribe':
            self.subscribe()
            return {'ok': True}
        if operation == 'read':
            self.pending = {}
        response = run({'operation': operation, 'session': self.session, **payload},
                       self.api, self.collect_target if operation == 'read' else None)
        if operation == 'read' and not response['ok']:
            self.pending = {key: {k: v for k, v in value.items() if k != 'device'} for key, value in self.targets.items()}
        response.pop('session', None)  # Token rotations are ordered events, never stale response copies.
        return response

    def subscribe(self):
        from tuya_sharing.device import CustomerDevice, DeviceRepository
        from tuya_sharing.mq import SharingMQ
        metadata = {key: {k: v for k, v in value.items() if k != 'device'} for key, value in self.targets.items()}
        if metadata == self.pending:
            return
        if self.mq:
            self.mq.stop()
            self.mq.join(timeout=10)
        self.mq = None
        self.emit({'type': 'stream', 'connected': False, 'deviceIds': []})
        targets = {}
        for device_id, meta in self.pending.items():
            device = CustomerDevice(id=device_id, support_local=False, local_strategy={})
            try:
                DeviceRepository(self.api).update_device_strategy_info(device)
                targets[device_id] = {**meta, 'device': device}
            except Exception:
                continue  # Retry this device's strategy on the next inventory pass.
        self.targets = targets
        if not targets:
            return
        emit = self.emit

        class ObservedMQ(SharingMQ):
            def __init__(self, *args):
                super().__init__(*args)
                self.subscriptions = {}
                self.ready_clients = set()

            @property
            def ready(self):
                return id(self.client) in self.ready_clients

            def _on_connect(self, client, userdata, flags, rc):
                self.ready_clients.discard(id(client))
                self.subscriptions[id(client)] = math.ceil(len(self.device) / 20)
                super()._on_connect(client, userdata, flags, rc)

            def _on_subscribe(self, client, userdata, mid, granted_qos):
                if not granted_qos or any(qos >= 128 for qos in granted_qos):
                    self.ready_clients.discard(id(client))
                    return
                self.subscriptions[id(client)] -= 1
                if self.subscriptions[id(client)] == 0:
                    self.ready_clients.add(id(client))
                    emit({'type': 'stream', 'connected': True, 'deviceIds': list(targets)})

            def _on_disconnect(self, client, userdata, rc):
                self.ready_clients.discard(id(client))
                self.subscriptions.pop(id(client), None)
                # SDK starts the replacement before disconnecting the old client.
                emit({'type': 'stream', 'connected': bool(self.ready_clients), 'deviceIds': list(targets)})
                super()._on_disconnect(client, userdata, rc)

            def _on_message(self, client, userdata, message):
                if message.retain:
                    return  # A retained status is not a new energy increment.
                try:
                    super()._on_message(client, userdata, message)
                except Exception:
                    pass

        mq = ObservedMQ(self.api, [], [target['device'] for target in targets.values()])
        mq.daemon = True
        mq.add_message_listener(lambda message: [emit({'type': 'energy', 'report': report})
                                               for report in energy_reports(message, targets)])
        self.mq = mq
        mq.start()

    def stop(self):
        self.stopped.set()
        if self.mq:
            self.mq.stop()
            self.mq.join(timeout=10)


def main():
    logging.disable(logging.CRITICAL)
    output_lock = threading.Lock()

    def emit(value):
        with output_lock:
            print(json.dumps(value, allow_nan=False, ensure_ascii=False), flush=True)

    worker = None
    try:
        initial = json.loads(sys.stdin.readline())
        worker = AccountStream(initial['session'], emit)
        for line in sys.stdin:
            request = json.loads(line)
            try:
                response = worker.call(request['operation'], request.get('payload', {}))
            except Exception:
                response = {'ok': False}
            emit({'type': 'response', 'id': request['id'], 'response': response})
    finally:
        if worker:
            worker.stop()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit(1)
