import type { Language } from './i18n.js';

export const pushKinds = [
  'threshold',
  'anomaly',
  'weekly',
  'readings_lost',
  'readings_restored',
  'account_problem',
  'account_restored',
] as const;
export type PushKind = (typeof pushKinds)[number];
export const defaultPushKinds: PushKind[] = pushKinds.filter((kind) => kind !== 'weekly');
export interface PushPreferences {
  name: string;
  language: Language;
  kinds: PushKind[];
}
export interface PushReceiver extends PushPreferences {
  id: string;
  enabled: boolean;
  state: 'active' | 'disabled' | 'expired';
  createdAt: number;
  updatedAt: number;
  lastSubmittedAt: number | null;
  error: string | null;
}
export interface PushConfigView {
  configured: boolean;
  publicKey: string | null;
}
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  icon: string;
}
export interface PushSummary {
  submitted: number;
  pending: number;
  failed: number;
  cancelled: number;
}

export const pushLabels: Record<PushKind, string> = {
  threshold: 'Daily energy threshold',
  anomaly: 'Unusual energy usage',
  weekly: 'Weekly summary',
  readings_lost: 'Readings lost',
  readings_restored: 'Readings restored',
  account_problem: 'Tuya connection problem',
  account_restored: 'Tuya connection restored',
};
