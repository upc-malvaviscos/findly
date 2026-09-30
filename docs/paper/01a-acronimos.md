# Acrónimos y glosario

Acrónimos usados en esta memoria, agrupados por ámbito. Los términos de
dominio propios de Findly (identificadores de clave DynamoDB como `REG#`,
`MATCH#` o `TOKEN#`) se explican en su lugar de uso, capítulo 4, y no se
repiten aquí.

## Proyecto y metodología

| Acrónimo | Significado                                                                                 | Contexto en esta memoria                                                           |
| -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| TFM      | Trabajo de Fin de Máster                                                                    | Esta memoria documenta el TFM del Postgrado en Cloud Computing Architecture (UPC). |
| MVP      | Minimum Viable Product (producto mínimo viable)                                             | Alcance congelado en la spec 00 y el capítulo 2.                                   |
| ADR      | Architecture Decision Record (registro de decisión de arquitectura)                         | 15 ADRs en `docs/adr/`, citados a lo largo de la memoria.                          |
| HLD      | High-Level Design (diseño de alto nivel)                                                    | Primera mitad del capítulo 4: visión general y componentes.                        |
| LLD      | Low-Level Design (diseño de bajo nivel)                                                     | Segunda mitad del capítulo 4: contratos, claves y permisos exactos.                |
| CI/CD    | Continuous Integration / Continuous Deployment (integración continua / despliegue continuo) | GitHub Actions, capítulo 5.                                                        |
| PR       | Pull Request                                                                                | Unidad de integración de código; nunca se hace merge directo a `main` (AGENTS.md). |
| SPA      | Single-Page Application (aplicación de página única)                                        | La web de Findly, React + Vite (ADR-001).                                          |

## Arquitectura web y API

| Acrónimo | Significado                                                                  | Contexto                                                           |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| API      | Application Programming Interface (interfaz de programación de aplicaciones) | API Gateway HTTP, capítulo 4.                                      |
| HTTP     | HyperText Transfer Protocol                                                  | Protocolo de todas las llamadas cliente-servidor.                  |
| URL      | Uniform Resource Locator                                                     | Enlaces de galería, URLs prefirmadas de S3.                        |
| JSON     | JavaScript Object Notation                                                   | Formato de todos los contratos de API y de los logs estructurados. |
| YAML     | YAML Ain't Markup Language                                                   | Formato de los workflows de GitHub Actions.                        |
| JWT      | JSON Web Token                                                               | Token de autenticación de Cognito en rutas de administración.      |
| CORS     | Cross-Origin Resource Sharing (compartición de recursos de origen cruzado)   | Configurado en API Gateway y en el bucket S3 de cargas.            |
| SSR      | Server-Side Rendering (renderizado en servidor)                              | Descartado por ADR-001: Findly no lo necesita.                     |
| SDK      | Software Development Kit                                                     | AWS SDK v3 para JavaScript, usado por todas las Lambdas.           |

## Servicios e infraestructura AWS

| Acrónimo | Significado                                                    | Contexto                                                                                    |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AWS      | Amazon Web Services                                            | Proveedor cloud único del proyecto.                                                         |
| IAM      | Identity and Access Management (gestión de identidad y acceso) | Roles de mínimo privilegio, uno por Lambda (capítulo 6).                                    |
| VPC      | Virtual Private Cloud (nube privada virtual)                   | Explícitamente **no usada** (ADR-002).                                                      |
| NAT      | Network Address Translation (traducción de direcciones de red) | Explícitamente **no usado** (ADR-002).                                                      |
| EKS      | Elastic Kubernetes Service                                     | Explícitamente **no usado**; fuera del alcance (README).                                    |
| RDS      | Relational Database Service                                    | Alternativa analizada y descartada para el MVP (ADR-002, issue #49).                        |
| SQS      | Simple Queue Service                                           | Desacopla la ingesta de fotos (ADR-006).                                                    |
| DLQ      | Dead-Letter Queue (cola de mensajes muertos)                   | Recibe mensajes tras 3 fallos de `PhotoMatcher`.                                            |
| SNS      | Simple Notification Service                                    | Topic de alertas (DLQ y presupuesto), issue #13.                                            |
| GSI      | Global Secondary Index (índice secundario global)              | `GSI1` (rostro→registro) y `GSI2` (listado de eventos) en DynamoDB.                         |
| TTL      | Time to Live                                                   | Atributo de purga automática por retención en DynamoDB.                                     |
| OAC      | Origin Access Control                                          | Restringe CloudFront al bucket S3 privado de la web.                                        |
| SSE      | Server-Side Encryption (cifrado del lado del servidor)         | SSE-S3 (AES256) en todos los buckets.                                                       |
| OIDC     | OpenID Connect                                                 | Autenticación federada de GitHub Actions hacia AWS, sin claves de larga duración (ADR-008). |

## Seguridad y privacidad

| Acrónimo | Significado                                                                    | Contexto                                                                         |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| GDPR     | General Data Protection Regulation (Reglamento General de Protección de Datos) | Consentimiento, minimización y derecho al olvido (spec 09).                      |
| PII      | Personally Identifiable Information (información de identificación personal)   | Excluida por diseño de los logs estructurados (capítulo 6).                      |
| TLS      | Transport Layer Security                                                       | Tráfico cifrado en tránsito; política TLS-only en el bucket de estado Terraform. |

## Unidades y verbos HTTP

`GET`, `POST`, `PUT` y `DELETE` son verbos estándar del protocolo HTTP, usados
según su semántica REST habitual (lectura, creación, sustitución idempotente y
borrado). `USD`, `GB` y `MB` son las unidades monetarias y de almacenamiento
usadas en el capítulo 7 (FinOps).
