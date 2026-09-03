# 00 - Alcance, ADRs y métricas

## Objetivo
Congelar el alcance del MVP, establecer la arquitectura de registro de decisiones (ADRs) y definir la matriz de métricas de éxito antes de desplegar recursos en AWS.

## Requisitos de Alcance

### Inclusiones Explícitas (MVP)
- **Web Pública y Registro**: Interfaz Next.js estática (`output: export`) para captura de selfies y registro público.
- **Panel de Administración**: Autenticación mediante AWS Cognito User Pools para organizadores y subida masiva de fotos.
- **Motor de Matching Facial**: Procesamiento asíncrono serverless utilizando AWS Rekognition (`IndexFaces` y `SearchFacesByImage`) desacoplado mediante Amazon SQS.
- **Galería Privada**: Entrega de galerías individuales accesibles mediante tokens temporales y URLs prefirmadas de Amazon S3 (`GET`).
- **Cumplimiento GDPR**: Consentimiento explícito, minimización biométrica, TTL en DynamoDB, S3 Lifecycle y purga automatizada mediante EventBridge Scheduler.
- **Infraestructura como Código**: Terraform para aprovisionamiento reproducible con arquitectura Serverless de coste fijo cero.

### Exclusiones Explícitas (Out of Scope)
- Vigilancia o reconocimiento en tiempo real sobre flujos de vídeo.
- Arquitecturas multirregión o de alta disponibilidad entre regiones.
- Bases de datos relacionales (RDS), instancias EC2 o VPCs con costes fijos mensuales.
- Envíos masivos de correos electrónicos transaccionales o notificaciones SMS.
- Procesamiento de datos de menores sin consentimiento documentado del tutor.

## Registros de Decisiones de Arquitectura (ADRs)
Se exige registrar los siguientes ADRs en `docs/adr/`:
1. **ADR-001**: Adopción de arquitectura Serverless sin RDS ni VPC fija.
2. **ADR-002**: Estrategia de almacenamiento de datos biométricos autorizados y eliminación tras retención.
3. **ADR-003**: Despliegue en una única región (`eu-west-1`) para el MVP.
4. **ADR-004**: Uso de tokens opacos SHA-256 para enlaces temporales de galería sin exposición de identidades.
5. **ADR-005**: Adopción de desacoplamiento S3 -> SQS -> Lambda para la ingesta de fotos de eventos.

## Matriz de Métricas de Éxito

| Métrica | Fuente | Umbral Objetivo | Responsable |
| --- | --- | --- | --- |
| Inscripción completa | CloudWatch / DynamoDB | > 98% de solicitudes completadas con éxito | Frontend / Backend |
| Precisión de coincidencia | Rekognition / DynamoDB | Umbral de similitud >= 95.0% | Backend Matching |
| Tiempo de procesamiento selfie | CloudWatch Metrics | < 3 segundos desde S3 PUT hasta ENROLLED | Backend Cloud |
| Tiempo de respuesta de galería | CloudFront / API Gateway | p95 < 500 ms | Frontend / Platform |
| Control de presupuesto FinOps | AWS Budgets | 100% dentro del límite de $0 en capa gratuita / sandbox ($5 demo) | Plataforma FinOps |
| Verificación de borrado GDPR | Lambda Audit Logs | 100% de los datos purgados tras caducidad/solicitud | QA / Security |

## Criterios de Aceptación
- El archivo `README.md`, los ADRs en `docs/adr/` y la memoria del proyecto en `docs/paper/02-contexto-objetivos-y-alcance.md` están perfectamente alineados.
- Cada métrica definida cuenta con su fuente de telemetría en CloudWatch, umbral objetivo cuantitativo y responsable asignado.
