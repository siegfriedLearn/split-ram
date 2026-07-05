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
de cada miembro. Sin servidores, sin costos de mantenimiento.

### Configuración única (gratis, ~10 minutos)

1. Entra a [console.cloud.google.com](https://console.cloud.google.com) y crea un proyecto
   (no pide tarjeta).
2. En **APIs y servicios → Biblioteca**, habilita **Google Sheets API** y **Google Drive API**.
3. En **APIs y servicios → Pantalla de consentimiento OAuth**: tipo **Externo**, modo
   **Testing**, y agrega como *test users* los emails (Gmail) de las personas que usarán la
   app (máximo 100).
4. En **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   tipo **Aplicación web**, y en *Orígenes de JavaScript autorizados* agrega la URL donde
   sirvas la app (p. ej. `https://tu-app.vercel.app`) y `http://localhost:5173` para
   desarrollo.
5. Copia el Client ID en un archivo `.env` en la raíz del proyecto:
   ```
   VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   ```
   y reconstruye (`npm run build`).

### Flujo de uso

- **Compartir**: Grupos → ícono de compartir → conectar Google → emails de los miembros →
  "Crear hoja y compartir". Google envía la invitación por correo y la app te da un **link
  de unión** para mandar por WhatsApp.
- **Unirse**: el invitado abre el link (`#/unirse/…`), conecta su cuenta Google y el grupo
  aparece en su app. Si su email coincide con un miembro, la app lo reconoce solo; si no,
  le pregunta "¿quién eres tú?".
- **Sincronización**: al abrir la app, unos segundos después de cada cambio, y cada 60 s
  con la app visible. Conflictos: gana la última edición. Las fotos de recibos no se
  sincronizan (quedan en cada dispositivo).

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
