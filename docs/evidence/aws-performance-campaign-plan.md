# Campaña AWS de rendimiento — propuesta para revisión

Estado: preparada el 26 de octubre de 2026; **no autorizada para ejecución**.
Seguimiento: [#193](https://github.com/upc-malvaviscos/findly/issues/193).

Referencias: spec 00 (métricas), specs 06/08/09/21 y revisión #192.

## Objetivo y entorno

Acreditar por separado inscripción completa >98 %, S3 PUT → ENROLLED <3 s y
latencia de galería p95 <500 ms. Usar exclusivamente un entorno AWS de ensayo
identificado y aprobado por el equipo en eu-west-1. Registrar SHA, región,
configuración Lambda, cliente y hora UTC. No reutilizar tokens o fotos de
participantes reales. Esta propuesta no modifica producción ni sus permisos.

## Diseño y límites propuestos

1. Inscripción: 200 intentos válidos en un evento de ensayo sin fotografías,
   concurrencia máxima 2 y tasa máxima 1 inicio/s. Datos consentidos de adultos
   del equipo; repetir material autorizado no representa diversidad biométrica.
   Cada intento tiene identificador anónimo y ventana de 30 s desde el comienzo
   del registro. Contabilizar fallos, timeouts y reintentos sin duplicar éxitos.
   Borrar cada inscripción tras observar su resultado para evitar acumulación.
2. Selfie: guardar por separado tiempos monotónicos del PUT completado y la
   primera observación ENROLLED, con sondeo cada 250 ms. Ese intervalo es una
   cota observada con retraso de sondeo, no el instante exacto del estado. Para
   acreditar el intervalo exacto instrumentar timestamps de evento S3 y escritura
   ENROLLED, correlacionados sin publicar identificadores personales. Ese cambio
   necesita diseño y pruebas antes del ensayo; no reutilizar enrolledAfterMs de #87.
3. Galería: crear las cinco inscripciones de ensayo antes de subir un máximo
   de 20 fotos autorizadas. Preparar galerías de 0, 5 y 20 coincidencias; verificar
   realmente su cardinalidad, sin asumirla por haber subido las fotos. Ejecutar
   200 GET por tamaño a concurrencia 1 y otros 200 a concurrencia 5, máximo
   5 solicitudes/s: 1.200 peticiones en total. Capturar respuesta completa desde
   cliente, estado HTTP y timeout (5 s). No descargar las imágenes en este ensayo;
   medir render y descargas en otro escenario si se pretende acreditarlos.
4. Registrar primeros accesos y señales disponibles de cold start por separado.
   No afirmar una muestra fría controlada sin evidencia. No excluir del informe
   primeras respuestas, errores ni throttling. Repetir la campaña en otro momento
   requerirá revisar de nuevo el presupuesto y la autorización.

## Cálculo y criterios

- Inscripción: completadas/200, porcentaje e intervalo Wilson bilateral al 95 %.
  El criterio puntual >98 % exige al menos 197 éxitos; el intervalo se publica
  para no confundir la tasa muestral con una garantía poblacional.
- Galería: percentil por rango más próximo x[ceil(0,95*n)], índice desde uno,
  para respuestas correctas de cada escenario. Publicar también p50, p99,
  denominador total, errores y timeouts; no juntar escenarios para ocultar el peor.
- Selfie: publicar la distribución y el protocolo temporal exacto. La spec no
  define un percentil para <3 s; acordar esa interpretación antes de ejecutar.
  No cambiar retrospectivamente el criterio según los resultados.
- Un fallo de umbral produce un hallazgo y su issue, nunca la eliminación de datos
  desfavorables. Funcionalidad, similitud y rendimiento son criterios distintos.

## Coste, parada y limpieza

Cota de diseño: 205 indexaciones de selfie y hasta 20 indexaciones de foto más
40 búsquedas si cada foto contiene como máximo dos caras: aproximadamente
0,265 USD en operaciones Group 1 al primer tramo del modelo regional. Presupuestar
hasta 1,50 USD de consumo variable del ensayo, además de almacenamiento,
observabilidad e infraestructura ya existente. Es una estimación, no un límite
facturable impuesto por AWS. No se ejecuta backfill sobre fotos para las 200 altas.

Detener nuevos intentos al superar 5 errores consecutivos, 30 minutos, los límites
de operaciones/datos anteriores o una incidencia de privacidad. No confiar en
Budgets para una parada instantánea: su información puede retrasarse. No enviar
correo, activar SES, crear dominios ni ampliar IAM durante el ensayo. Si falta un
permiso, parar y proponer su cambio por separado.

Antes y después, inventariar únicamente recursos/datos del ensayo. Retirar los
datos consentidos, comprobar ausencia en S3/DynamoDB/Rekognition y revocación de
los tokens; destruir el entorno solo cuando esa operación y sus recursos exactos
estén autorizados. Conservar recibo de limpieza sin rostros, correos ni tokens.

## Entregables y aceptación de la tarea

- [ ] Aprobación del equipo de entorno, ventana, datos, criterio de selfie,
      presupuesto y limpieza; autorización separada antes de llamadas AWS.
- [ ] Arnés revisado con pruebas locales del cronómetro, percentil, denominador,
      timeout, límites de carga y redacción de datos sensibles.
- [ ] CSV depurado por intento (scenario, duration_ms, outcome, attempt_key
      efímero), resumen JSON, comando de cálculo y revisión desplegada.
- [ ] Informe con resultados incluso si incumplen objetivos y recibo de limpieza.
- [ ] Actualizar matriz central, spec 00, evidencia e issue con el resultado real.

Esta entrega prepara el protocolo. El arnés y la ejecución pertenecen a la tarea
posterior; no hay resultados de carga nuevos ni una aprobación operativa implícita.
