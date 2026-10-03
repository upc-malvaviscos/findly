# Issue #15: alternativa de demo sin dominio propio

## Alcance autorizado

2026-10-03: la persona responsable autoriza ajustar configuración para permitir
HTTPS en el dominio generado de CloudFront. Solo demo; no despliegue, permisos
AWS/GitHub externos ni destrucción. Specs anteriores del backlog conservadas.

## Implementación

- CloudFront permite certificado AWS predeterminado con dominio/ACM vacíos solo
  en demo. Dominios propios mantienen ACM us-east-1/TLSv1.2_2021.
- El stack calcula frontend_origin desde la distribución o dominio propio y lo
  conecta a CORS de API, S3 PUT y GalleryReader; sin hosting conserva origen local.
- Deployment acepta variables de dominio/certificado vacías en demo y publica
  la dirección en su resumen. No altera el flujo efímero de PR.
- ADR-016 registra la excepción TLS. Specs 03/14 y runbooks reflejan ambos modos.
- Ocho pruebas Terraform con AWS mock verifican composición del plan y rechazos;
  incluidas en verify y CI. No crean recursos ni consultan servicios AWS.

## Validación local

Node 24.20.0, npm 11.19.0 y Terraform 1.14.8; dependencias desde npm ci.

- Entorno local listo con harness:check.
- 297 tests en 38 archivos y gates de cobertura: pasan.
- terraform:test:hosting: 3 planes de stack y 5 casos de certificado pasan.
- Código, workflows y Markdown: pasan.
- npm run verify completo: pasa (lint, tipos, 297 tests, build, formato/validación
  de cinco roots Terraform, 8 planes mock, security y sync). Auditoría de
  dependencias de producción: cero vulnerabilidades.

Las pruebas mock usan cuenta/recursos sintéticos. Advertencias previas de
hash_key/range_key de DynamoDB conservadas; no se cambia el esquema.

## Pendientes de la issue #15

Configuración del environment/rol externo, autorización de los cuatro actores,
workflow de destrucción y evidencia AWS de deploy/recorrido/destroy. Esta entrega
no cierra #15 ni acredita una demo publicada. No implementa las issues #86-#89.
