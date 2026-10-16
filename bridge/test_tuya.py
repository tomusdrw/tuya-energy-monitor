import unittest
from tuya import normalize_device


class DeviceTests(unittest.TestCase):
    def device(self, code='total_forward_energy', raw=16852, report='minux', unit='kWh', scale=2):
        return {'id': 'dev', 'name': 'Heater', 'category': 'dlq', 'online': True,
                'status': [{'code': code, 'value': raw}]}, {
                    'status': [{'code': code, 'type': 'Integer', 'values': {'unit': unit, 'scale': scale}}]
                }, [{'dp_code': code, 'report_type': report}]

    def test_cumulative_scaled_energy(self):
        result = normalize_device(*self.device())
        self.assertEqual(result['counterKwh'], 168.52)
        self.assertEqual(result['energyKind'], 'cumulative')

    def test_incremental_reports_are_not_treated_as_counters(self):
        result = normalize_device(*self.device('add_ele', 12, 'sum'))
        self.assertIsNone(result['counterKwh'])
        self.assertEqual(result['energyKind'], 'incremental')

    def test_unit_and_counter_semantics_must_be_known(self):
        for args in [self.device(unit=''), self.device('mystery', report='un_known'), self.device(raw=-1)]:
            self.assertIsNone(normalize_device(*args)['counterKwh'])

    def test_temperature_and_switch_are_not_energy(self):
        result = normalize_device(*self.device('temp_current', 220, 'sum', '℃', 1))
        self.assertIsNone(result['counterKwh'])
        self.assertEqual(result['temperature'], 22)
        self.assertEqual(result['energyKind'], 'unsupported')

    def test_bool_and_nonfinite_values_are_not_readings(self):
        for value in [True, float('nan'), float('inf')]:
            self.assertIsNone(normalize_device(*self.device(raw=value))['counterKwh'])

    def test_reverse_energy_never_overwrites_consumption(self):
        device, spec, reports = self.device('forward_energy_total')
        device['status'].append({'code': 'reverse_energy_total', 'value': 0})
        spec['status'].append({'code': 'reverse_energy_total', 'type': 'Integer',
                               'values': {'unit': 'kWh', 'scale': 2}})
        reports.append({'dp_code': 'reverse_energy_total', 'report_type': 'minux'})
        result = normalize_device(device, spec, reports)
        self.assertEqual(result['counterKwh'], 168.52)
        self.assertEqual(result['energyCode'], 'forward_energy_total')


if __name__ == '__main__':
    unittest.main()

class StatusTests(unittest.TestCase):
    def test_status_fields_preserve_typed_values_and_enum_choices_without_scaling_relay(self):
        device = {'id': 'd', 'online': True, 'status': [
            {'code': 'work_state', 'value': 'heating'}, {'code': 'relay_state', 'value': True},
            {'code': 'relay_number', 'value': 1}, {'code': 'temp_current', 'value': 220}]}
        specification = {'status': [
            {'code': 'work_state', 'type': 'Enum', 'values': '{"range":["heating","standby"]}'},
            {'code': 'relay_state', 'type': 'Boolean', 'values': '{}'},
            {'code': 'relay_number', 'type': 'Integer', 'values': '{"scale":1}'}]}
        result = normalize_device(device, specification, [])['statusFields']
        self.assertIn({'code': 'work_state', 'value': 'heating', 'values': ['heating', 'standby']}, result)
        self.assertIn({'code': 'relay_state', 'value': True, 'values': [True, False]}, result)
        self.assertIn({'code': 'relay_number', 'value': 1}, result)

    def test_raw_status_never_exposes_credentials_binary_or_complex_values(self):
        from tuya import status_fields
        fields = [{'code': code, 'value': value} for code, value in [
            ('local_key', 'hidden'), ('wifi_password', 'hidden'), ('access_token', 'hidden'),
            ('program', {'secret': 'hidden'}), ('blob', ['hidden']), ('invalid', float('nan')),
            ('raw', 'x' * 300), ('work_state', 'idle')]]
        result = status_fields({'status': fields}, {})
        self.assertEqual(result, [{'code': 'work_state', 'value': 'idle'}])

    def test_fast_reads_batch_twenty_ids_without_requesting_schemas_or_inventing_absent_devices(self):
        from tuya import read_states
        calls = []
        def get(path, params):
            calls.append((path, params))
            return [{'id': params['devIds'].split(',')[0], 'online': True,
                     'status': [{'code': 'work_state', 'value': 'heat'}]}]
        result = read_states(get, [str(i) for i in range(43)])
        self.assertEqual([len(params['devIds'].split(',')) for _, params in calls], [20, 20, 3])
        self.assertTrue(all(path == '/v1.0/m/life/ha/devices/detail' for path, _ in calls))
        self.assertEqual([d['id'] for d in result], ['0', '20', '40'])
        self.assertEqual(result[0]['statusFields'], [{'code': 'work_state', 'value': 'heat'}])
