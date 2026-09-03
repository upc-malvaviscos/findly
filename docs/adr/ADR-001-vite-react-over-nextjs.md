# ADR-001: Adopción de React + Vite en lugar de Next.js para la Web Estática Serverless

## Estado
**ACEPTADO** (2026-09-03)

## Contexto y Problema
La arquitectura del proyecto Findly tiene como principio fundamental la reducción al máximo de los costes de infraestructura (**Objetivo FinOps de coste fijo $0/mes**) y la maximización del modelo Serverless. 

Inicialmente se contempló el uso de Next.js. Sin embargo, al desplegar la aplicación sobre Amazon S3 y Amazon CloudFront mediante exportación estática (`output: 'export'`), el 80% de las funcionalidades clave de Next.js (Server Components, Server-Side Rendering - SSR, API Routes de Node.js, optimización dinámica de imágenes y middleware en servidor) quedan deshabilitadas. El uso de Next.js para una Single Page Application (SPA) pura introduce una sobrecarga de compilación, mayor tamaño en los paquetes de JavaScript y configuraciones innecesarias (`images: { unoptimized: true }`).

## Decisiones Consideradas

1. **Next.js con exportación estática (`output: 'export'`)**: Mantiene el framework inicial pero arrastra sobrecarga de runtime y limitaciones de configuración en compilación estática.
2. **Despliegue de Next.js en servidor (EC2 / ECS / AWS Amplify)**: Permite SSR pero introduce costes fijos mensuales ($15 - $50/mes) o complejidad de servidores que violan el principio del proyecto.
3. **React + Vite (TypeScript)**: Genera una SPA estática pura, con tiempo de compilación ultrarrápido (esbuild/Rollup), menor tamaño de bundle y enrutamiento cliente transparente con React Router v6/v7.

## Decisión Aprobada
Adoptar **React + Vite + TypeScript** como la pila tecnológica estándar para el frontend web de Findly.

La compilación generará artefactos estáticos puros en la carpeta **`dist/`**, los cuales serán sincronizados al bucket privado de S3 (`s3://findly-web-${env}`) y distribuidos globalmente mediante **Amazon CloudFront con Origin Access Control (OAC)**. Todas las interacciones dinámicas de la aplicación se realizarán mediante llamadas HTTP asíncronas directamente desde el navegador hacia Amazon API Gateway.

## Consecuencias

### Positivas
- **Coste Fijo $0/mes (FinOps)**: Cumple al 100% con la capa gratuita de CloudFront (1 TB/mes) y S3 sin necesidad de servidores web encendidos.
- **Rendimiento de Desarrollo (DX)**: Tiempos de arranque de servidor de desarrollo e HMR instantáneos gracias a esbuild/Vite.
- **Compilación Limpia y Ligera**: El resultado de `npm run build` es una carpeta `dist/` estática sin dependencias de runtime de Next.js.
- **Simplificación del CI/CD**: Despliegues directos en S3 mediante `aws s3 sync dist/ s3://bucket --delete`.

### Negativas / Mitigaciones
- **Sin Server-Side Rendering (SSR)**: La carga inicial depende de la ejecución de JavaScript en cliente. 
  - *Mitigación*: Las pantallas de galería y registro utilizan esqueletos de carga animados (Skeletons) y no requieren indexación SEO pública por motivos de privacidad GDPR.
- **Enrutamiento SPA en CloudFront**: Al recargar páginas dinámicas en cliente, CloudFront requiere una regla de respuesta de error personalizada (Custom Error Response: 404 -> `/index.html` HTTP 200).

## Trazabilidad
- Afecta a los tickets de especificación: `01`, `03`, `13`, `14`, `16`.
- Sustituye las referencias de `out/` por `dist/` en los pipelines de CI/CD.
