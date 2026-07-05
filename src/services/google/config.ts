/**
 * Credenciales públicas de la app (van en el build; se protegen restringiéndolas
 * a los orígenes autorizados en Google Cloud). Se configuran en .env:
 *   VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
 *   VITE_GOOGLE_API_KEY=AIza...   (para el selector de archivos de Google)
 * Ver README → "Publicar tu propia instancia".
 */
export const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID
export const GOOGLE_API_KEY: string | undefined = import.meta.env.VITE_GOOGLE_API_KEY

export function isGoogleConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID)
}

/** Número de proyecto de Google Cloud (prefijo del Client ID); lo exige el Picker. */
export function googleProjectNumber(): string | undefined {
  return GOOGLE_CLIENT_ID?.split('-')[0]
}

/**
 * Solo permisos NO sensibles: la app únicamente puede tocar las hojas que ella
 * misma crea o que el usuario elige con el selector de Google. Esto permite
 * publicar sin verificación de Google y sin límite de usuarios.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
].join(' ')
