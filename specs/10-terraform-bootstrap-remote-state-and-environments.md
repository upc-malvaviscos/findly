# 10 - Estado Terraform y entornos

## Objetivo
Evitar que cuatro personas compitan por estado o destruyan el entorno equivocado.

## Requisitos
- Crear bootstrap separado para bucket de estado y lockfile S3, no destruible por teardown.
- Separar estado y prefijo por `sandbox`, `demo` y `production`; exigir `Environment` y `allow_bucket_destroy` explícitos.
- Versionar solo ejemplos de variables.

## Aceptación
Un plan de sandbox no contiene nombres de demo/producción y viceversa.
