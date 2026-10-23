import unittest
from tuya import normalize_device


def reading(fields):
    device = {'id': 'sensor', 'online': True,
              'status': [{'code': code, 'value': raw} for code, raw, unit, scale in fields]}
    spec = {'functions': [{'code': code, 'type': 'Integer',
                           'values': {'unit': unit, 'scale': scale}}
                          for code, raw, unit, scale in fields]}
    return normalize_device(device, spec, [])


class ClimateTests(unittest.TestCase):
    def test_current_temperature_aliases_use_explicit_units_and_scales(self):
        for code, raw, unit, scale, expected in [
            ('temp_current', 215, '℃', 1, 21.5),
            ('current_temp', -25, '°C', 1, -2.5),
            ('va_temperature', 0, ' C ', 0, 0),
            ('temp_current_f', 689, '°F', 1, 20.5),
            ('current_temp_f', 32, '℉', 0, 0),
        ]:
            with self.subTest(code=code):
                self.assertAlmostEqual(reading([(code, raw, unit, scale)])['temperature'], expected)

    def test_humidity_scaling_including_zero_and_hundred_percent(self):
        for code, raw, scale, expected in [
            ('humidity_value', 455, 1, 45.5), ('va_humidity', 45, 0, 45),
            ('humidity_current', 1000, 1, 100), ('cur_humidity', 0, 0, 0),
        ]:
            with self.subTest(code=code):
                self.assertEqual(reading([(code, raw, '%', scale)]).get('humidity'), expected)

    def test_only_current_readings_and_one_value_per_device_are_selected(self):
        result = reading([('temp_set', 30, '°C', 0), ('humidity_set', 80, '%', 0),
                          ('temp_current_f', 77, 'F', 0), ('temp_current', 20, 'C', 0),
                          ('humidity_value', 40, '%', 0), ('va_humidity', 55, '%', 0)])
        self.assertEqual(result['temperature'], 20)
        self.assertEqual(result.get('humidity'), 40)
        result = reading([('temp_set', 30, '°C', 0), ('humidity_set', 80, '%', 0)])
        self.assertIsNone(result['temperature'])
        self.assertIsNone(result.get('humidity'))

    def test_invalid_values_metadata_and_humidity_ranges_are_unavailable(self):
        for code, raw, unit, scale in [
            ('humidity_value', -1, '%', 0), ('humidity_value', 101, '%', 0),
            ('humidity_value', 50, '', 0), ('humidity_value', 50, 'g/m³', 0),
            ('humidity_value', True, '%', 0), ('humidity_value', '50', '%', 0),
            ('humidity_value', float('nan'), '%', 0), ('humidity_value', 50, '%', True),
            ('temp_current', 21, '', 0), ('temp_current', -274, 'C', 0),
            ('temp_current', 210, 'C', None), ('temp_current', 210, 'C', True),
        ]:
            with self.subTest(code=code, raw=raw, scale=scale, unit=unit):
                result = reading([(code, raw, unit, scale)])
                self.assertIsNone(result['temperature'])
                self.assertIsNone(result.get('humidity'))
