# 4. Arquitectura y decisiones

La web de Findly se implementa como una SPA estática con React, Vite y TypeScript. ADR-001 descarta Next.js: no se requiere SSR y la salida `dist/` se distribuye desde Amazon S3 mediante CloudFront. Las interacciones dinámicas se resuelven contra API Gateway y Lambda. La API pública descubre eventos, registra asistentes, expone el estado de inscripción y resuelve galerías; las rutas de administración exigen JWT de Cognito. El derecho al olvido usa el token opaco de galería como capacidad de autorización y no registra el token en claro.

Este capítulo incorporará los diagramas C4 y de despliegue, contratos API, modelo DynamoDB, flujos de datos, IAM y ADRs. También justificará S3 privado, URLs prefirmadas, Cognito, Rekognition, retención y separación de entornos.
