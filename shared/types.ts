export interface Rules {
  dailyLimit: number | null;
  anomalyEnabled: boolean;
  windowDays: number;
  increasePercent: number;
  increaseKwh: number;
}
export interface EnergyStats {
  kwh: number | null;
  measuredKwh: number | null;
  powerKwh: number | null;
  estimatedKwh: number | null;
  heatingHours: number | null;
  coverage: number;
  monitored: number;
  metered: number;
  powerMetered: number;
  estimated: number;
  fresh: number;
  complete: boolean;
}
export interface HistoryPoint {
  day: string;
  kwh: number | null;
  measuredKwh: number | null;
  powerKwh: number | null;
  estimatedKwh: number | null;
  heatingHours: number | null;
  coverage: number;
}
export interface AccountView {
  id: string;
  label: string;
  lastSync: number | null;
  error: string | null;
  healthy: boolean;
  homeCount: number;
  deviceCount: number;
  tuyaAi: {
    configured: boolean;
    region: string | null;
    lastSuccess: number | null;
    error: string | null;
    healthy: boolean;
    meteredDevices: number;
  };
}
export interface DeviceView {
  id: string;
  homeId: string;
  name: string;
  category: string;
  included: boolean;
  ignored: boolean;
  online: boolean;
  present: boolean;
  fresh: boolean;
  lastSeen: number | null;
  energyKind: string;
  energyCode: string | null;
  reportingConnected: boolean;
  lastEnergyReport: number | null;
  counterKwh: number | null;
  measurementProvider: 'qr' | 'tuya_ai' | null;
  measurementAt: number | null;
  measurementError: string | null;
  temperature: number | null;
  humidity: number | null;
  climateObservedAt: number | null;
  powerW: number | null;
  stats: EnergyStats;
  energySource: 'measured' | 'power' | 'estimated' | 'missing';
  heatingState: 'on' | 'off' | 'unknown';
}
export interface ClimateMetric {
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  count: number;
  samples: number;
  oldestObservedAt: number | null;
  latestObservedAt: number | null;
}
export interface ClimateSummary {
  temperature: ClimateMetric;
  humidity: ClimateMetric;
}
export interface ClimateHistoryPoint extends ClimateSummary {
  day: string;
}
export interface HomeView {
  id: string;
  name: string;
  accountId: string;
  accountLabel: string;
  rules: Rules;
  stats: EnergyStats;
  deviceCount: number;
  climate: ClimateSummary;
}
export interface HomeDetail extends HomeView {
  devices: DeviceView[];
  history: HistoryPoint[];
  climateHistory: ClimateHistoryPoint[];
}
export interface DeviceDetail extends DeviceView {
  homeName: string;
  history: HistoryPoint[];
  estimation: EstimationView;
}
export type StatusValue = string | number | boolean;
export interface TemperatureField {
  code: string;
  scale: number;
  unit: 'C' | 'F';
}
export interface TemperatureMapping {
  current: TemperatureField;
  target: TemperatureField;
  switchCode: string | null;
}
export interface StatusField {
  code: string;
  value: StatusValue;
  values?: StatusValue[];
  temperature?: Omit<TemperatureField, 'code'> | null;
}
export interface EstimationConfig {
  enabled: boolean;
  ratedPowerKw: number | null;
  heatingCode: string | null;
  onValues: StatusValue[];
  offValues: StatusValue[];
  temperature?: TemperatureMapping | null;
}
export interface EstimationView extends EstimationConfig {
  revision: number;
  source: DeviceView['energySource'];
  state: DeviceView['heatingState'];
  lastObservedAt: number | null;
  statusUpdatedAt: number | null;
  totalHeatingHours: number | null;
  statusFields: StatusField[];
  suggestion: Pick<EstimationConfig, 'heatingCode' | 'onValues' | 'offValues'> | null;
  temperatureSuggestion: TemperatureMapping | null;
  observations: {
    at: number;
    state: DeviceView['heatingState'];
    rawValue: StatusValue | null;
    code: string | null;
    online: boolean;
    revision: number;
    ratedPowerKw: number | null;
  }[];
}
export interface NotificationContent {
  title: string;
  body: string;
}
export interface NotificationView {
  push?: import('./push.js').PushSummary;
  id: string;
  homeId: string | null;
  kind: string;
  title: string;
  body: string;
  translations?: { pl: NotificationContent };
  createdAt: number;
  status: string;
  sentAt: number | null;
  error: string | null;
}
export interface Overview {
  now: number;
  timezone: string;
  stats: EnergyStats;
  homes: HomeView[];
  accounts: AccountView[];
  history: HistoryPoint[];
  alerts: NotificationView[];
}
export interface SettingsView {
  emailEnabled?: boolean;
  pushConfigured?: boolean;
  timezone: string;
  pollSeconds: number;
  statusPollSeconds: number;
  origin: string;
  emailConfigured: boolean;
  emailFrom: string | null;
  emailTo: string | null;
  syncing: boolean;
}
