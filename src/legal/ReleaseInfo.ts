export interface ReleaseInfo {
  appName: string;
  version: string;
  developerBrand: string;
  legalName: string;
  registration: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
}

function env(name: string): string {
  return String((import.meta.env as Record<string, unknown>)[name] ?? '').trim();
}

export const RELEASE_INFO: ReleaseInfo = {
  appName: 'OFELIYA: STRAIN ZERO',
  version: '0.1.0',
  developerBrand: env('VITE_DEVELOPER_BRAND') || 'ChatBot24',
  legalName: env('VITE_DEVELOPER_LEGAL_NAME'),
  registration: env('VITE_DEVELOPER_REGISTRATION'),
  address: env('VITE_DEVELOPER_ADDRESS'),
  supportEmail: env('VITE_SUPPORT_EMAIL') || 'info@chatbot24.su',
  supportPhone: env('VITE_SUPPORT_PHONE'),
};

export function missingReleaseLegalFields(info = RELEASE_INFO): string[] {
  const missing: string[] = [];
  if (!info.legalName) missing.push('VITE_DEVELOPER_LEGAL_NAME');
  if (!info.registration) missing.push('VITE_DEVELOPER_REGISTRATION');
  if (!info.address) missing.push('VITE_DEVELOPER_ADDRESS');
  if (!info.supportEmail) missing.push('VITE_SUPPORT_EMAIL');
  return missing;
}
