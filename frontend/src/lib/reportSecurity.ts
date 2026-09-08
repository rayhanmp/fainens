export type PdfPasswordFormat = 'DDMMYYYY' | 'YYYYMMDD';

export interface ReportSecuritySettings {
  pdfPasswordEnabled: boolean;
  /** Legacy browser-only fallback; new profiles store this through the API. */
  birthDate: string;
  pdfPasswordFormat: PdfPasswordFormat;
}

export const DEFAULT_REPORT_SECURITY: ReportSecuritySettings = {
  pdfPasswordEnabled: false,
  birthDate: '',
  pdfPasswordFormat: 'DDMMYYYY',
};

export function loadReportSecuritySettings(): ReportSecuritySettings {
  try {
    const raw = localStorage.getItem('fainens-settings');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      pdfPasswordEnabled: parsed.pdfPasswordEnabled === true,
      birthDate: typeof parsed.birthDate === 'string' ? parsed.birthDate : '',
      pdfPasswordFormat: parsed.pdfPasswordFormat === 'YYYYMMDD' ? 'YYYYMMDD' : 'DDMMYYYY',
    };
  } catch {
    return DEFAULT_REPORT_SECURITY;
  }
}

export function birthdayPassword(birthDate: string, format: PdfPasswordFormat): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  return format === 'YYYYMMDD' ? `${year}${month}${day}` : `${day}${month}${year}`;
}

export function passwordFormatDescription(format: PdfPasswordFormat): string {
  return format === 'YYYYMMDD' ? 'YYYYMMDD' : 'DDMMYYYY';
}
