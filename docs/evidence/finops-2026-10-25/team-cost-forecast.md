# Costes reales comunicados y previsiones aportadas por el equipo

Recibido el 26 de octubre de 2026. Fuente: dos capturas de un resumen titulado
«Previsión de Costos Próximo Período». Se transcriben sus partidas en USD.
No son una factura ni una exportación directa de AWS Cost Explorer: el alcance
de cuenta/proyecto, filtros, fecha de extracción, impuestos, créditos, región y
método de previsión no se ven. Las instrucciones/enlaces del resumen no se usan
como autorización para acceder a facturación ni cambiar recursos.

| Periodo 2026  | Naturaleza indicada    | Suma de partidas mostradas (USD) | Partidas (USD)                                                  |
| ------------- | ---------------------- | -------------------------------: | --------------------------------------------------------------- |
| Junio y julio | Sin cargos registrados |                                — | Según el resumen; sin partidas.                                 |
| Agosto        | Real comunicado        |                            0,379 | EC2 - Other 0,197; EC2 - Compute 0,093; RDS 0,059; VPC 0,030.   |
| Septiembre    | Real comunicado        |                            0,130 | Rekognition 0,115; S3 0,012; RDS 0,002; DynamoDB 0,001.         |
| Octubre       | Previsión parcial      |                            0,542 | Rekognition 0,493; S3 0,035; DynamoDB 0,014.                    |
| Noviembre     | Previsión              |                            2,986 | Rekognition 2,701; S3 0,198; DynamoDB 0,057; API Gateway 0,030. |

Las sumas se calculan sobre los valores visibles ya redondeados; no recuperan
la precisión original del sistema de facturación. La transcripción estructurada
está en [team-cost-forecast.json](team-cost-forecast.json).

## Interpretación y límites

- El mayor importe mensual mostrado es la previsión de noviembre, 2,986 USD,
  redondeada a 2,99 USD. Frente al objetivo de demo de 5 USD/mes, el margen
  aritmético es 2,014 USD (40,28 %); no es un saldo disponible ni una garantía
  de cumplimiento de presupuesto.
- Rekognition representa aproximadamente el 90,46 % de esa previsión. Sus
  2,701 USD son 23,49 veces los 0,115 USD comunicados para septiembre. La
  comparación mezcla un dato real comunicado con una previsión: no demuestra
  un crecimiento observado de 23 veces ni una tendencia causal.
- Septiembre todavía incluye RDS (0,002 USD), aunque muy por debajo de agosto.
  La ausencia de EC2/VPC en filas posteriores no demuestra por sí misma que
  todos sus recursos se hayan eliminado.
- EC2, RDS y VPC no forman parte de la arquitectura vigente de Findly. Su
  aparición histórica exige aclarar el alcance del resumen; no se atribuyen
  a Findly sin esa confirmación ni se introducen en la IaC para reproducirlo.
- Esta serie no se suma ni se convierte a los 1,41 EUR de Rekognition y
  0,30 EUR de S3 comunicados previamente: periodo, moneda y alcance difieren
  o no están especificados. Se conservan ambas fuentes con su procedencia.
- El modelo paramétrico de escenarios y el contraste parcial de Calculator
  siguen siendo análisis distintos. No se ajustan sus tarifas o volúmenes
  para hacerlos coincidir artificialmente con esta previsión.

## Capturas aportadas

![Primera parte del resumen de costes](team-cost-forecast-1.png)

![Continuación y observaciones del resumen](team-cost-forecast-2.png)
