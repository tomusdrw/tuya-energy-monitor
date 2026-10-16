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
