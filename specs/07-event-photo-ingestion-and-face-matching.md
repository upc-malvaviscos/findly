# 07 - Fotos de evento y matching

## Objetivo
Encontrar coincidencias asíncronas con un umbral explícito.

## Requisitos
- La foto privada activa `SearchFacesByImage`; el umbral inicial es 95 y debe ser variable Terraform.
- Guardar foto, similitud, registro y fecha; emitir una galería temporal sin token en claro.
- Gestionar eventos S3 duplicados y errores sin marcar una coincidencia como confirmada.

## Alternativa a evaluar
Añadir SQS/DLQ si los reintentos S3/Lambda no dan evidencia suficiente de recuperación; no añadir cola sin métrica de necesidad.

## Aceptación
Matching válido crea resultado; sin coincidencia no crea galería; fallo queda observable.
