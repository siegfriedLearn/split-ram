# Ram Split

App tipo Splitwise con todas las funciones "Pro" gratis, enfocada en mejorar tus finanzas
personales. PWA local-first: tus datos viven solo en tu dispositivo (IndexedDB), sin
cuentas ni servidores.

## Funcionalidades

**Gastos compartidos**
- Grupos (Hogar, Viaje, Pareja…) y personas locales, sin registro.
- 5 métodos de división: partes iguales, montos exactos, porcentajes, partes (shares) y
  por ítems del recibo (itemización).
- Múltiples pagadores por gasto.
- Balances por grupo o globales, simplificación de deudas (min cash flow) y registro de pagos.
- Gastos recurrentes (semanal / mensual / anual) que se crean solos al abrir la app.
- Multi-moneda con tasa de cambio automática (open.er-api.com) o manual, congelada por gasto.
- Foto de recibo con OCR en el navegador (tesseract.js) que pre-llena monto y fecha.
- Búsqueda y filtros por texto, categoría, grupo, persona y rango de fechas.

**Análisis financiero**
- Dashboard con total del período, promedio mensual, donut por categoría con ranking,
  tendencia mensual y evolución apilada por categoría.
- Toggle **"Mi parte" vs "Total"**: analiza lo que realmente te corresponde de cada gasto.
- Presupuestos mensuales por categoría con barra de progreso y alerta al excederse.
- Insight automático: tu categoría más fuerte del mes y su variación vs. el mes anterior.

**Exportación**
- CSV y Excel (hojas: Gastos, Resumen por categoría, Pagos).
- PDF con resumen, tablas y los gráficos incluidos.
- Respaldo JSON completo (incluye recibos) con restauración desde Ajustes.

## Grupos compartidos (Google Sheets) — multiusuario sin backend

Cada grupo compartido vive en una **hoja de Google Sheets en el Drive del creador**. La app
(100% estática) lee y escribe la hoja directamente desde el navegador con la cuenta Google
de cada miembro. Sin servidores, sin costos de mantenimiento, y con el permiso limitado
`drive.file`: la app solo puede tocar las hojas que ella misma crea o que el usuario elige.

### Para usuarios: nada que configurar

1. Abre la URL de la app publicada e instálala ("Instalar aplicación" en el menú de Chrome).
2. **Compartir**: entra al grupo → ícono de compartir → conectar Google → emails →
   "Crear hoja y compartir". Google envía la invitación por correo y la app te da un
   **link de unión** para mandar por WhatsApp.
3. **Unirse**: el invitado abre el link, conecta su cuenta Google y elige la hoja del grupo
   en el selector de Google (solo la primera vez — es lo que autoriza a la app a esa hoja).
   Si su email coincide con un miembro, la app lo reconoce sola.
4. **Sincronización**: al abrir la app, tras cada cambio y cada 60 s con la app visible.
   Conflictos: gana la última edición. Las fotos de recibos no se sincronizan.

### Publicar tu propia instancia (avanzado, una sola vez, gratis)

Quien publica la app configura un proyecto de Google Cloud; sus usuarios no configuran nada.

1. Crea un proyecto en [console.cloud.google.com](https://console.cloud.google.com)
   (sin tarjeta) y habilita **Google Sheets API**, **Google Drive API** y
   **Google Picker API** (APIs y servicios → Biblioteca).
2. **Pantalla de consentimiento OAuth**: tipo Externo. No subas logo (dispara verificación
   de marca). Pon como Privacy Policy la URL `https://<tu-url>/privacidad.html`. Declara
   solo los scopes no sensibles (`drive.file`, `openid`, `email`). Luego
   **Publish app → In production** — al ser scopes no sensibles no requiere verificación
   ni lista de usuarios de prueba: cualquier cuenta Google del mundo puede usarla.
3. **Credenciales**:
   - OAuth Client ID tipo **Aplicación web** con tus URLs en *Orígenes de JavaScript
     autorizados* (producción y `http://localhost:5173` para desarrollo).
   - **API key** restringida por referrer (`https://<tu-url>/*`) para el selector de Google.
4. Variables de entorno (en `.env` local y en tu hosting):
   ```
   VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   VITE_GOOGLE_API_KEY=AIza...
   ```
5. Despliega gratis: `npx vercel --prod` (o Netlify/Cloudflare Pages). La URL resultante es
   la que comparte todo el mundo; la PWA se actualiza sola.

Límites del proyecto compartido: cuota de Sheets API ~300 lecturas/min sumando todos los
usuarios (ampliable gratis solicitándolo en la consola); el token de Google dura ~1 h y se
renueva con un toque cuando la app lo pide.

### Opcional: Play Store

La PWA pública ya cubre Android/iOS/escritorio. Si quieres presencia en Play Store,
empaqueta la misma URL con [PWABuilder](https://www.pwabuilder.com) (TWA); requiere cuenta
de desarrollador de Google Play (US$25 una vez). La app seguirá actualizándose desde la URL.

## Desarrollo

```bash
npm install
npm run dev       # servidor de desarrollo
npm test          # tests de la lógica de dominio (35 tests)
npm run build     # build de producción (PWA con service worker)
npm run preview   # sirve el build
```

## Stack

React 19 + TypeScript + Vite · Tailwind CSS 4 · Dexie (IndexedDB) · Recharts ·
SheetJS · jsPDF · tesseract.js · vite-plugin-pwa · Vitest

## Arquitectura

- `src/domain/` — lógica pura y testeada (splits, balances, simplificación de deudas,
  recurrencias, analítica). Sin dependencias de UI ni base de datos.
- `src/db/` — esquema Dexie y tipos. Todas las entidades usan UUID, timestamps y borrado
  suave, para poder sincronizar con un backend (p. ej. Supabase) en el futuro sin migraciones dolorosas.
- `src/features/` — páginas: gastos, grupos, balances, análisis, exportación y ajustes.
- `src/services/` — tasas de cambio, OCR y materialización de recurrentes.

Los montos se guardan en **centavos enteros**; los repartos usan el método del mayor
residuo, así que la suma de las partes siempre cuadra con el total.
