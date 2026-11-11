# Zambomba Flamenca Ronda

Aplicación web inicial para informar del evento y registrar reservas.

## Importante
- Una reserva NO es una entrada.
- El botón «YA HE REALIZADO EL BIZUM» solo avisa; no comprueba el pago.
- La organización debe comprobar el Bizum manualmente antes de confirmar.
- La aplicación genera tokens QR al confirmar, pero el control de acceso completo, envío de correo, protección de sesiones compartidas y revisión legal/privacidad siguen pendientes.
- No abrir ventas reales hasta completar pruebas de seguridad, persistencia, correo y acceso.

## Railway
Requiere volumen persistente montado en `/data` (SQLite), Node 20+, y estas variables privadas:
- `SESSION_SECRET`
- `ADMIN_PASSWORD_HASH` (hash bcrypt de la contraseña de administración)
- `BIZUM_INSTRUCTIONS` (instrucciones no sensibles para el comprador)
- Opcionales: `EVENT_CAPACITY`, `TICKET_PRICE_CENTS`, `EVENT_NAME`, `EVENT_DATE`, `EVENT_TIME`, `EVENT_VENUE`, `EVENT_ARTISTS`

El destinatario Bizum y datos bancarios no deben publicarse en GitHub. El correo de entradas aún no está configurado en esta versión.
