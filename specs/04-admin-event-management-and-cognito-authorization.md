# 04 - Administración y autorización con Cognito

## Objetivo
Restringir la creación de eventos y la subida masiva de fotografías exclusivamente a organizadores autenticados mediante AWS Cognito User Pools, protegiendo las rutas administrativas en la SPA y en API Gateway HTTP API mediante autorizadores JWT.

## Alineación con AWS Well-Architected Framework
- **Seguridad**: Autenticación centralizada con Cognito User Pools, autorizador JWT en API Gateway y gestión de tokens en memoria de la SPA (sin credenciales estáticas ni `localStorage`).
- **Eficiencia del Rendimiento**: Subida masiva paralela a S3 regulada mediante un pool de concurrencia cliente de máximo 3 cargas simultáneas.

## Requisitos de Arquitectura e Infraestructura AWS

### Provisión de Cognito (Terraform)
- **User Pool**: Configurado con política de contraseñas robusta (mínimo 12 caracteres, mayúsculas, minúsculas, números y símbolos).
- **Client App**: Cliente de App Cognito sin secreto cliente (`generate_secret = false`) para uso seguro en SPA React + Vite.
- **API Gateway HTTP API Authorizer**: `aws_apigatewayv2_authorizer` configurado con tipo `JWT` y audiencia del Cognito Client App.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Contexto de Autenticación
- En `src/context/AuthProvider.tsx`, crea el contexto React que almacena el ID Token en memoria o `sessionStorage`.
- Proporciona las funciones `login(username, password)` y `logout()`.

### Paso 2: Crear el Interceptor de Peticiones API
- Crea `src/lib/apiClient.ts` utilizando `fetch` o `axios` para adjuntar la cabecera `Authorization: Bearer <ID_TOKEN>` en todas las llamadas administrativas.

### Paso 3: Construir el Subidor Masivo (`BulkPhotoUploader`)
- En `src/components/admin/BulkPhotoUploader.tsx`, implementa la cola de subida.
- Usa un bucle/pool de concurrencia que procese máximo 3 archivos simultáneamente invocando `uploadFileToS3`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Almacenar los tokens JWT en `localStorage`.
  - *Solución*: `localStorage` es vulnerable a ataques XSS. Guarda los tokens en el estado en memoria de React o `sessionStorage`.
- ❌ **ERROR**: Lanzar 50 subidas paralelas a S3 sin limitar concurrencia.
  - *Solución*: Saturará el navegador y la red. Controla la concurrencia a máximo 3 cargas activas a la vez.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] Intentar acceder a `/admin/events` sin autenticar redirige limpiamente a `/admin/login`.
- [ ] El token JWT expira y redirige a la pantalla de login sin mostrar pantalla en blanco.
- [ ] La subida masiva de fotos muestra barra de progreso por archivo y resumen global.
