import unittest
import json
from unittest.mock import patch
from types import SimpleNamespace
from stream import energy_reports
from stream import AccountStream


class EnergyReportsTests(unittest.TestCase):
    def target(self, unit='kWh', scale=2, local=False):
        device = SimpleNamespace(id='d', support_local=local, local_strategy={})
        specification = {'status': [{'code': 'add_ele', 'type': 'Integer',
                                    'values': {'unit': unit, 'scale': scale}}]}
        return {'device': device, 'specification': specification,
                'reports': [{'dp_code': 'add_ele', 'report_type': 'sum'}], 'code': 'add_ele'}

    def message(self, value=12, at=1792144800000):
        return {'protocol': 4, 'data': {'devId': 'd', 'status': [
            {'code': 'add_ele', 'value': value, 't': at}]}}

    def test_reports_preserve_event_time_and_convert_units(self):
        for unit, scale, expected in [('kWh', 2, 0.12), ('Wh', 0, 0.012)]:
            self.assertEqual(energy_reports(self.message(), {'d': self.target(unit, scale)}), [
                {'deviceId': 'd', 'code': 'add_ele', 'at': 1792144800000, 'kwh': expected}])
        self.assertEqual(energy_reports(self.message(at='1792144800'), {'d': self.target()})[0]['at'], 1792144800000)

    def test_only_actual_incremental_fields_with_valid_report_timestamps_are_emitted(self):
        for msg in [self.message(True), self.message(-1), self.message(float('inf')),
                    self.message(at=None), self.message(at=True), self.message(at=1.25),
                    {'protocol': 20, 'data': {'devId': 'd'}}, {}, {'protocol': 4, 'data': None}]:
            self.assertEqual(energy_reports(msg, {'d': self.target()}), [])
        msg = self.message()
        msg['data']['status'][0]['code'] = 'reverse_energy_total'
        self.assertEqual(energy_reports(msg, {'d': self.target()}), [])
        self.assertEqual(energy_reports(self.message(), {}), [])
        target = self.target()
        target['reports'][0]['report_type'] = 'minux'
        self.assertEqual(energy_reports(self.message(), {'d': target}), [])

    def test_local_dp_ids_use_sdk_conversion_and_only_reported_fields(self):
        target = self.target(local=True)
        target['device'].local_strategy = {17: {'value_convert': 'default', 'status_code': 'add_ele',
            'config_item': {'statusFormat': '{"add_ele":"$"}', 'valueType': 'Integer', 'valueDesc': '{"min":0}'}}}
        msg = self.message()
        msg['data']['status'] = [{'dpId': 17, 'value': 25, 't': 1792144800000},
                                 {'dpId': 99, 'value': 100, 't': 1792144800000}]
        self.assertEqual(energy_reports(msg, {'d': target}), [
            {'deviceId': 'd', 'code': 'add_ele', 'at': 1792144800000, 'kwh': 0.25}])

    def test_equal_values_at_different_times_are_not_filtered(self):
        target = {'d': self.target()}
        self.assertEqual(len(energy_reports(self.message(), target)), 1)
        self.assertEqual(len(energy_reports(self.message(at=1792144801000), target)), 1)

    def test_cloud_data_id_is_preserved_for_reliable_deduplication(self):
        msg = self.message()
        msg['data']['dataId'] = 'event-1'
        self.assertEqual(energy_reports(msg, {'d': self.target()})[0]['reportId'], 'event-1')


class StreamLifecycleTests(unittest.TestCase):
    def test_mqtt_renewal_old_disconnect_does_not_clear_replacement_readiness(self):
        messages = []
        with patch('stream.create_api'), patch('tuya_sharing.device.DeviceRepository.update_device_strategy_info'), \
             patch('tuya_sharing.mq.SharingMQ.start'), patch('tuya_sharing.mq.SharingMQ.stop'), \
             patch('tuya_sharing.mq.SharingMQ.join'):
            worker = AccountStream({}, messages.append)
            try:
                target = EnergyReportsTests().target()
                worker.pending = {'d': {k: v for k, v in target.items() if k != 'device'}}
                worker.subscribe()
                mq = worker.mq
                mq.mq_config = SimpleNamespace(dev_topic='device/{devId}')
                old = SimpleNamespace(subscribe=lambda topics: None, is_connected=lambda: True)
                new = SimpleNamespace(subscribe=lambda topics: None, is_connected=lambda: True)
                mq.client = old
                mq._on_connect(old, None, {}, 0)
                mq._on_subscribe(old, None, 1, [0])
                self.assertTrue(mq.ready)
                # Exact order in SharingMQ.__run_mqtt: new loop starts, old tears down, pointer switches.
                mq._on_connect(new, None, {}, 0)
                mq._on_subscribe(new, None, 2, [0])
                mq._on_disconnect(old, None, 0)
                mq.client = new
                self.assertTrue(mq.ready)
                self.assertTrue(messages[-1]['connected'])
                with patch('tuya_sharing.mq.logger.error'):
                    mq._on_disconnect(new, None, 1)
                self.assertFalse(mq.ready)
                self.assertFalse(messages[-1]['connected'])
            finally:
                worker.stop()

    def test_retained_and_malformed_messages_do_not_produce_energy_but_live_messages_do(self):
        messages = []
        with patch('stream.create_api'), patch('tuya_sharing.device.DeviceRepository.update_device_strategy_info'), \
             patch('tuya_sharing.mq.SharingMQ.start'), patch('tuya_sharing.mq.SharingMQ.stop'), \
             patch('tuya_sharing.mq.SharingMQ.join'):
            worker = AccountStream({}, messages.append)
            try:
                target = EnergyReportsTests().target()
                worker.pending = {'d': {k: v for k, v in target.items() if k != 'device'}}
                worker.subscribe()
                msg = SimpleNamespace(retain=True, payload=json.dumps(EnergyReportsTests().message()).encode())
                worker.mq._on_message(None, None, msg)
                self.assertFalse(any(m['type'] == 'energy' for m in messages))
                msg.retain = False
                worker.mq._on_message(None, None, msg)
                self.assertEqual([m['report']['kwh'] for m in messages if m['type'] == 'energy'], [0.12])
                worker.mq._on_message(None, None, SimpleNamespace(retain=False, payload=b'broken-json'))
            finally:
                worker.stop()
