# ADR-016: Dominio y certificado predeterminados de CloudFront en demo

## Estado

Aceptado por la persona responsable el 2026-10-03. Implementación local pendiente
de validación y despliegue; no acredita una demo publicada.

## Contexto

No hay un dominio propio disponible. El módulo ya distingue certificado ACM
propio y certificado AWS, pero una precondición rechazaba el segundo modo.
El workflow también exigía dominio/certificado y formaba un origen HTTPS vacío.

## Decisión

- Solo demo puede omitir dominio y certificado; CloudFront genera la dirección
  HTTPS y sirve su certificado predeterminado. No se usa una IP pública.
- Con dominio propio se exige ACM en us-east-1 y TLSv1.2_2021; fuera de demo
  sigue siendo obligatorio. Rechazar certificado configurado sin dominio.
- CORS de API, S3 PUT y GalleryReader usa el origen exacto calculado por Terraform
  desde el dominio propio o el generado, sin comodines ni apply en dos fases.
- Sin hosting web, conservar el origen configurado de desarrollo local.

## Consecuencias

Con certificado AWS la política mínima la fija CloudFront en TLSv1; navegadores
modernos pueden negociar versiones superiores. Esta excepción a spec 03 no
se presenta como cumplimiento de TLSv1.2_2021. HTTPS, OAC y S3 privado se mantienen.
La alternativa no resuelve el remitente SES ni la destrucción manual de #15.

Referencia: [ViewerCertificate AWS](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_ViewerCertificate.html).
