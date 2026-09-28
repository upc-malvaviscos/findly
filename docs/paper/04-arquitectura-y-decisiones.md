# 4. Arquitectura y decisiones

La web de Findly se implementa como una SPA estática con React, Vite y TypeScript. ADR-001 descarta Next.js: no se requiere SSR y la salida `dist/` se distribuye desde Amazon S3 mediante CloudFront. Las interacciones dinámicas se resuelven contra API Gateway y Lambda. La API pública descubre eventos, registra asistentes, expone el estado de inscripción y resuelve galerías; las rutas de administración exigen JWT de Cognito. El derecho al olvido usa el token opaco de galería como capacidad de autorización y no registra el token en claro.

La base Terraform declara una tabla DynamoDB on-demand, bucket S3 privado y API HTTP. La tabla usa GSI1 para coincidencias faciales y GSI2 global para listar eventos administrativos por fecha sin `Scan`; ADR-007 documenta esta última decisión. Este capítulo incorporará los diagramas C4 y de despliegue, contratos API, modelo DynamoDB, flujos de datos, IAM y ADRs. También justificará S3 privado, URLs prefirmadas, Cognito, Rekognition, retención y separación de entornos.

La continuación de #70 separa las colecciones Rekognition por entorno y evento
(ADR-015), exige PUT condicional de una sola escritura para selfies (ADR-014)
y conserva referencias de limpieza fuera del TTL de la inscripción (ADR-013).
El marcador permite localizar recursos pendientes aunque desaparezca REG.
La eliminación de rostros se reconcilia con ListFaces y ExternalImageId;
los fallos conservan las referencias para reintentar. No existe una transacción
atómica entre DynamoDB, S3 y Rekognition. Los resultados locales no acreditan
la ejecución de estos recorridos en AWS.
