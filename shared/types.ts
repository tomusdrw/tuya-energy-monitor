export interface Rules {
  dailyLimit: number | null;
  anomalyEnabled: boolean;
  windowDays: number;
  increasePercent: number;
  increaseKwh: number;
}
export interface EnergyStats {
  kwh: number | null;
  coverage: number;
  monitored: number;
  metered: number;
  fresh: number;
  complete: boolean;
}
export interface HistoryPoint { day: string; kwh: number | null; coverage: number }
export interface AccountView {
  id: string; label: string; lastSync: number | null; error: string | null;
  homeCount: number; deviceCount: number;
}
export interface DeviceView {
  id: string; homeId: string; name: string; category: string;
  included: boolean; online: boolean; present: boolean; lastSeen: number | null;
  energyKind: string; energyCode: string | null; counterKwh: number | null;
  temperature: number | null; powerW: number | null; stats: EnergyStats;
}
export interface HomeView {
  id: string; name: string; accountId: string; accountLabel: string;
  rules: Rules; stats: EnergyStats; deviceCount: number;
}
export interface HomeDetail extends HomeView { devices: DeviceView[]; history: HistoryPoint[] }
export interface DeviceDetail extends DeviceView { homeName: string; history: HistoryPoint[] }
export interface NotificationView {
  id: string; homeId: string | null; kind: string; title: string; body: string;
  createdAt: number; status: string; sentAt: number | null; error: string | null;
}
export interface Overview {
  now: number; timezone: string; stats: EnergyStats; homes: HomeView[];
  accounts: AccountView[]; history: HistoryPoint[]; alerts: NotificationView[];
}
export interface SettingsView {
  timezone: string; pollSeconds: number; origin: string;
  emailConfigured: boolean; emailFrom: string | null; emailTo: string | null;
  syncing: boolean;
}
