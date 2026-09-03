# 04 - Administración y autorización con Cognito

## Objetivo
Restringir la creación de eventos y la subida masiva de fotografías exclusivamente a organizadores autenticados mediante AWS Cognito User Pools, protegiendo las rutas administrativas en el cliente web y en API Gateway.

## Requisitos de Arquitectura e Infraestructura

### Provisión de Cognito (Terraform)
- **User Pool**: Configurado con política de contraseñas robusta (mínimo 12 caracteres, mayúsculas, minúsculas, números y símbolos).
- **MFA**: Opcional/Recomendado para administradores.
- **Client App**: Cliente de App Cognito sin secreto cliente (para uso seguro en Single Page Application / Next.js export).
- **API Gateway Authorizer**: Autorizador JWT (JWT Authorizer) integrado en las rutas administrativas de API Gateway.

## Especificación Frontend del Portal de Administración

### Estructura de Rutas Protegidas (`/admin/*`)
- `/admin/login`: Pantalla de autenticación Cognito (usuario/contraseña).
- `/admin/events`: Listado de eventos creados y formulario de alta de nuevo evento.
- `/admin/events/[eventId]/upload`: Panel de carga masiva de fotografías del evento.

### Gestión de Autenticación en Cliente (`AuthProvider`)
- Implementar un contexto React (`AuthProvider`) y hook `useAuth()` para manejar el estado de autenticación.
- Almacenamiento seguro del ID Token JWT en memoria de la SPA (o `sessionStorage`), evitando persistir credenciales sensibles en `localStorage`.
- Interceptor HTTP que adjunta automáticamente el encabezado `Authorization: Bearer <ID_TOKEN>` en todas las peticiones a API Gateway.
- Verificación automática de expiración del token JWT (campo `exp` del payload); redirección limpia a `/admin/login` al expirar la sesión.

### Componente de Carga Masiva (`BulkPhotoUploader`)
- Selección múltiple de fotos (JPG/PNG) mediante drag-and-drop.
- **Pool de Concurrencia**: Control en cliente para ejecutar un máximo de 3 subidas simultáneas a S3.
- Gestión de estados por archivo: `QUEUED` -> `REQUESTING_PRESIGNED_URL` -> `UPLOADING_S3` -> `SUCCESS` | `FAILED`.
- Resumen visual con barra de progreso global y desglose por archivo con botón de reintento en caso de fallo de red.

### Formulario de Creación de Eventos
- Campos: Nombre del evento, fecha de celebración, retención en días (TTL).
- Validación Zod en cliente y llamada `POST /events` con cabecera JWT.

## Criterios de Aceptación
- Cualquier petición sin cabecera `Authorization` válida a una ruta administrativa devuelve HTTP 401 Unauthorized o 403 Forbidden.
- La navegación dentro de `/admin/*` sin sesión activa redirige inmediatamente a `/admin/login`.
- Los logs del cliente y de CloudWatch nunca registran contraseñas, tokens completos ni datos biométricos.
