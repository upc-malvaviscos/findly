# 15 - Destrucción no productiva cada 12 horas

## Objetivo
Eliminar gasto de todos los entornos no productivos sin tocar demo/producción.

## Requisitos
- Cron cada 12 horas y disparo manual; iterar solo `sandbox`/`development` con estado separado.
- Ejecutar `terraform destroy -var=allow_bucket_destroy=true`; vaciar únicamente buckets con prefijo del entorno objetivo.
- Verificar por tags y outputs que API, Lambdas, DynamoDB, Rekognition y buckets desaparecieron; conservar estado bootstrap.

## Aceptación
Un dry run enumera exclusivamente recursos no productivos y una ejecución registrada no afecta demo/producción.
