import unittest
from tuya import normalize_device, run


class AdapterRuntimeTests(unittest.TestCase):
    def test_adapter_can_load_sdk_without_making_cloud_requests(self):
        self.assertEqual(run({'operation': 'unsupported'}), {'ok': False})


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

    def test_standard_add_ele_sum_uses_kwh_when_cloud_omits_unit(self):
        # Observed on the new single-phase meters: sum, scale 3, no unit.
        for unit in (None, '', ' '):
            with self.subTest(unit=unit):
                device, spec, reports = self.device('add_ele', 184, 'sum', unit, 3)
                if unit is None:
                    del spec['status'][0]['values']['unit']
                result = normalize_device(device, spec, reports)
                self.assertEqual(result['energyKind'], 'incremental')
                self.assertEqual(result['energyCode'], 'add_ele')
                self.assertAlmostEqual(result['incrementKwh'], 0.184)
                self.assertIsNone(result['counterKwh'])

    def test_missing_unit_fallback_requires_standard_increment_metadata(self):
        for code, report, scale, unit in [
                ('add_ele', 'un_known', 3, ''), ('add_ele', 'minux', 3, ''),
                ('add_ele', 'sum', 2, ''), ('add_ele', 'sum', None, ''),
                ('add_ele', 'sum', 3, 'W'), ('total_forward_energy', 'minux', 3, ''),
                ('reverse_energy_total', 'sum', 3, ''), ('mystery', 'sum', 3, '')]:
            with self.subTest(code=code, report=report, scale=scale, unit=unit):
                result = normalize_device(*self.device(code, 184, report, unit, scale))
                self.assertEqual(result['energyKind'], 'unsupported')
                self.assertIsNone(result['incrementKwh'])
                self.assertIsNone(result['counterKwh'])

    def test_heater_work_power_is_watts_not_a_reported_energy_counter(self):
        for raw in (0, 800):
            device, spec, reports = self.device('work_power', raw, 'un_known', 'w', 0)
            device['category'] = 'qn'
            # The heater advertises this report type but exposes no value or schema.
            reports.append({'dp_code': 'forward_energy_total', 'report_type': 'minux'})
            result = normalize_device(device, spec, reports)
            self.assertEqual(result['powerW'], raw)
            self.assertEqual(result['energyKind'], 'power')
            self.assertIsNone(result['counterKwh'])

    def test_native_power_uses_schema_scale_and_units_without_rated_power(self):
        for code, raw, unit, scale, watts in [
                ('cur_power', 12500, 'W', 1, 1250),
                ('power', 125, 'kW', 2, 1250),
                ('work_power', 800, 'w', 0, 800),
                ('cur_power', 0, 'W', 1, 0),
                ('cur_power', 12500, '', 1, 1250)]:
            with self.subTest(code=code, unit=unit, raw=raw):
                result = normalize_device(*self.device(code, raw, 'un_known', unit, scale))
                self.assertEqual(result['energyKind'], 'power')
                self.assertEqual(result['powerW'], watts)
                self.assertEqual(result['powerField'], {
                    'code': code, 'scale': scale, 'unit': 'kW' if unit == 'kW' else 'W'})
                self.assertIsNone(result['counterKwh'])

    def test_power_capability_survives_missing_or_invalid_readings(self):
        for raw in (None, True, -1, '12500', float('nan'), float('inf')):
            result = normalize_device(*self.device('cur_power', raw, 'un_known', 'W', 1))
            self.assertEqual(result['energyKind'], 'power')
            self.assertIsNone(result['powerW'])

    def test_power_requires_valid_metadata_and_never_multiplies_current_by_voltage(self):
        for code, unit, scale in [('cur_power', 'VA', 1), ('cur_power', 'kWh', 1),
                                  ('cur_power', '', 0), ('cur_power', 'W', True),
                                  ('cur_power', 'W', None), ('cur_power', 'W', -1),
                                  ('power', '', 1), ('cur_current', 'mA', 0),
                                  ('cur_voltage', 'V', 1)]:
            result = normalize_device(*self.device(code, 123, 'un_known', unit, scale))
            self.assertEqual(result['energyKind'], 'unsupported')
            self.assertIsNone(result['powerW'])

    def test_energy_meters_take_precedence_over_power_regardless_of_field_order(self):
        for code, report, kind in [('total_forward_energy', 'minux', 'cumulative'),
                                    ('add_ele', 'sum', 'incremental')]:
            device, spec, reports = self.device(code, 100, report, 'kWh', 3)
            device['status'].append({'code': 'cur_power', 'value': 10000})
            spec['status'].append({'code': 'cur_power', 'type': 'Integer',
                                   'values': {'unit': 'W', 'scale': 1}})
            for definitions in (spec['status'], list(reversed(spec['status']))):
                result = normalize_device(device, {'status': definitions}, reports)
                self.assertEqual(result['energyKind'], kind)
                self.assertEqual(result['powerW'], 1000)

    def test_power_metadata_may_be_in_functions_without_a_current_value(self):
        device, spec, reports = self.device('cur_power', 12500, 'un_known', 'W', 1)
        result = normalize_device(device, {'functions': spec['status']}, reports)
        self.assertEqual(result['powerW'], 1250)
        device['status'] = []
        result = normalize_device(device, spec, reports)
        self.assertEqual(result['energyKind'], 'power')
        self.assertIsNone(result['powerW'])

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
    def test_missing_enum_range_does_not_erase_previously_observed_choices(self):
        from tuya import status_fields
        for meta in ('{}', '{"range":[]}'):
            fields = status_fields({'status': [{'code': 'work_state', 'value': 'idle'}]}, {
                'status': [{'code': 'work_state', 'type': 'Enum', 'values': meta}],
            })
            self.assertEqual(fields, [{'code': 'work_state', 'value': 'idle'}])

    def test_discovery_uses_function_metadata_when_status_definition_is_missing(self):
        from tuya import status_fields
        fields = status_fields({'status': [
            {'code': 'work_state', 'value': 'heating'},
            {'code': 'relay_state', 'value': False},
        ]}, {'functions': [
            {'code': 'work_state', 'type': 'Enum', 'values': '{"range":["heating","idle"]}'},
        ]})
        self.assertEqual(fields, [
            {'code': 'work_state', 'value': 'heating', 'values': ['heating', 'idle']},
            {'code': 'relay_state', 'value': False, 'values': [True, False]},
        ])

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
