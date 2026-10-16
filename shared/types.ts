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
  estimatedKwh: number | null;
  heatingHours: number | null;
  coverage: number;
  monitored: number;
  metered: number;
  estimated: number;
  fresh: number;
  complete: boolean;
}
export interface HistoryPoint {
  day: string;
  kwh: number | null;
  measuredKwh: number | null;
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
}
export interface DeviceView {
  id: string;
  homeId: string;
  name: string;
  category: string;
  included: boolean;
  online: boolean;
  present: boolean;
  fresh: boolean;
  lastSeen: number | null;
  energyKind: string;
  energyCode: string | null;
  reportingConnected: boolean;
  lastEnergyReport: number | null;
  counterKwh: number | null;
  temperature: number | null;
  powerW: number | null;
  stats: EnergyStats;
  energySource: 'measured' | 'estimated' | 'missing';
  heatingState: 'on' | 'off' | 'unknown';
}
export interface HomeView {
  id: string;
  name: string;
  accountId: string;
  accountLabel: string;
  rules: Rules;
  stats: EnergyStats;
  deviceCount: number;
}
export interface HomeDetail extends HomeView {
  devices: DeviceView[];
  history: HistoryPoint[];
}
export interface DeviceDetail extends DeviceView {
  homeName: string;
  history: HistoryPoint[];
  estimation: EstimationView;
}
export type StatusValue = string | number | boolean;
export interface StatusField {
  code: string;
  value: StatusValue;
  values?: StatusValue[];
}
export interface EstimationConfig {
  enabled: boolean;
  ratedPowerKw: number | null;
  heatingCode: string | null;
  onValues: StatusValue[];
  offValues: StatusValue[];
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
export interface NotificationView {
  id: string;
  homeId: string | null;
  kind: string;
  title: string;
  body: string;
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
  timezone: string;
  pollSeconds: number;
  statusPollSeconds: number;
  origin: string;
  emailConfigured: boolean;
  emailFrom: string | null;
  emailTo: string | null;
  syncing: boolean;
}
