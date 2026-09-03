# 02 - Dominio, contratos y claves DynamoDB

## Objetivo
Establecer contratos compartidos y accesos de datos sin ambigüedad.

## Requisitos
- Modelar Event, Registration, Consent, Photo, Match y GalleryToken.
- Usar `PK=EVENT#{eventId}` y `SK` por entidad; token de galería indexado por hash, nunca el token en claro.
- Definir POST de inscripción, confirmación, estado, carga de fotos y lectura de galería.

## Alternativa a evaluar
Una tabla única simplifica coste y operaciones; tablas separadas simplifican consultas. Mantener una tabla única salvo que los patrones obliguen a GSI no justificados.

## Aceptación
Contratos validados en cliente y Lambda, con pruebas de normalización, consentimiento, tamaño y tipo de archivo.
