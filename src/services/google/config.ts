/**
 * Client ID de OAuth (público por diseño). Se configura en .env:
 *   VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
 * Ver README → "Grupos compartidos (Google Sheets)".
 */
export const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID

export function isGoogleConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID)
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
].join(' ')
