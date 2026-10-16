"""Read-only Tuya sharing adapter. Secrets travel only through stdin/stdout pipes."""
import json
import logging
import math
import re
import sys
from urllib.parse import urlsplit

CLIENT_ID = 'HA_3y9q4ak7g4ephrvke'
CUMULATIVE_CODES = {'total_forward_energy', 'forward_energy_total', 'total_energy', 'total_ele'}



def status_fields(device, specification):
    """Raw scalars only: never scale relay identifiers or expose arbitrary payloads."""
    definitions = {field['code']: field for field in specification.get('status', [])}
    result = []
    def safe(value):
        return (isinstance(value, bool) or
                isinstance(value, (int, float)) and math.isfinite(value) or
                isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9_ -]{1,100}', value)))
    for field in device.get('status', []):
        code, value = field.get('code'), field.get('value')
        if (not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,100}', code) or
                re.search(r'password|token|secret|key|credential|ssid|address|url', code, re.I) or not safe(value)):
            continue
        definition = definitions.get(code, {})
        kind = definition.get('type', '').lower()
        if kind and kind not in ('boolean', 'bool', 'enum', 'integer', 'value'):
            continue
        normalized = {'code': code, 'value': value}
        if kind in ('boolean', 'bool'):
            normalized['values'] = [True, False]
        if kind == 'enum':
            try:
                meta = definition.get('values', {})
                if isinstance(meta, str):
                    meta = json.loads(meta)
                choices = meta.get('range', [])
                if isinstance(choices, list) and len(choices) <= 100 and all(safe(v) for v in choices):
                    normalized['values'] = choices
            except (ValueError, TypeError, AttributeError):
                pass
        result.append(normalized)
    return result[:256]


def read_states(get, device_ids):
    if (not isinstance(device_ids, list) or len(device_ids) > 10000 or
            any(not isinstance(id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,256}', id) for id in device_ids)):
        raise ValueError('Invalid device IDs')
    result = []
    for start in range(0, len(device_ids), 20):
        batch = device_ids[start:start + 20]
        for device in get('/v1.0/m/life/ha/devices/detail', {'devIds': ','.join(batch)}):
            if device['id'] in batch:
                result.append({'id': device['id'], 'online': bool(device.get('online')),
                               'statusFields': status_fields(device, {})})
    return result

def normalize_device(device, specification, reports):
    status = {s['code']: s['value'] for s in device.get('status', []) if 'code' in s and 'value' in s}
    types = {r['dp_code']: r.get('report_type') for r in reports}
    result = {'id': device['id'], 'name': device.get('name', 'Device'),
              'category': device.get('category', ''), 'online': bool(device.get('online')),
              'energyCode': None, 'counterKwh': None, 'incrementKwh': None, 'energyKind': 'unsupported',
              'temperature': None, 'powerW': None, 'statusFields': status_fields(device, specification)}
    for field in specification.get('status', []):
        code = field['code']
        raw = status.get(code)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
            continue
        meta = field.get('values', {})
        try:
            if isinstance(meta, str):
                meta = json.loads(meta)
            scale = meta.get('scale')
            if not isinstance(scale, int) or not 0 <= scale <= 9:
                continue
            value = raw / (10 ** scale)
            unit = str(meta.get('unit', '')).lower().replace(' ', '').replace('·', '')
        except (ValueError, TypeError, AttributeError):
            continue
        if code == 'temp_current' and unit in ('℃', '°c', 'c'):
            result['temperature'] = value
        if code in ('cur_power', 'power') and unit in ('w', 'kw'):
            result['powerW'] = value * (1000 if unit == 'kw' else 1)
        if unit not in ('kwh', 'wh') or value < 0 or code not in CUMULATIVE_CODES | {'add_ele'}:
            continue
        if types.get(code) == 'sum':
            if result['energyKind'] == 'unsupported':
                result.update(energyKind='incremental', energyCode=code,
                              incrementKwh=value / (1000 if unit == 'wh' else 1))
        elif types.get(code) == 'minux' or (code in CUMULATIVE_CODES and types.get(code) in (None, 'un_known')):
            result.update(energyKind='cumulative', energyCode=code, incrementKwh=None,
                          counterKwh=value / (1000 if unit == 'wh' else 1))
    return result


def create_api(session, on_token=None):
    from tuya_sharing.customerapi import CustomerApi, CustomerTokenInfo, SharingTokenListener
    endpoint = urlsplit(session['endpoint'])
    if (endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.port or
            not endpoint.hostname.endswith(('.iotbing.com', '.tuya.com', '.tuyacn.com', '.tuyaeu.com', '.tuyaus.com', '.tuyain.com'))):
        raise ValueError('Invalid endpoint')

    class TokenListener(SharingTokenListener):
        def update_token(self, token_info):
            session['token_info'] = token_info
            if on_token:
                on_token(session)

    return CustomerApi(CustomerTokenInfo(session['token_info']), CLIENT_ID, session['user_code'], session['endpoint'], TokenListener())


def run(request, api=None, on_device=None):
    from tuya_sharing.user import LoginControl

    operation = request['operation']
    if operation == 'start':
        response = LoginControl().qr_code(CLIENT_ID, 'haauthorize', request['userCode'])
        if not response.get('success') or not response.get('result', {}).get('qrcode'):
            return {'ok': False}
        return {'ok': True, 'qrcode': response['result']['qrcode']}
    if operation == 'confirm':
        success, info = LoginControl().login_result(request['qrcode'], CLIENT_ID, request['userCode'])
        if not success or not info.get('access_token'):
            return {'ok': False, 'pending': True}
        return {'ok': True, 'session': {'user_code': request['userCode'], 'terminal_id': info['terminal_id'],
                'endpoint': info['endpoint'], 'token_info': {k: info[k] for k in
                ('t', 'uid', 'expire_time', 'access_token', 'refresh_token')}}}
    if operation not in ('read', 'states'):
        return {'ok': False}
    session = request['session']
    api = api or create_api(session)

    def get(path, params=None):
        response = api.get(path, params)
        if not response or not response.get('success'):
            raise RuntimeError('Incomplete response')
        return response['result']

    try:
        if operation == 'states':
            return {'ok': True, 'states': read_states(get, request['deviceIds']), 'session': session}
        homes = []
        for home in get('/v1.0/m/life/users/homes'):
            home_id = str(home['ownerId'])
            devices = []
            for device in get('/v1.0/m/life/ha/home/devices', {'homeId': home_id}):
                device_id = device['id']
                specification = get(f'/v1.1/m/life/{device_id}/specifications')
                reports = get(f'/v1.0/m/life/ha/{device_id}/dp-report-types')
                devices.append(normalize_device(device, specification, reports))
                if on_device:
                    on_device(device, specification, reports)
            homes.append({'id': home_id, 'name': home['name'], 'devices': devices})
        return {'ok': True, 'snapshot': {'homes': homes}, 'session': session}
    except Exception:
        # A refreshed token must survive even when a later device request fails.
        return {'ok': False, 'session': session}


if __name__ == '__main__':
    logging.disable(logging.CRITICAL)
    try:
        result = run(json.load(sys.stdin))
    except Exception:
        result = {'ok': False}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
