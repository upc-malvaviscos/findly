# 7. FinOps, observabilidad y sostenibilidad

Los entornos de pull request se etiquetan `Ephemeral=true` y con su número de
PR, usan DynamoDB bajo demanda y servicios serverless, y se destruyen al final
del workflow que los creó. Esto evita el coste residual de una limpieza cada
doce horas y no introduce RDS, NAT, EC2 ni VPC. El bucket de estado es una
excepción intencionada: es persistente, privado, versionado y queda fuera del
rol de destrucción. La cuenta debe vigilar recursos `Environment=pr-*` que
sobrevivan a una interrupción externa.
