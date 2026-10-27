---
title: 'Proyecto Final De Postgrado'
subtitle: 'Findly: plataforma de gestión y entrega de fotografías de eventos mediante coincidencias biométricas'
author:
  - Anyul Rivas
  - Renato Luzuriaga
  - Martí Fabregat Pous
  - Santiago Oliver Suriñach
institute: 'UPC School of Professional & Executive Development'
date: '2026'
lang: es-ES
toc: true
toc-title: 'Tabla de contenido'
toc-depth: 3
numbersections: true
documentclass: article
papersize: a4
fontsize: 11pt
geometry: margin=2.5cm
header-includes:
  - \usepackage{fancyhdr}
  - \pagestyle{fancy}
  - \fancyhf{}
  - \fancyhead[R]{\itshape Findly - Trabajo de Postgrado}
  - \fancyfoot[R]{\thepage}
  - \renewcommand{\maketitle}{}
figureTitle: 'Ilustración'
tableTitle: 'Tabla'
figPrefix: 'Ilustración'
---

<!--
Compilar (recomendado): make pdf   /   make docx   (ver Makefile)

Compilar a mano:
  pandoc memoria-postgrado.md -o memoria.pdf --pdf-engine=xelatex \
    --filter pandoc-crossref --include-before-body=portada.tex
  pandoc memoria-postgrado.md -o memoria.docx \
    --filter pandoc-crossref --include-before-body=portada.tex

`include-before-body` debe pasarse como flag de línea de comandos, no como
clave del YAML: como metadato no inserta el fichero.

Imágenes: ![Pie](img/archivo.png){#fig:id}
Regenerar diagramas: make diagrams (requiere graphviz y el venv de requirements.txt)
-->

```{=latex}
\newpage
```

# Resumen {.unnumbered}

Findly aborda la localización y entrega de fotografías de eventos mediante
coincidencias faciales, previa inscripción y consentimiento explícito de
personas adultas. El equipo desarrolla un prototipo cloud con una interfaz
React y servicios gestionados de AWS: Lambda para la lógica, DynamoDB para
los datos, S3 para imágenes, Rekognition para la búsqueda facial y SQS para
desacoplar el procesamiento. Terraform describe la infraestructura y GitHub
Actions automatiza su verificación en entornos efímeros.

La contribución del proyecto es integrar estos servicios en un recorrido
trazable de inscripción, matching, galería privada y borrado. El diseño resuelve
el acceso inverso fotografía–participante mediante ítems espejo y limita las
escrituras tardías mediante una barrera de borrado. La evaluación combina
pruebas locales, integración emulada y escenarios ejecutados en AWS, cuyo
alcance se diferencia explícitamente. Los ensayos históricos de borrado
registraron 2,020 s y 3,082 s para fotografías con 100 y 1.000 coincidencias.
La acreditación de percentiles de carga, precisión estadística del
reconocimiento y pruebas concurrentes queda pendiente. El sistema está desplegado con dominio registrado, según
confirmación del equipo, y se presentará mediante una demostración durante
la defensa. La memoria aporta decisiones, evidencias y límites de operación
reproducibles, con conclusiones acotadas a los escenarios medidos.

**Palabras clave:** computación en la nube, serverless, reconocimiento facial,
privacidad, infraestructura como código, evaluación experimental.

# Introducción

## Contexto y problema

En cualquier evento con un número apreciable de asistentes (una jornada
profesional, una boda, una carrera popular, un festival) se generan
rápidamente miles de fotografías repartidas entre varios fotógrafos y
cámaras. El problema que plantea ese volumen afecta a la
usabilidad: cada asistente aparece disperso en un puñado de esas fotos, pero
localizarlas exige revisar manualmente carpetas enteras, confiar en que
alguien las etiquete a mano o dejar parte de las imágenes sin localizar. Las
soluciones habituales, como enviar un enlace a todo el álbum, pedir que cada
persona busque su propia cara entre cientos de imágenes, o compartir
carpetas abiertas sin ningún control de acceso, no escalan y, además, tratan
como públicas fotografías que contienen datos personales de terceros.

Findly nace para resolver ese problema concreto con una propuesta de valor
sencilla: si un asistente acepta explícitamente que su rostro se use para
este fin y aporta una fotografía de referencia (una selfie), el sistema
puede indexar ese rostro, compararlo automáticamente contra las fotos que el
organizador del evento vaya subiendo, y ofrecerle un enlace privado y temporal con las imágenes coincidentes.
Cualquier persona que posea el enlace puede utilizarlo y compartirlo. El
consentimiento explícito y la selfie son requisitos para habilitar la búsqueda
de la galería. Las fotografías grupales pueden contener terceros: su indexación
temporal y su exposición se analizan en la sección de amenazas.

La segunda motivación del proyecto, inseparable de la primera, es demostrar
que este tipo de servicio puede construirse en la nube pública con una
arquitectura de servicios gestionados y cómputo bajo demanda. Un evento es, por definición, una carga de trabajo
puntual y de corta duración: tiene sentido que el coste de la plataforma sea
vinculado a su uso, junto con las partidas de almacenamiento y
observabilidad que permanecen entre eventos.

## Estado del arte y alternativas

La entrega personalizada de fotografías de eventos ya existe como categoría de
producto. La revisión siguiente compara
capacidades declaradas por sus proveedores. Su alcance es una comparación
documental de funcionalidades; evaluar precisión, seguridad y coste total
requiere ensayos específicos.

<!-- prettier-ignore -->
| Alternativa | Aportación | Diferencia relevante para Findly |
| --- | --- | --- |
| Álbum compartido y selección manual | Recopilar y distribuir fotos mediante un enlace común. | Evita la identificación biométrica, pero traslada la búsqueda al asistente y puede exponer el álbum completo. |
| Waldo Photos [26] | Galerías de eventos y distribución de coincidencias mediante reconocimiento facial. | Servicio comercial completo; Findly estudia la construcción y verificación de su propio recorrido cloud. |
| SpotMyPhotos [27] | Inscripción voluntaria con selfie y entrega personal, inmediata o tras revisión. | Ofrece una referencia funcional para el flujo de participación y entrega. |
| Photier [28] | Localización de fotos de eventos a partir de una selfie. | Confirma una necesidad de mercado existente; el coste AWS de Findly se estudia mediante su propio modelo. |

En infraestructura, Rekognition ofrece indexación y búsqueda en colecciones
[1–2]. Azure AI Face es una alternativa gestionada con identificación facial
sujeta a condiciones de acceso [29]. Google Cloud Vision ofrece detección de
rostros [30]; la identificación de personas requiere capacidades adicionales.
Autogestionar un modelo exigiría seleccionar y evaluar el modelo, ejecutar la
inferencia y mantener su índice, además de implementar el mismo ciclo de
consentimiento y borrado. Comparar el coste y la precisión de las alternativas exige un experimento
común, con datos y condiciones equivalentes.

La aportación académica de Findly consiste en diseñar y verificar una
integración serverless reproducible, estudiar sus fallos parciales y relacionar
la privacidad y el coste con decisiones concretas. Los servicios gestionados
cubren las necesidades de ejecución del MVP; su elección se evalúa por su
adecuación al problema y a los objetivos docentes.

## Alcance del MVP

El producto mínimo viable de Findly cubre el recorrido completo de un
asistente y de un organizador de evento, desde la inscripción hasta el
borrado de los propios datos:

- Un asistente accede a la página pública de un evento, acepta el
  consentimiento biométrico y de términos, y sube una selfie mediante una
  URL de carga firmada con escritura condicional.
- Una función Lambda indexa el rostro en Amazon Rekognition y expone el
  estado de la inscripción mientras el navegador lo consulta por sondeo.
- Un organizador, autenticado mediante Cognito en el entorno, crea el evento y carga las fotografías a medida que las va
  teniendo disponibles.
- El sistema compara cada fotografía nueva contra los rostros inscritos y
  construye, para cada asistente, una galería privada de coincidencias.
- El asistente recibe un enlace temporal a su galería y puede, en cualquier
  momento, solicitar la retirada completa de sus datos.

Estas capacidades se validan contra un conjunto de métricas de éxito
cuantitativas (sección de requisitos no funcionales), se limitan a una única
región de AWS y se diseñan desde el principio para operar dentro de los límites
de la capa gratuita o de un presupuesto de demostración acotado, sin capacidad
de cómputo o red dedicada. El almacenamiento retenido y las alarmas pueden
generar consumo sin tráfico. Todas las imágenes usadas durante el desarrollo y
las pruebas son sintéticas o han sido aportadas con autorización explícita del
equipo: en ningún momento se han tratado fotografías reales de terceros sin
consentimiento.

## Elementos excluidos del alcance

Un proyecto de este tipo invita a ampliarse en direcciones que, aunque
técnicamente posibles, cambiarían su naturaleza o su perfil de riesgo de
forma que el equipo decidió excluir explícitamente desde el planteamiento
inicial:

- Vigilancia o reconocimiento facial en vídeo en tiempo real: Findly sólo
  procesa imágenes fijas subidas voluntariamente, nunca una transmisión de
  cámara continua.
- Tratamiento de menores de edad, incluso con autorización de un tutor: queda
  fuera del alcance de este MVP.
- Alta disponibilidad multirregión o cualquier garantía de continuidad de
  servicio propia de un sistema de producción crítico.
- Bases de datos relacionales gestionadas (RDS), instancias de cómputo
  reservado (EC2), redes privadas virtuales dedicadas (VPC), pasarelas NAT o
  clústeres de orquestación de contenedores (EKS), por las restricciones de
  alcance y operación del MVP. Cada servicio tiene su propio modelo de
  facturación; la decisión prioriza capacidad bajo demanda.
- Comunicaciones masivas por correo electrónico o SMS como mecanismo de
  marketing o notificación no solicitada.

Esta delimitación responde a una decisión de diseño: concentra el proyecto
en su recorrido académico y excluye componentes que introducirían
coste fijo, mayor superficie de exposición de datos sensibles o un cambio de
naturaleza del servicio hacia la vigilancia.

## Requerimientos del proyecto

### Requerimientos funcionales

El sistema debe cumplir, como mínimo, los siguientes requisitos funcionales:

1. Un asistente puede aceptar el consentimiento biométrico y cargar una
   selfie mediante una URL de Amazon S3 firmada de una sola escritura; una
   función Lambda indexa el rostro en Amazon Rekognition y el estado de la
   inscripción (pendiente de carga, en proceso, inscrito o fallido) queda
   disponible para que el cliente lo consulte por sondeo.
2. Un organizador, autenticado, puede crear eventos y cargar fotografías; una
   función Lambda, desacoplada mediante una cola de mensajería, busca
   coincidencias faciales con un umbral de similitud mínimo exigente.
3. El asistente recibe una galería privada construida con URLs firmadas de
   corta duración y puede solicitar en cualquier momento la retirada
   completa de sus datos (derecho al olvido), lo que implica borrar el
   registro, las coincidencias encontradas, el token de acceso, la imagen
   original y el identificador facial indexado.
4. Cada evento y los datos que genera caducan según una política de
   retención configurable, con un mínimo de demostración de siete días.

### Requerimientos no funcionales y pilares del Well-Architected Framework

Los requisitos no funcionales de Findly se expresan como una matriz de
métricas de éxito con un umbral cuantitativo y una fuente de telemetría
identificada para cada una, de modo que ninguna de ellas quede como una
aspiración sin forma de comprobarse:

<!-- prettier-ignore -->
| Métrica | Fuente | Umbral objetivo |
| --- | --- | --- |
| Inscripción completa | CloudWatch / DynamoDB | > 98 % de solicitudes completadas |
| Umbral de similitud | Rekognition / DynamoDB | Similitud >= 95,0 % |
| Procesamiento de selfie | CloudWatch Metrics | < 3 s desde la carga en S3 hasta el estado "inscrito" |
| Respuesta de galería | CloudFront / API Gateway | p95 < 500 ms |
| Control de presupuesto (FinOps) | AWS Budgets | 100 % dentro de 0 $ (capa gratuita/sandbox) o 5 $ (demo) |
| Borrado conforme a RGPD | Registros de auditoría | 100 % de los datos purgados tras caducidad o solicitud |

: Matriz de métricas de éxito del MVP {#tbl:metricas}

Estos umbrales son objetivos. El 95 % de similitud es el umbral de comparación
configurado en Rekognition; la precisión estadística requiere un conjunto
etiquetado y su evaluación. La aceptación en AWS real verifica la transición
a `ENROLLED` y los recorridos de matching. Medir el intervalo S3 PUT → `ENROLLED`, el p95 de
galería y el éxito agregado requiere la campaña experimental pendiente. Las
conclusiones sobre borrado y matching se circunscriben a los escenarios
ejercitados; el presupuesto se contrasta en la sección de costes.

Más allá de estos umbrales cuantitativos, el proyecto adopta explícitamente los
seis pilares del AWS Well-Architected Framework como guía para las decisiones
de arquitectura [14–16]. Esta correspondencia
orienta el diseño y relaciona cada pilar con decisiones y resultados concretos.
La memoria distingue los objetivos de diseño del alcance de su verificación.

- **Excelencia operativa.** La base del repositorio estandariza linting, tipado
  estricto en TypeScript y un conjunto único de scripts de verificación que se
  ejecutan igual en local y en integración continua; las puertas de calidad
  automatizadas combinan comprobaciones de tipos, pruebas unitarias, pruebas de
  extremo a extremo y validación de infraestructura como código en trabajos
  paralelos, y un runbook de demostración ejecutable paso a paso documenta cómo
  operar el sistema.
- **Seguridad.** Es, con diferencia, el pilar con más decisiones asociadas: el
  alcance excluye desde el inicio datos de menores y vigilancia masiva; el
  acceso a los buckets de almacenamiento está bloqueado a nivel de servicio y
  sólo se concede mediante URLs firmadas de vida corta; la identidad de los
  organizadores se gestiona con un proveedor de identidad gestionado y el
  autorizador de tokens se valida en la propia puerta de entrada de la API; y la integración entre GitHub Actions y AWS se
  autentica mediante un protocolo de identidad federada sin ninguna clave de
  acceso de larga duración almacenada como secreto.
- **Fiabilidad.** La ingesta de fotografías se desacopla mediante una cola de
  mensajería con una cola de mensajes fallidos, de modo que los picos de carga y
  los fallos transitorios puedan gestionarse con reintentos y redrive; el procesamiento de cada
  rostro es idempotente ante reintentos.
- **Eficiencia del rendimiento.** El modelo de datos usa una única tabla con un
  diseño de tabla única y dos índices secundarios globales; uno permite resolver
  mediante un índice la pregunta "¿qué registro corresponde a este rostro?", sin
  recurrir nunca a un recorrido completo de la tabla.
- **Optimización de costes.** La arquitectura usa servicios gestionados,
  cómputo bajo demanda y peticiones facturadas por uso; el almacenamiento retenido y las
  alarmas pueden facturar sin tráfico. AWS Budgets configura una alerta al 80 %
  del presupuesto. Su función es avisar al equipo. La entrega SNS está
  verificada; la aplicación de Budgets, su disparo propio y la conciliación de
  una factura completa quedan pendientes.
- **Sostenibilidad.** El cómputo bajo demanda adapta la ejecución a las
  peticiones. Los workflows destruyen los entornos de prueba tras cada
  verificación para limitar su tiempo de existencia y el consumo asociado.

## Matriz central de requisitos y resultados

La matriz resume el estado al 25 de octubre de 2026. «AWS» identifica ensayos
en servicios reales; «local» identifica pruebas sobre dobles o emulación. Una
confirmación del equipo se distingue de un artefacto de medición.

<!-- prettier-ignore -->
| Requisito | Resultado y entorno | Estado / evidencia |
| --- | --- | --- |
| Inscripción y consentimiento | Recorrido consentido hasta `ENROLLED` ejercitado en AWS. | Funcional verificado. No mide éxito agregado. |
| Administración y carga | Cognito, firma de cargas y ciclo de fotos/eventos comprobados. | Escenarios AWS verificados. Catálogo administrativo compartido. |
| Matching en ambos órdenes | Selfie antes y después de fotos; paginación de 26 fotos. | Verificado en AWS. Doble escritura DynamoDB/SQS sigue limitada. |
| Galería y descarga | Acceso privado, actualización, estados de token y descarga. | Verificado en AWS. Límite de descarga en WebKit; p95 pendiente de medición. |
| Borrado y retención | Eliminación y purga verificadas en casos concretos de AWS. | Verificado en casos concretos; no hay prueba universal. |
| Barrera de foto y TTL lógico | Corrección integrada; carreras deterministas en local, smoke funcional AWS. | Aceptación AWS específica pendiente. |
| Correo manual | Nueve escenarios AWS, recibo de un buzón y confirmación manual multiproveedor. | Cerrado; fuentes de evidencia diferentes. |
| CI y entorno efímero | Aprovisionamiento, pruebas y limpieza en ejecuciones identificadas. | Smoke verificado con destrucción completa de recursos. No acredita despliegue idéntico en producción. |
| Memoria y publicación | PDF compilado y publicación automática verificada. | Verificado; revisión documental en curso. |
| Inscripción > 98 % y galería p95 < 500 ms | No hay muestra agregada acreditada en las fuentes revisadas. | Acreditación pendiente. |
| Selfie < 3 s y similitud $\geq$ 95 % | Medición del intervalo de selfie pendiente; similitud configurada en 95 %. | Tiempo objetivo pendiente de acreditación; el 95 % corresponde al umbral de comparación. |
| Presupuesto de demo $\leq$ 5 USD | Modelo estimado y canal SNS probado; conciliación de factura completa pendiente. | Estimación separada de gasto real. Budgets proporciona avisos de consumo. |

: Requisitos, evidencia y límites de aceptación {#tbl:trazabilidad}

## Gestión interna del proyecto

### Equipo y contribuciones verificables

Anyul Rivas, Renato Luzuriaga, Martí Fabregat Pous y Santiago Oliver Suriñach
trabajaron sobre un backlog compartido. La siguiente tabla resume sus
contribuciones al proyecto.

<!-- prettier-ignore -->
| Integrante | Contribuciones documentadas |
| --- | --- |
| Anyul Rivas | Controles de despliegue y correo, barrera de borrado y automatización de la memoria. |
| Renato Luzuriaga | Inscripción pública, matching en ambos órdenes, benchmark de fan-out y reintento de cargas. Diagnóstico de errores del ensayo SES. |
| Martí Fabregat Pous | Observabilidad y FinOps, administración de eventos/fotos, pruebas de descarga y sincronización de resultados académicos. |
| Santiago Oliver Suriñach | Cobertura de integración del indexador con S3/DynamoDB emulados y Rekognition simulado; preparación del bloque funcional y demo de la defensa. |

### Cronograma observado y desviaciones

El primer commit conservado es `397abdf`, del 26 de junio de 2026
(`Initial commit`); ese es el inicio observable del repositorio. El backlog
y el desarrollo sistemático se documentan desde el 3 de septiembre.
El cronograma se reconstruye a partir de hitos fechados.
La secuencia prevista por las specs fue fundación, producto, plataforma y
validación; las auditorías y los fallos observados introdujeron iteraciones.

<!-- prettier-ignore -->
| Periodo | Hito y evidencia | Desviación o aprendizaje |
| --- | --- | --- |
| 26 junio 2026 | Primer commit del repositorio. | Inicio observable del proyecto; la actividad posterior se refleja en los hitos fechados. |
| 3–19 septiembre 2026 | Backlog inicial, backend real y modos locales de ejecución. | Separar emulación de validación desplegada; resolver límites del laboratorio académico. |
| 28 septiembre–2 octubre | Auditoría de cierres y aceptación AWS. | Reabrir criterios sin evidencia y dedicar trabajo adicional a aceptación real. |
| 4–15 octubre | Demo, dominio y publicación del circuito de correo. | Resolver permisos y contratos de ensayo; conservar la autenticación de Cognito. |
| 16–23 octubre | Benchmark de borrado, correcciones y barrera temporal. | El timeout y las carreras obligaron a revisar el protocolo; parte de la aceptación concurrente quedó aplazada. |
| 25 octubre | Publicación automática del PDF y recuperación administrativa. | Verificar la entrega documental y el acceso necesario para la demo. |
| 26 de octubre de 2026 (defensa) | Demo de la aplicación desplegada, anunciada por el equipo. | Actividad prevista para la defensa. |

### Metodología de trabajo

Cada tarea sigue el ciclo investigación, plan, implementación y sincronización.
Las especificaciones fijan criterios de aceptación; el seguimiento de tareas
enlaza el cambio y su validación; las decisiones de arquitectura conservan
sus motivos. El código y la documentación se integran mediante revisión antes
de incorporarse a la rama principal, con controles automáticos de calidad. La
evidencia identifica qué se probó y en qué entorno.

La principal desviación metodológica fue cerrar inicialmente tareas con pruebas
locales que no demostraban su funcionamiento desplegado. Una auditoría
posterior revisó los criterios, reabrió
tareas y exigió aceptación AWS. El aprendizaje fue separar la verificación de
implementación de la aceptación de producto, y revisar el cierre incluso
cuando la integración continua está en verde. Esta práctica permite conservar
pendientes verificables sin presentar una mejora futura como trabajo entregado.

# Cuentas AWS, repositorios e infraestructura versionada

## Gestión de AWS

### Cuentas, organización y permisos

Findly aloja sus cargas de aplicación y datos en una cuenta de AWS y una región,
`eu-west-1`. CloudFront es un servicio global y su certificado ACM se gestiona
en `us-east-1`; los datos de negocio permanecen en `eu-west-1`. La
configuración del dominio y esta excepción operativa quedan documentadas
como una decisión de arquitectura propia.

El laboratorio académico impidió completar el bootstrap previsto; el equipo
continuó con una cuenta dedicada. Deben distinguirse dos mecanismos: **S3
Object Lock** protege versiones de objetos frente a eliminación o modificación
durante una retención, mientras que **el bloqueo de estado de Terraform**
coordina ejecuciones concurrentes mediante `use_lockfile=true` y un objeto
`.tflock`. El backend de Findly se configura con lockfile y el bootstrap usa versionado, cifrado, bloqueo de acceso público y protección de
borrado; el lockfile aporta exclusión entre operaciones Terraform, según
documenta el propio proveedor del backend S3 [13].

Dentro de esa cuenta, los tres entornos del proyecto (desarrollo compartido,
demostración y producción) están aislados entre sí mediante prefijos y
claves de estado de Terraform independientes, para reducir errores de selección. La frontera de
seguridad se completa con los roles IAM y la configuración del backend.

### Gestión de usuarios

El proyecto distingue dos planos de usuario completamente distintos. Los
asistentes consultan su galería y solicitan el borrado de sus datos mediante
un token de acceso opaco asociado a su inscripción. Los organizadores, en cambio, se autentican contra un servicio
de identidad gestionado, con una política de contraseñas exigente. El alta
de nuevos organizadores se realiza exclusivamente por invitación administrativa. Una
persona ya autorizada solicita la invitación, el servicio de identidad
genera una contraseña temporal y la propia aplicación obliga a establecer
una contraseña definitiva en el primer acceso, sin que la infraestructura
gestionada como código llegue a conocer ni almacenar esa contraseña en
ningún momento.

### Medidas de seguridad implementadas

Las medidas de seguridad de Findly se apoyan en un principio simple y
aplicado de forma consistente: nada se expone por defecto y todo acceso
tiene que concederse explícitamente y con el alcance más estrecho posible.
En la práctica, esto se traduce en que ningún bucket de almacenamiento
admite una política de acceso público (las cuatro banderas de bloqueo de
acceso público de Amazon S3 están activas en todos ellos, junto con cifrado
del lado del servidor por defecto); en que cada función de cómputo tiene su
propio rol de ejecución, sin permisos compartidos con ninguna otra función;
y en que la integración continua intercambia un token de identidad firmado por la
propia plataforma de integración continua por credenciales temporales en
el momento de cada ejecución. El navegador accede a fotografías y selfies mediante URLs firmadas breves;
las funciones de procesamiento acceden con sus roles IAM.

## Gestión de GitHub

### Estructura del repositorio y convenciones

El repositorio organiza el código de aplicación, la infraestructura como
código, las pruebas de extremo a extremo y la documentación en directorios
separados y de responsabilidad única, con una convención de nombrado de
ramas según el tipo de cambio (funcionalidad nueva, corrección,
documentación o mantenimiento) y un formato estructurado de mensajes de
commit verificado automáticamente antes de cada commit mediante un gancho
local. Ninguna herramienta de calidad estática (formateador, analizador de
estilo, comprobador de infraestructura o de flujos de trabajo de
integración continua) se salta ni en local ni en remoto: ambos ejecutan
exactamente los mismos comandos.

### Infraestructura como código

Toda la infraestructura de AWS se describe con Terraform, organizada en un
conjunto de módulos reutilizables que un único módulo de alto nivel compone
en una pila completa. Esa pila se reutiliza, con parámetros distintos, desde
siete raíces de Terraform independientes: el arranque único del backend de
estado remoto, los tres entornos persistentes (desarrollo compartido,
demostración y producción), el entorno efímero asociado a cada pull
request, y dos raíces compartidas para la identidad de correo saliente y el
certificado del dominio web. Todas comparten un mecanismo de bloqueo nativo
del propio backend de estado en S3, sin depender de una tabla adicional
para gestionar ese bloqueo.

### Conexión entre GitHub y AWS

La integración entre GitHub Actions y AWS se basa íntegramente en
autenticación federada mediante OpenID Connect: cada ejecución de un flujo
de trabajo recibe de GitHub un token de identidad firmado y específico de
esa ejecución, que AWS intercambia por credenciales temporales a través de
una relación de confianza que valida el proveedor, la audiencia y el
claim `sub` correspondiente al repositorio y al contexto autorizado [12]. Existen roles de IAM
distintos para cada propósito: uno para el entorno efímero de pull request,
con permisos acotados por un prefijo de nombre de recurso y una etiqueta que
marca los recursos como temporales; y uno por entorno de despliegue manual
(desarrollo compartido, demostración y producción), cada uno con su propia
relación de confianza restringida a ese entorno concreto de GitHub [12].

### Gestión de secretos y variables

Las variables de configuración no sensibles de cada entorno (la región, el
nombre del proyecto, el centro de coste, la clase de dato o el dominio de
origen autorizado) se versionan junto con el código de infraestructura,
porque no suponen ningún riesgo si se hacen públicas; una comprobación
automática impide que se cuele por error un valor sensible en esos
ficheros. Los valores realmente sensibles, como la dirección de correo que
recibe las alertas, se inyectan en el momento de la ejecución y nunca se
versionan. Ninguna credencial de AWS de larga duración llega a existir como
tal: toda autenticación, tanto desde la integración continua como desde una
sesión de desarrollo local, se resuelve con credenciales temporales.

## Ciclo de vida del código y CI/CD

Cada cambio propuesto al repositorio dispara automáticamente un conjunto de
comprobaciones organizadas en flujos de trabajo independientes, cada uno con
una responsabilidad única. Un primer flujo de trabajo ejecuta, en paralelo y
sin tocar AWS, la validación del frontend (tipos, estilo, varios cientos de
pruebas unitarias con medición de cobertura, y la propia compilación), la
validación de la infraestructura como código, un análisis de seguridad y de
sincronización documental, y una batería de pruebas de extremo a extremo
contra un navegador real. Un segundo flujo de trabajo, reservado a pull
requests internas del propio repositorio, es el único que llega a desplegar
infraestructura real en AWS: aprovisiona un entorno completo y aislado
identificado por el número de esa pull request concreta, ejecuta contra él
un recorrido de aceptación de extremo a extremo con un navegador real, y
ejecuta su destrucción al finalizar, también cuando fallan las pruebas. La
limpieza se verifica por separado: un error de teardown requiere intervención
y exige comprobar la retirada efectiva de los recursos facturables. Una pull request sólo se
fusiona a la rama principal cuando todas las comprobaciones obligatorias
están en verde; el repositorio dispone además de un flujo de auto-merge sujeto a esos
controles. El despliegue de la aplicación persistente se inicia mediante el workflow manual.

Los cambios exclusivamente documentales o de las herramientas de compilación
de esta memoria se distinguen del código desplegable: conservan las
comprobaciones estáticas, pero no necesitan crear un entorno AWS. La propia
memoria se mantiene como Markdown y se compila a PDF con Pandoc, un filtro de
referencias cruzadas y XeLaTeX, dentro de un contenedor versionado. Tras una
integración relevante, una comprobación de GitHub confirma el commit integrado
y los ficheros afectados antes de publicar el PDF como una versión descargable.
Este paso también cubre las fusiones del bot, cuyos eventos no encadenan por
sí solos otro workflow de push. Cada versión enlaza su commit y conserva un
nombre fechado con hora de Madrid; eventos repetidos del mismo commit reutilizan
la publicación existente. La compilación del artefacto documental utiliza las herramientas de GitHub Actions.

### Revisión de PR y entornos efímeros

![Controles de pull request y ciclo del entorno AWS efímero](img/workflow-pr.png){#fig:workflow-pr}

La @fig:workflow-pr distingue los controles locales/emulados de la aceptación
AWS. La elegibilidad decide si una PR requiere infraestructura; los cambios
exclusivos de documentación conservan validación sin desplegar AWS. El
teardown tiene su propio resultado: un fallo exige comprobar recursos y coste.

### Compilación y publicación de la memoria

![Validación y publicación de la memoria PDF](img/workflow-pdf.png){#fig:workflow-pdf}

La @fig:workflow-pdf resume ese proceso. La pull request compila el documento
para validarlo; la publicación de una versión usa únicamente cambios ya
integrados en la rama principal.
La deduplicación por SHA evita publicar dos veces el mismo origen, mientras
que la cola estándar puede sustituir una ejecución pendiente durante una
ráfaga. Las ejecuciones seleccionadas por la cola determinan las revisiones
que llegan a publicarse.

## Estrategia de despliegue

El despliegue a un entorno persistente (desarrollo compartido,
demostración o producción) es siempre una acción manual, disparada de forma
explícita y nunca automática, con una entrada booleana que por defecto
limita la ejecución a generar y validar el plan de cambios sin aplicarlo:
una ejecución "en seco" segura de repetir cuantas veces haga falta. Un
guardián automático lee ese plan en formato estructurado y rechaza la
ejecución si detecta cualquier borrado o sustitución de un recurso ya
existente, o cualquier recurso cuyo modelo de facturación incluya un coste
fijo por hora (la misma lista prohibida que se aplica también al entorno
efímero de pull request), para bloquear esos cambios detectados antes de aplicar. El equipo revisa además el plan y las operaciones realizadas fuera del flujo. Cuando el plan se aplica
y la aplicación web se publica, los activos con huella de contenido en su
propio nombre de archivo se sirven con una política de caché de un año,
mientras que el punto de entrada de la aplicación se sirve sin caché, para
que una nueva versión publicada se vea de inmediato sin tener que esperar a
que expire una caché larga; la invalidación de la distribución de
CloudFront se dispara usando el identificador que la propia infraestructura
como código expone como salida.

![Despliegue persistente manual mediante plan y aplicación autorizada](img/workflow-deploy.png){#fig:workflow-deploy}

La @fig:workflow-deploy separa la revisión del plan de su aplicación y de la
publicación web. La aceptación del despliegue requiere aplicar el plan y
verificar el recorrido funcional. El workflow de PDF publica el documento
mediante su propio ciclo.

# Implementación de la solución

## Flujo del MVP

![Flujo de usuario del MVP de Findly](img/flujo.png){#fig:flujo}

La @fig:flujo resume el recorrido completo desde el punto de vista de las
dos personas que interactúan con el sistema. El asistente acepta el
consentimiento biométrico y sube una selfie; el organizador, ya autenticado,
sube las fotografías del evento a medida que las tiene disponibles, sin que
el orden entre ambos pasos sea relevante para el resultado final. Findly
busca de forma asíncrona el rostro de cada asistente inscrito en cada
fotografía nueva, y cuando encuentra una coincidencia la añade a la galería
privada de esa persona. El asistente recibe un enlace temporal a esa
galería y, en cualquier momento, puede solicitar la retirada de sus datos;
esa retirada de datos también ocurre automáticamente cuando el periodo de
retención configurado para el evento caduca, sin que nadie tenga que
solicitarlo.

## Arquitectura de la solución

Se utilizan dos niveles del modelo C4 de Simon Brown [25]: contexto, para
delimitar actores y sistemas externos, y contenedores, para describir unidades
de ejecución y almacenamiento con sus responsabilidades. En C4, «contenedor» designa una unidad de software o almacenamiento: una
SPA, una función o una base de datos pueden ocupar ese nivel. La vista de infraestructura posterior concreta los
servicios AWS y sus disparadores.

![Contexto de Findly: participantes, organizadores y servicios externos](img/contexto-c4.png){#fig:contexto-c4}

La @fig:contexto-c4 delimita la responsabilidad de Findly y las dependencias
externas. La @fig:contenedores-c4 descompone el sistema en sus unidades
lógicas y explicita sus responsabilidades y relaciones.

![Contenedores C4 de Findly y responsabilidades principales](img/contenedores-c4.png){#fig:contenedores-c4}

![Arquitectura de ingesta, matching y retención](img/arquitectura.png){#fig:arquitectura}

La aplicación web de Findly es una aplicación de una sola página construida
con React, Vite y TypeScript, servida de forma estática desde un bucket de
Amazon S3 a través de una distribución de CloudFront con control de acceso
al origen. El navegador ejecuta la interfaz y su renderizado. Toda la
interacción dinámica (inscripción, sondeo de estado, galería, administración
de eventos) pasa por una única pasarela de API HTTP que invoca funciones de
cómputo bajo demanda. El estado
transaccional de toda la aplicación vive en una única tabla de base de
datos no relacional facturada por petición, y las imágenes (selfies y
fotografías de evento) se almacenan en un bucket privado que nunca admite
acceso público.

Como se observa en la @fig:arquitectura, la cadena de componentes se activa
mediante eventos nativos de la plataforma: al depositarse un objeto en el bucket de
cargas, el propio servicio de almacenamiento dispara una notificación que se
enruta, según el sufijo del nombre del objeto, bien directamente a la
función que indexa selfies, bien a una cola de mensajería que amortigua los
picos de fotografías de evento antes de que la función de comparación
facial las procese. La purga de datos por caducidad se dispara, de la misma
manera, por un planificador de eventos que invoca directamente a la función
de retención según una expresión periódica, sin ninguna cola intermedia. La
observabilidad y el control de coste se superponen a toda la arquitectura
sin intervenir en el camino crítico de ninguna petición: cada componente
escribe sus propios registros estructurados, un servicio de alarmas vigila
condiciones concretas (por ejemplo, que la cola de mensajes fallidos reciba
al menos un mensaje) y la configuración de presupuestos prevé vigilar el gasto real de
la cuenta a través del mismo canal; su recurso sigue pendiente de aplicación.

### Distribución de infraestructura

![Infraestructura de aplicación, distribución global y estado de despliegue](img/despliegue.png){#fig:despliegue}

La @fig:despliegue separa las cargas y datos de `eu-west-1` de la distribución
global y del certificado requerido por CloudFront. Los entornos comparten
patrones de IaC y usan nombres, roles y estados propios. Su existencia
depende de los ciclos de despliegue y destrucción documentados.

### Secuencia de inscripción y matching

![Secuencia de inscripción y coincidencias con fotografías nuevas o previas](img/secuencia-matching.png){#fig:secuencia-matching}

La @fig:secuencia-matching muestra el PUT directo del navegador a S3 y los
dos disparadores del núcleo de matching. El backfill cubre fotos anteriores
a la inscripción; el consumidor de SQS cubre fotos nuevas. La escritura
condicional evita duplicar matches; los reintentos pueden repetir llamadas
de análisis.
La persistencia de `ENROLLED` y el encolado del backfill siguen siendo dos
operaciones separadas: su ventana de fallo se analiza en las conclusiones.

## Frontend y distribución

React, Vite y TypeScript permiten construir una interfaz que consume la
API y ejecuta el renderizado en el navegador. La API concentra la lógica
de negocio y la aplicación web funciona como su cliente. Esto permite
distribuir la aplicación entera como ficheros estáticos inmutables desde un
bucket privado, servido exclusivamente a través de una distribución de
CloudFront que firma cada petición hacia el origen: el acceso de distribución del contenido se concede a esa distribución
mediante OAC [11], además de los permisos administrativos y de publicación
que requieren los operadores autorizados. Las rutas
propias de la aplicación, que no existen como ficheros reales en el
bucket, se resuelven redirigiendo las respuestas de error de "no encontrado"
hacia el punto de entrada de la aplicación, que es quien realmente
interpreta la ruta en el navegador.

## Identidad y acceso de organizadores

El panel de administración de eventos exige que el organizador se autentique
contra un servicio de identidad gestionado, con una política de contraseñas
exigente y sin ningún secreto de cliente embebido en el propio navegador. El
token de sesión que ese servicio emite se adjunta a cada petición a las
rutas administrativas de la API, y su validez se comprueba mediante un
autorizador nativo de API Gateway asociado a las rutas administrativas. En
esas rutas, un JWT inválido se rechaza antes de invocar la función [10]. Los
contratos de infraestructura deben verificar la asociación explícita del
autorizador a cada ruta protegida. El
alta de nuevas personas organizadoras es exclusivamente por invitación de
alguien ya autorizado, nunca por autorregistro público.

## API y procesamiento

Toda la interacción dinámica de Findly pasa por una única pasarela de API
HTTP que enruta cada petición a una función de cómputo sin servidor
dedicada a esa responsabilidad concreta: descubrimiento de eventos públicos,
inscripción y consentimiento, sondeo de estado, informes de error desde el
propio cliente, consulta de la galería privada, solicitud de borrado, y un
conjunto de rutas administrativas protegidas para la gestión de eventos y
la carga masiva de fotografías. Cada función tiene una única entrada y una
única salida bien definidas: las respuestas de error construidas por los handlers siguen
el mismo formato con un código, un mensaje y un identificador de petición,
para limitar la información expuesta al navegador. Las respuestas generadas
por servicios como API Gateway o S3 tienen contratos propios.

## Datos, imágenes y reconocimiento facial

### DynamoDB

Findly reúne eventos, inscripciones, fotografías, coincidencias y tokens de
galería en una única tabla de DynamoDB. Los prefijos de las claves de partición
y ordenación separan las entidades y permiten consultar cada recorrido por su
clave, sin recorrer datos ajenos al evento o a la persona participante.

Dos índices secundarios globales resuelven accesos adicionales. El primero
asocia un `FaceId` de Rekognition con su inscripción. El segundo lista el
catálogo administrativo de eventos ordenado por fecha; comparte la partición
`ENTITY#EVENT`, compartida por los organizadores del entorno. La purga reutiliza ese índice
para localizar eventos y comprobar su retención, sin ejecutar un `Scan` de la
tabla completa.

La relación entre participante y fotografía necesita además dos direcciones de
consulta. La galería parte de una inscripción y busca sus fotos; el borrado
administrativo parte de una foto y necesita localizar todas las inscripciones
que la incluyen. Para resolver ese acceso inverso se guarda un **ítem espejo**
por coincidencia, en la misma tabla y con las claves invertidas para esa
consulta:

<!-- prettier-ignore -->
| Registro de la relación | Clave de partición (`PK`) | Clave de ordenación (`SK`) |
| --- | --- | --- |
| Coincidencia de galería | `REG#{registrationId}` | `MATCH#{photoId}` |
| Ítem espejo | `PHOTO#{eventId}#{photoId}` | `MATCH#{registrationId}` |

La coincidencia de galería permite consultar las fotografías de una inscripción;
el ítem espejo permite consultar las inscripciones vinculadas a una fotografía.

Ambos ítems contienen la misma relación y sus metadatos de coincidencia;
las imágenes permanecen en S3 y las referencias faciales conservan su función. Se crean juntos mediante una
transacción de DynamoDB que revalida la inscripción y la foto y rechaza
coincidencias duplicadas. Así, cualquiera de los dos disparadores de matching
puede producir el resultado sin dejar sólo una de las dos direcciones escrita.

El espejo se consulta directamente sobre la tabla con lectura fuerte. Se eligió
frente a un tercer índice secundario global porque el borrado necesita conocer
las coincidencias confirmadas antes de limpiar, sin depender del retraso de un
índice de consistencia eventual. La consulta se pagina: evita un recorrido de
toda la tabla, pero el trabajo sigue creciendo con el número de coincidencias
de la fotografía. Esta decisión y sus límites quedan documentados aparte
como una decisión de arquitectura propia del proyecto.

Al borrar una foto, primero se persiste una marca que impide nuevas
coincidencias. Después se consultan sus espejos y, por cada página, se eliminan
todos los matches de galería antes de retirar sus claves espejo. Conservar
estas últimas hasta completar el primer paso permite descubrir el trabajo
pendiente al reintentar un fallo parcial. Este protocolo y el alcance de su
validación se distinguen en las conclusiones. Las operaciones en S3 y
Rekognition se ejecutan por separado de la transacción de DynamoDB.

### Buckets S3 privados y URLs prefirmadas

Las imágenes (selfies y fotografías de evento) se organizan en el bucket
privado de cargas con una estructura de claves que distingue ambos tipos de
objeto mediante su sufijo, de modo que un mismo prefijo de evento pueda
alimentar dos flujos de notificación distintos sin ambigüedad. El acceso del navegador
a ese bucket se concede mediante URLs firmadas de vida corta; los workers
usan sus roles IAM. El bucket no dispone de una política de acceso público
ni requiere compartir credenciales. Las selfies añaden una restricción adicional que
ninguna otra carga tiene: la propia escritura en S3 se condiciona a que el
objeto no exista todavía, de modo que un intento de sobrescribir una selfie
ya subida es rechazado por el propio servicio de almacenamiento, sin
depender de una comprobación de aplicación que pudiera evitarse.

### Amazon Rekognition

El reconocimiento facial se apoya en Amazon Rekognition, con una corrección
de diseño que resultó relevante durante el desarrollo: la llamada más
directa para comparar una imagen de entrada contra una colección de rostros
indexados sólo evalúa el rostro más prominente de esa imagen, un
comportamiento documentado del propio servicio. Para una fotografía de
evento con varias personas, el caso habitual, esa llamada dejaría sin intentar la comparación del resto de
rostros presentes. La implementación evita esa limitación indexando
temporalmente cada rostro detectado en la fotografía, buscando
coincidencias para cada uno de ellos por separado, y borrando después ese
índice temporal, a costa de varias llamadas al servicio por cada fotografía
en lugar de una sola. Las colecciones de rostros se aíslan por entorno y por
evento, para reducir el riesgo de consultar o borrar rostros de otro entorno.
Ese aislamiento depende también de la configuración y los permisos IAM.

El catálogo administrativo es compartido por los organizadores autorizados
del entorno. El modelo concede a ese grupo de confianza acceso conjunto a
los eventos. La autorización por propietario sería una ampliación del modelo.

## Retención y ciclo de vida de los datos

Cada evento tiene asociado un periodo de retención configurable, con un
mínimo de demostración de siete días. Un planificador de eventos dispara
periódicamente una función que consulta qué eventos han superado ese
periodo y, para cada uno de ellos, borra la colección de rostros asociada en
Rekognition y todos los objetos del bucket de cargas bajo el prefijo de ese
evento. Además de esta purga automática por caducidad, cualquier asistente
puede solicitar en cualquier momento, de forma explícita, la retirada
inmediata de sus propios datos: esa operación borra, en una secuencia
pensada para repetirse sin error si falla a mitad de camino, el rostro
indexado, la imagen original, y el registro, las coincidencias y el token
asociados en la base de datos. Tras ese borrado, el mismo enlace de galería
que la persona recibió deja de funcionar.

## Entorno de desarrollo local

El desarrollo y la integración de Findly admiten tres modos de ejecución
local, cada uno con un alcance de prueba explícito: un modo totalmente simulado, en el que las
llamadas a los servicios de AWS se sustituyen por dobles de prueba en
memoria; un modo intermedio, que ejecuta los mismos contenedores que
emularían Amazon S3 y DynamoDB en un entorno Docker local, de modo que el
mismo código que se despliega a producción se ejecuta sin cambios contra
esa emulación; y un tercer modo que apunta directamente a una cuenta de AWS
real de pruebas. Cada modo aporta evidencia de su entorno: los dobles validan
contratos y lógica; la emulación valida la integración local; la aceptación
AWS verifica Rekognition y las notificaciones nativas de S3 desplegadas.

## Pruebas

La verificación de Findly combina varios niveles, deliberadamente separados
por lo que cada uno demuestra. Un nivel de pruebas unitarias y de contrato
cubre la lógica de negocio y los constructores de claves de la base de
datos, con una cobertura de línea exigida por encima del 90 % en los
módulos de funciones y de lógica compartida. Un nivel de pruebas de extremo
a extremo con un navegador real cubre tanto el recorrido simulado como el
recorrido contra el entorno local emulado, y un nivel intermedio ejercita la
función de indexación de selfies directamente contra ese mismo entorno
emulado sin pasar por un navegador. El nivel con mayor peso probatorio, sin
embargo, es la ejecución de aceptación desplegada contra un entorno de AWS
real y efímero: un recorrido completo con un navegador real que cubre
inscripción, indexación, comparación facial, galería privada y borrado,
acompañado de comprobaciones directas contra la base de datos y contra
Rekognition para confirmar que el borrado realmente ha ocurrido. La
aceptación desplegada aporta la evidencia del recorrido en servicios AWS
reales y complementa las comprobaciones de lógica e integración local.

## Rendimiento y evaluación experimental

La aceptación funcional responde a si un recorrido produce el resultado
esperado; los objetivos de rendimiento requieren además una población de
observaciones, una carga y una ventana temporal definidas. Los ensayos del repositorio acreditan recorridos concretos; la campaña
para los dos SLO agregados de la spec 00 queda pendiente de ejecución.

<!-- prettier-ignore -->
| Indicador | Evidencia disponible | Conclusión permitida |
| --- | --- | --- |
| Selfie hasta `ENROLLED` | El ensayo de aceptación confirma el estado; el intervalo requerido queda pendiente de medición. | Acreditación del objetivo < 3 s pendiente de un cronómetro específico. |
| Borrado con 100 / 1.000 matches | HTTP 204 en 2,020 / 3,082 s y comprobación de limpieza verificada en AWS. | Valida esos casos de fan-out; la latencia de galería requiere su propio ensayo. |
| Galería p95 < 500 ms | Muestra de latencias y ventana pendientes de publicación. | Acreditación pendiente mediante una distribución de latencias de galería. |
| Inscripción completa > 98 % | Cohorte de intentos y resultados finales pendiente de publicación. | Acreditación pendiente mediante inscripciones completadas / intentos válidos. |
| Calidad del reconocimiento | Umbral de similitud $\geq$ 95 %, con coincidencias verificadas en escenarios concretos. | Precisión, exhaustividad y tasas de error pendientes de evaluar sobre un conjunto etiquetado. |

: Resultados experimentales y alcance de las conclusiones {#tbl:rendimiento}

La revisión del cronómetro de ese ensayo corrigió una interpretación anterior: el
campo `enrolledAfterMs` del escenario A se registra después de obtener el
match, y el del escenario B incluye la carga inicial de la foto y una espera
deliberada de cinco segundos, deteniéndose antes del sondeo de `ENROLLED`.
Cada escenario cronometra un tramo diferente del recorrido. La evidencia
funcional se conserva y la medición S3 PUT → `ENROLLED` queda pendiente de
un ensayo que aísle ese intervalo.

## Observabilidad

Cada función de cómputo envía sus registros a **Amazon CloudWatch Logs**,
en un grupo de logs propio y con retención definida en Terraform. Cada
registro se escribe como una única línea en formato estructurado, con un identificador de correlación que enlaza la
petición de la pasarela de API, la invocación de la función y, en su caso,
el mensaje de cola que la originó. Esos registros admiten únicamente una
lista cerrada de campos técnicos (identificador de evento, identificador de
fotografía, código de estado, duración, tipo de error) y deliberadamente no
existe ningún campo para nombres, correos electrónicos, tokens de galería ni
identificadores biométricos, para reducir el riesgo de filtración. Esta protección cubre el logger
estructurado utilizado; debe revisarse también cualquier nueva vía de registro. Cada función conserva
sus registros durante un periodo acotado, de forma que el almacenamiento de
observabilidad no crezca sin límite. Los errores que ocurren en el propio
navegador durante la subida de la selfie, que va directamente del
navegador al almacenamiento sin pasar por el servidor, se reportan de
forma explícita y limitada a una ruta de telemetría dedicada, para que
también ese tipo de fallo quede medido sin exponer información sensible.

# Privacidad, seguridad y cumplimiento

## Tratamiento de datos biométricos y consentimiento

El consentimiento biométrico y de términos exige el valor literal `true`
en cada solicitud de inscripción; el backend valida ese valor explícito.
Findly aplica minimización de datos por diseño en lo que respecta a la
selfie: se almacena la imagen original, en un bucket privado y sujeta a la
misma política de retención que el resto de datos del evento, y el
identificador de rostro que devuelve Rekognition, un identificador opaco.
DynamoDB guarda esa referencia y Rekognition conserva la representación
biométrica en su colección [1]. El análisis de privacidad incluye el
tratamiento de ambos almacenes. El
correo electrónico es obligatorio en las inscripciones nuevas, exclusivamente
para permitir el envío manual de la galería por parte del organizador
cuando así se decida, conforme al alcance manual aprobado del proyecto.

## Amenazas, controles y riesgo residual

La seguridad se evalúa sobre activos y recorridos: imágenes y vectores
biométricos, capacidad de galería, identidad administrativa y datos de contacto.
El análisis siguiente relaciona amenazas, controles observables y riesgos
residuales del MVP.

<!-- prettier-ignore -->
| Amenaza | Control existente | Riesgo residual y tratamiento en la demo |
| --- | --- | --- |
| Inscribirse con una selfie ajena | Consentimiento obligatorio, selfie inmutable y colección acotada al evento. | La inscripción acepta la identidad declarada y admite el riesgo de una selfie ajena al carecer de prueba de vida. Usar personas adultas del equipo y material autorizado. |
| Filtrar o reenviar el enlace de galería | Token aleatorio, hash almacenado, caducidad y revocación al borrar la inscripción; imágenes con URL breve. | Quien posee el enlace puede usarlo. No publicarlo en capturas ni proyección; una descarga ya realizada no puede revocarse. |
| Mostrar terceros en fotografías grupales | La galería exige una coincidencia del inscrito y el acceso a S3 está restringido. | Se entrega la foto completa, con todos los rostros visibles; cada persona retratada requiere consideración específica de su consentimiento. Revisar previamente todas las personas y fotos de la demo y excluir menores. |
| Indexar temporalmente rostros no inscritos | Los rostros de la foto se eliminan tras la búsqueda; las colecciones se separan por evento y entorno. | La indexación temporal trata también los rostros que quedan sin coincidencia. Usar solo material autorizado y verificar limpieza. |
| Acceso administrativo fuera del evento esperado | Cognito JWT protege las rutas administrativas. | El catálogo es global en el entorno y los organizadores son administradores de confianza con acceso compartido a los eventos. |
| Fallo parcial al borrar o envío ya en curso | Barreras de borrado, reintentos y purga; el worker de correo revalida elegibilidad. | DynamoDB, S3, Rekognition y SES se actualizan en operaciones separadas. Se conservan los límites concurrentes documentados y se comprueba la limpieza. |

El uso de enlaces portadores facilita el acceso mediante la posesión del
enlace. AWS describe las URLs prefirmadas como capacidades portadoras
que deben protegerse [3]. Las mitigaciones operativas previstas para la demo requieren actuación
manual del equipo. Un uso más amplio exigiría
revisar identidad, consentimiento de terceros y autorización por evento antes
de ampliar el alcance.

## Envío manual de galerías y estado de verificación

![Circuito de correo manual y feedback de Findly](img/correo.png){#fig:correo}

El correo prolonga el recorrido de la galería privada: un organizador
autenticado confirma el envío a participantes vigentes de su evento que
conservan consentimiento, una dirección válida y fotografías coincidentes
disponibles. La @fig:correo muestra ese circuito. Cada mensaje es individual y
transaccional; encontrar una coincidencia no dispara un envío automático ni
habilita una campaña de correo.

La solicitud administrativa requiere un JWT de Cognito y crea una operación
identificada de forma estable. DynamoDB conserva su estado y una cola FIFO
entrega el trabajo a una función de backend que revalida la inscripción y las
fotografías antes de solicitar el envío a Amazon SES en `eu-west-1`. Repetir la
misma operación recupera su progreso; una nueva confirmación permite reenviar
la galería de forma intencionada.

Cada mensaje contiene un enlace HTTPS con una capacidad de acceso temporal.
Sólo se conserva el hash de esa capacidad, y los enlaces anteriores mantienen
su validez hasta caducar o ser revocados. Los rebotes permanentes y las quejas
regresan mediante SNS y SQS para actualizar el estado sin recrear datos
borrados. La respuesta distingue aceptación por SES, omisión, fallo e
incertidumbre: la recepción en el buzón requiere su propio recibo y un
resultado incierto exige revisión antes de autorizar otro envío.

El diseño conserva dos límites de coordinación. Guardar el estado en DynamoDB
y publicar el trabajo en SQS son acciones separadas, cuya evolución se propone
mediante el patrón Transactional Outbox. Tampoco existe una transacción conjunta
entre DynamoDB y SES: retirar el consentimiento no puede cancelar una petición
de correo que ya esté en vuelo. Estas condiciones y la recuperación prevista
quedan documentadas aparte, como una decisión de arquitectura propia.

La validación distingue preparación del dominio, funcionamiento del circuito y
entrega al destinatario. La identidad regional y los registros SPF, DKIM y DMARC
se verificaron antes de publicar la infraestructura. La aceptación sintética
posterior completó nueve escenarios de envío, feedback, idempotencia y
capacidades de galería, con limpieza de los datos temporales. Las correcciones
del arnés y del worker forman parte de esa evidencia, sin ampliar los permisos
de producción.

La prueba real a un buzón corporativo autorizado confirmó llegada a la bandeja
de entrada, resultados `pass` de SPF, DKIM y DMARC, y apertura del enlace HTTPS
con carga de la galería privada. El recibo del arnés acreditó ese recorrido y
su limpieza. Este resultado respalda la entrega a ese destinatario. El
23 de octubre, el equipo confirmó expresamente el cumplimiento de ese criterio
de recepción en dos proveedores de correo distintos.
La aceptación multiproveedor procede de esa confirmación manual y el recibo
del arnés conserva el alcance de un destinatario.

La configuración de SES utilizada por Cognito se conserva como una decisión
independiente del envío de galerías. Las invitaciones administrativas mantienen
su propio flujo de alta y recuperación, sin almacenar contraseñas temporales
en la infraestructura. La implementación del envío manual está integrada y
verificada, con la procedencia de la confirmación multiproveedor diferenciada
de los ensayos automatizados.

El [anexo de trazabilidad del correo](#anexo-trazabilidad-del-correo) reúne las
revisiones, ejecuciones y límites de cada evidencia, conservando el detalle
reproducible fuera del relato arquitectónico.

## Minimización y retención de datos

Todo recurso de infraestructura se etiqueta, entre otras cosas, con una
clase de dato que distingue los entornos que tratan datos biométricos
reales de los que sólo tratan datos sintéticos, de forma que resulte
auditable qué recursos concretos requieren el nivel más alto de protección
a partir de sus metadatos. El mecanismo TTL de expiración de la base de
datos trabaja en segundo plano con un plazo variable. El borrado explícito
y la función de purga por caducidad ejecutan la retirada de datos; el
consentimiento se registra como un valor y una marca de tiempo únicos, sin
un historial de revocación ni versión; y las colecciones de rostros creadas
antes de que se introdujera el aislamiento por entorno no se migran
automáticamente a ese esquema más seguro.

## Seguridad de acceso a los datos

La configuración de los buckets de Findly bloquea las políticas de acceso público: las
cuatro banderas de bloqueo de acceso público están activas en todos ellos,
con cifrado por defecto del lado del servidor. El acceso a las imágenes se
concede exclusivamente mediante URLs firmadas de vida muy corta, nunca
reutilizables más allá de su vigencia, y el acceso a la aplicación web se
restringe a las peticiones firmadas por la distribución de CloudFront
correspondiente. Cada función de cómputo tiene su propio rol de permisos
mínimos, sin compartir acciones ni recursos más allá de lo estrictamente
necesario para su propia responsabilidad. El token de galería se trata como
dato sensible: el logger estructurado descarta esos campos y se revisan las
rutas de registro para evitar su exposición.

# Costes y FinOps

## Modelo reproducible y escenarios

El objetivo presupuestario de demo es 5 USD/mes.
Para contrastar su viabilidad se calcula un mes de actividad con tarifas
públicas de AWS para `eu-west-1`, consultadas el 25 de octubre de 2026, y
CloudFront en Europa. El modelo reproducible utilizado
conserva tarifas, SKU, unidades, fuentes, supuestos, calculadora Python y CSV.
Expresa en USD antes de impuestos el coste bruto estimado de los servicios
modelados, con las cuotas gratuitas y créditos contabilizados por separado
en la futura conciliación de facturación.

Se suponen fotos de 3 MiB, selfies de 0,5 MiB, una cara por foto, cinco descargas
y cinco coincidencias por asistente, retención de un mes y un correo manual
por participante. La SPA añade almacenamiento S3, peticiones y transferencia
CloudFront; las fotos se descargan directamente desde S3. Se incluyen cuatro
MAU hipotéticos de Cognito Essentials, cuatro alarmas, dos métricas activas
y logs; el tercer escenario amplía a cinco métricas como sensibilidad. Los
tiempos Lambda son supuestos de cálculo.

<!-- prettier-ignore -->
| Escenario supuesto | Rekognition | CloudWatch | Resto de servicios | Total modelado |
| --- | ---: | ---: | ---: | ---: |
| 20 asistentes / 100 fotos | 0,2202 | 1,0120 | 0,1037 | **1,3359** |
| 100 asistentes / 500 fotos | 1,1010 | 1,0480 | 0,2747 | **2,4237** |
| 100 asistentes / 500 fotos / 10 altas tardías | 11,1010 | 1,9600 | 0,3277 | **13,3887** |

El desglose CSV comprende Rekognition, S3, transferencia, CloudFront, Cognito,
DynamoDB, Lambda, HTTP API, SQS estándar/FIFO, SES, SNS y Scheduler. SNS se
estima sin notificaciones de alarma o rebote. Se excluyen dominio y DNS por
falta de factura, soporte, actividad de Terraform/CI, reintentos y otras rutas
no modeladas. El plan real de Cognito/SES y las partidas excluidas requieren
conciliación para evaluar el presupuesto sobre la factura completa.

## Rekognition y sensibilidad al backfill

El coste incluye dos partidas distintas: análisis y **almacenamiento de
metadatos faciales en las colecciones**. Para A asistentes, N fotos, R altas
tardías y F caras por foto, se aproximan las operaciones Group 1 como
`A + N × (1 + R) × (1 + F)`: indexación de selfies, indexación temporal de
fotos y búsquedas por rostro. Con las tarifas del primer tramo del modelo,
el análisis cuesta 0,001 USD por operación y el almacenamiento 0,00001 USD
por vector-mes. Así, cien rostros inscritos retenidos un mes añaden 0,001 USD;
el almacenamiento de imágenes originales en S3 se contabiliza aparte.
Las [tarifas de Rekognition](https://aws.amazon.com/rekognition/pricing/)
distinguen ambas partidas.

Las caras temporales se eliminan tras la búsqueda; el modelo omite su breve
residencia y los reintentos. Diez altas tardías sobre quinientas fotos añaden
cinco mil recorridos de foto, con diez mil operaciones Group 1 si F=1: solo
ese análisis adicional suma 10 USD. El número de rostros y el orden de llegada
pueden dominar el coste; un evento con fotografías grupales requiere ajustar F.

## Contraste y control operativo

El contraste parcial en [AWS Pricing Calculator](https://calculator.aws/#/estimate?id=052dd6f3544a78368ff9a2097138042393c4437e)
para Rekognition, con 600 IndexFaces, 500 SearchFaces y cien rostros-mes en
Irlanda, devuelve 2,201 USD frente a 1,101 USD del modelo. Su desglose suma
dos veces las mismas 1.100 operaciones Group 1; el almacenamiento coincide.
Se conservan capturas y parámetros de ese contraste.
La discrepancia queda documentada y pendiente de aclaración para completar
la validación del coste estimado.

El equipo comunica el 26 de octubre de 2026 un gasto de **1,41 EUR en
Rekognition y 0,30 EUR en S3: 1,71 EUR en las partidas declaradas**, y confirma
que no superó su límite de gasto asociado a la capa gratuita. La declaración
del equipo se conserva en EUR. Conciliarla con el modelo en USD requiere
factura, periodo, volúmenes, impuestos, créditos y alcance de las partidas.

El equipo aporta también dos capturas de un resumen de costes y previsiones.
Las partidas visibles están en USD y distinguen estos periodos:

<!-- prettier-ignore -->
| Periodo de 2026 | Naturaleza del dato aportado | Suma de partidas visibles (USD) |
| --- | --- | ---: |
| Junio y julio | Sin cargos registrados según el resumen | — |
| Agosto | Coste real comunicado | 0,379 |
| Septiembre | Coste real comunicado | 0,130 |
| Octubre | Previsión parcial | 0,542 |
| Noviembre | Previsión | 2,986 |

La previsión de noviembre se redondea a 2,99 USD, con 2,014 USD de margen
aritmético frente al objetivo de 5 USD/mes. Rekognition aporta 2,701 USD,
aproximadamente el 90,46 % del importe previsto. Su relación con los
0,115 USD comunicados para septiembre es de 23,49 veces; combina un dato
real comunicado con una previsión y expresa la relación entre ambos importes.

Las capturas también muestran EC2, RDS y VPC en agosto, y un cargo residual
de RDS de 0,002 USD en septiembre. El equipo confirma que el resumen abarca toda la cuenta AWS. La
arquitectura vigente de Findly utiliza los servicios descritos en sus diagramas;
atribuir cargos concretos al proyecto requiere un desglose por recursos o
etiquetas. La comprobación de recursos activos requiere además un inventario.
Quedan por conocer filtros, créditos, impuestos y método de previsión. Esta
serie de cuenta en USD, la declaración previa en EUR y el modelo paramétrico
conservan su procedencia y requieren una conciliación homogénea.

La comparación con tarifas públicas permite reproducir el cálculo. La
conciliación con facturación atribuible al proyecto o con una estimación
completa exportada de AWS Pricing Calculator queda pendiente. Esa conciliación debe incluir dominio/DNS,
planes efectivos, región, intervalo, consumo bruto y créditos por separado.
La factura y su desglose permitirán determinar el coste observado del proyecto.

Terraform define un presupuesto de cuenta de 5 USD con aviso al 80 %, excluyendo
créditos y reembolsos. Su configuración tiene validación estática y su
aplicación en una cuenta real queda pendiente según la evidencia de FinOps
reunida durante el proyecto.
Sí se verificó el canal SNS mediante la alarma de DLQ. El presupuesto diseñado
avisa al equipo cuando se alcanza el umbral. Almacenamiento, métricas y alarmas pueden facturar
sin usuarios activos.

Las etiquetas por proyecto y entorno permiten atribuir consumo; la retención
limita datos conservados, y los workflows destruyen los entornos efímeros tras
su verificación. Una interrupción de la limpieza requiere revisión operativa.
El control más relevante para el modelo es limitar el tamaño del evento y
observar la amplificación del backfill sin sacrificar su convergencia funcional.

# Conclusiones

## Principios de arquitectura de este proyecto

A lo largo de esta memoria, cada pilar del AWS Well-Architected Framework se
ha traducido en las siguientes acciones:

- **Excelencia operativa**: un único conjunto de comprobaciones de calidad se
  ejecuta igual en local y en integración continua, y una auditoría de cierre
  independiente, más allá de los propios checks automáticos, resultó necesaria
  para confirmar que el trabajo dado por terminado realmente lo estaba.
- **Seguridad**: ningún almacenamiento es público, ninguna credencial de AWS de
  larga duración se almacena como secreto, cada función de cómputo dispone de
  los permisos mínimos para su propia tarea, y la identidad de los organizadores
  se separa completamente de la capacidad de acceso de los asistentes.
- **Fiabilidad**: la ingesta de fotografías está desacoplada mediante una cola
  de mensajería con cola de mensajes fallidos, y las operaciones más sensibles
  del sistema, como el borrado de datos de un asistente, se diseñaron para ser
  repetibles sin error ante un fallo parcial.
- **Eficiencia del rendimiento**: el modelo de datos resuelve por clave e índice
  las consultas de inscripción por rostro y del catálogo administrativo de eventos sin recorrer nunca la tabla
  completa.
- **Optimización de costes**: se evita capacidad de cómputo y red dedicada, se
  usan servicios por petición y se destruyen los entornos efímeros. El
  almacenamiento y la observabilidad pueden facturar sin tráfico; Budgets
  avisa al equipo al alcanzar el umbral configurado.
- **Sostenibilidad**: el cómputo bajo demanda adapta su ejecución a las
  peticiones, y los workflows destruyen los entornos de prueba al terminar
  su verificación.

Los recorridos nucleares, el disparo del planificador de retención, las
alertas de observabilidad y la entrega de correo en producción con
autenticación criptográfica estricta cuentan con evidencia AWS real. El
alcance de estos resultados conserva límites empíricos concretos. Entre ellos: el
recibo automatizado de entregabilidad cubre un buzón, mientras que la aceptación
multiproveedor se apoya en la confirmación manual del equipo; la descarga directa de ficheros desde URLs prefirmadas de S3
presenta incidencias de temporización en motores WebKit frente al comportamiento
validado en Chromium y Firefox; y las carreras concurrentes conservan límites
específicos que se describen a continuación.

## Hallazgos corregidos y límites actuales de DynamoDB

Un benchmark en AWS detectó un timeout real al borrar una foto con 100 o
1.000 coincidencias y una ventana de escritura de matches tardíos. Estos
hallazgos quedaron corregidos: se elevó el timeout de
`delete_photo` de 3 a 60 segundos, se agrupó el borrado en `BatchWriteCommand`
de hasta 25 ítems con reintento de `UnprocessedItems`, y se añadió a
`writeMatch` una precondición transaccional `attribute_exists(PK)` sobre la fila
de la foto. Las pruebas se encuentran en `tests/lambdas/adminEvents.test.ts`,
`photoMatcher.test.ts` y `registrationBackfillMatching.test.ts`.

La aceptación AWS combinada del 16 de octubre registró respuestas `204` en 2.020
ms para 100 matches y 3.082 ms para 1.000, con cero huérfanos en esos
escenarios; tampoco sobrevivieron el match y su espejo en la carrera
subida/borrado ejercitada. Las duraciones describen exclusivamente esos
escenarios y volúmenes. Ensayos posteriores completaron la aceptación de
edición, paginación, borrado y cierre administrativos.

El código actual incorpora además un marcador de borrado lógico: al borrar
una foto deja una marca `deletedAt` o _tombstone_, elimina `s3Key`, `fileName`
y `uploadedAt`, y conserva el TTL existente; así un reintento de la operación
de subida no recrea silenciosamente la foto. La vigencia de una foto depende
del tombstone y del TTL lógico de su registro. Una corrección posterior
persiste esa barrera antes de consultar espejos y exige ausencia de
`deletedAt` y TTL lógico vigente en la transacción de matching, y borra
primero los matches de cada página y luego los espejos para recuperar fallos
parciales. Esta corrección está integrada; su entorno AWS efímero superó el
recorrido funcional estándar, incluido el borrado de una foto con coincidencia
y el rechazo de la operación de subida ya eliminada, y se destruyeron los 147
recursos gestionados por Terraform. Las pausas deterministas antes y durante
la barrera y los casos dedicados de TTL lógico siguen acreditados por
unitarias y por la emulación local; la aceptación AWS específica de carreras
y TTL se aplaza, por decisión del equipo, como mejora de validación para una
próxima etapa, sin fecha comprometida, y queda con ese criterio sin
verificar. La evidencia de despliegue permanente de esta revisión y los
ensayos de borrado de evento con backfill y correo en curso quedan
pendientes, y requieren un ensayo propio sobre la revisión con tombstone.

DynamoDB y el ítem espejo se confirman como decisión vigente de persistencia.
Los límites identificados corresponden al protocolo de escritura y
recuperación y orientan las mejoras de la siguiente fase.

## Mejoras para una fase II

Una continuación natural del proyecto debería, por orden de prioridad:

1. **Adopción del patrón _Transactional Outbox_ para resolver las escrituras
   dobles**: en la arquitectura actual existen dos flujos donde una función
   sin servidor persiste un cambio de estado en DynamoDB y a continuación
   intenta encolar un mensaje en Amazon SQS mediante una llamada
   independiente: la transición a `ENROLLED` en la indexación de selfies, que
   debe disparar el proceso de _backfill_ contra las fotos ya existentes del
   evento, y la solicitud manual de envío de correos de galería, que crea el
   registro de operación antes de encolar el trabajo. Ese patrón de
   escritura doble (_dual write_) no cuenta con una transacción conjunta
   entre ambos sistemas: si la llamada a SQS falla tras confirmarse la
   escritura en DynamoDB, por un fallo transitorio de red, una limitación de
   tasa o la interrupción de la función durante la invocación, el estado
   persistido y el evento que debía propagarlo quedan desalineados. La
   inscripción permanece en `ENROLLED` mientras el _backfill_ se omite al
   tratarse de un intento de mejor esfuerzo (_best-effort_), y la operación de
   correo queda en `RUNNING` dependiendo de que el cliente reintente la
   petición para que el trabajo avance.

   El patrón _Transactional Outbox_ resuelve esta inconsistencia desplazando
   el punto donde ocurre la publicación. La función deja de llamar a SQS
   directamente y se limita a confirmar el cambio de estado en DynamoDB; ese
   cambio queda registrado de forma nativa en Amazon DynamoDB Streams, el
   flujo ordenado de modificaciones por clave de partición que la propia
   tabla expone sin coste de escritura adicional. Amazon EventBridge Pipes
   puede tomar ese stream como origen, filtrar las transiciones relevantes
   (la actualización a `ENROLLED` o la creación del registro de operación de
   correo) y entregarlas como mensaje a la cola SQS correspondiente, con
   reintentos y una cola de mensajes fallidos (DLQ) gestionados por el propio
   servicio. La escritura de dominio y la intención de publicar quedan así
   unidas por la misma operación atómica de DynamoDB, mientras que la entrega
   a SQS ocurre de forma asíncrona y puede reintentarse sin comprometer el
   estado ya persistido.

   Streams y Pipes garantizan una entrega _at-least-once_: una interrupción
   durante el procesamiento del stream puede hacer que el mismo cambio llegue
   más de una vez a la cola. El consumidor del backfill y el procesador de
   correo necesitarían seguir aplicando condiciones de idempotencia
   equivalentes a las que ya usan hoy (`attribute_not_exists(PK)` en el
   match, o la condición de progreso de la operación de envío) para tolerar
   esos duplicados. Incorporar Streams/Pipes añade además un servicio que hay
   que dimensionar, monitorizar y facturar, y su filtro de eventos debería
   mantenerse sincronizado con cualquier cambio posterior en el modelo de
   datos. Por eso queda como una propuesta pendiente de decisión formal y de
   una evaluación de coste y recuperación frente al comportamiento best-effort
   actual, que ya mitiga parcialmente el riesgo mediante reintentos del
   cliente y estados observables (`RUNNING`, `STALLED`).

2. **Ampliación de la aceptación del borrado en una próxima etapa**: se
   aplazan los ensayos AWS específicos de carreras y TTL lógico, sin fecha
   comprometida. La barrera `deletedAt` y la revalidación de caducidad ya están
   implementadas e integradas, con pruebas locales y un recorrido funcional
   estándar en AWS efímero. Para retomar la validación se propone un arnés con
   pausas controladas antes del commit y durante la limpieza, ambos disparadores de matching,
   TTL vencido con la fila aún presente y recuperación tras fallos parciales.
   La aceptación deberá comprobar matches y espejos, operación estable y
   limpieza de recursos, con datos sintéticos, evidencia reproducible y
   autorización operativa previa. Hasta entonces ese criterio de aceptación
   AWS queda pendiente. La publicación permanente se decidirá por separado; los ensayos de
   borrado completo de evento con backfill o correo en curso son otra línea de
   mejora. El borrado por lotes, sus reintentos y el timeout de
   60 s ya están implementados.
3. **Ampliar la evidencia experimental y económica**: ejecutar el protocolo
   de p95 y éxito agregado con autorización operativa y contrastar el modelo
   de costes con consumo atribuible al proyecto. La confirmación multiproveedor
   ya cerró ese criterio; ampliar ensayos automatizados de correo sería una mejora de
   reproducibilidad con un alcance adicional al criterio ya cerrado.
4. **Unificación de contratos HTTP ante recursos expirados**: armonizar el
   código de respuesta (`404 Not Found` frente a `410 Gone`) entre los puntos de
   entrada de inscripción pública y carga administrativa de fotografías ante
   eventos cerrados o con retención vencida, acordando un criterio semántico
   único en la especificación de la API.
5. **Particionado concurrente del reprocesamiento de fotografías**: estructurar
   la ejecución del proceso de _backfill_ en subtareas paralelas coordinadas
   cuando el volumen previo de imágenes de un evento supere varios miles de
   fotografías, evitando la iteración estrictamente secuencial sobre páginas de
   DynamoDB.
6. Fuera del alcance de este trabajo académico y sin planificación prevista
   quedan, de forma deliberada: una revisión legal formal de protección de
   datos, campañas de marketing por correo o SMS, el escalado a más de un evento
   concurrente, y la operación en producción con soporte continuo.

# Referencias

1. Amazon Web Services. _Amazon Rekognition Developer Guide — IndexFaces_.
   <https://docs.aws.amazon.com/rekognition/latest/dg/API_IndexFaces.html>.
2. Amazon Web Services. _Amazon Rekognition Developer Guide — SearchFaces_.
   <https://docs.aws.amazon.com/rekognition/latest/dg/API_SearchFaces.html>.
3. Amazon Web Services. _Amazon S3 User Guide — Uploading and copying objects
   using presigned URLs_.
   <https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html>.
4. Amazon Web Services. _Amazon DynamoDB Developer Guide — Global secondary
   indexes_.
   <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html>.
5. Amazon Web Services. _Amazon DynamoDB Developer Guide — Time to Live
   (TTL)_.
   <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html>.
6. Amazon Web Services. _Amazon EventBridge Scheduler User Guide_.
   <https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html>.
7. Amazon Web Services. _Amazon CloudWatch Logs User Guide — Working with log
   groups and log streams_.
   <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html>.
8. Amazon Web Services. _AWS Budgets User Guide_.
   <https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html>.
9. Amazon Web Services. _Amazon Cognito Developer Guide — User pool
   authentication flows_.
   <https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow.html>.
10. Amazon Web Services. _Amazon API Gateway Developer Guide — Working with
    HTTP APIs_.
    <https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html>.
11. Amazon Web Services. _Securing Amazon S3 static website content using
    CloudFront Origin Access Control_.
    <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html>.
12. GitHub, Inc. _Configuring OpenID Connect in Amazon Web Services_.
    <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services>.
13. HashiCorp. _Terraform — Backend Type: s3 (native S3 locking)_.
    <https://developer.hashicorp.com/terraform/language/backend/s3>.
14. Amazon Web Services. _AWS Well-Architected Framework — Cost Optimization
    Pillar_.
    <https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html>.
15. Amazon Web Services. _AWS Well-Architected Framework — Security Pillar_.
    <https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html>.
16. Amazon Web Services. _AWS Well-Architected Framework — Sustainability
    Pillar_.
    <https://docs.aws.amazon.com/wellarchitected/latest/sustainability-pillar/welcome.html>.
17. Amazon Web Services. _Amazon SQS Developer Guide — Amazon SQS
    dead-letter queues_.
    <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html>.
18. Amazon Web Services. _AWS Lambda Developer Guide — Asynchronous
    invocation_.
    <https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html>.
19. HashiCorp. _Terraform — AWS Provider documentation_.
    <https://registry.terraform.io/providers/hashicorp/aws/latest/docs>.
20. Microsoft. _Playwright — a framework for web testing and automation_.
    <https://playwright.dev/>.
21. Vitest team. _Vitest — a Vite-native testing framework_. <https://vitest.dev/>.
22. Evan You et al. _Vite — Next Generation Frontend Tooling_. <https://vite.dev/>.
23. Conventional Commits. _Conventional Commits v1.0.0 specification_.
    <https://www.conventionalcommits.org/en/v1.0.0/>.
24. Parlamento Europeo y Consejo de la Unión Europea. _Reglamento (UE)
    2016/679 (Reglamento General de Protección de Datos)_.
    <https://eur-lex.europa.eu/eli/reg/2016/679/oj>.

25. Simon Brown. _The C4 model for visualising software architecture_.
    <https://c4model.com/diagrams>. Consulta: 25-oct-2026.
26. Waldo Photos. _Special events_.
    <https://waldophotos.com/special-events/>. Consulta: 25-oct-2026.
27. SpotMyPhotos. _How SpotMyPhotos delivers guests their photos_.
    <https://help.spotmyphotos.com/en/articles/15831042-how-spotmyphotos-delivers-guests-their-photos>.
    Consulta: 25-oct-2026.
28. Photier. _Event photo distribution_. <https://photier.com/>.
    Consulta: 25-oct-2026.
29. Microsoft Azure. _Azure AI Face pricing_.
    <https://azure.microsoft.com/en-us/pricing/details/cognitive-services/face-api/>.
    Consulta: 25-oct-2026.
30. Google Cloud. _Detect faces_.
    <https://cloud.google.com/vision/docs/detecting-faces>.
    Consulta: 25-oct-2026.

# Anexo: trazabilidad del correo

Esta tabla complementa la sección de envío manual de galerías. Separa las
revisiones del código, la ejecución del despliegue y la recepción efectiva;
cada fuente acredita la etapa del recorrido que ejercita.

<!-- prettier-ignore -->
| Hito | Resultado observado | Alcance y límite |
| --- | --- | --- |
| Preparación regional y validación del plan de despliegue | SES de producción habilitado; identidad, DKIM y MAIL FROM verificados; SPF, DMARC y HTTPS disponibles. Plan: 36 altas, 15 modificaciones y cero borrados, sin aplicar. | Preparación de dominio e infraestructura; recepción pendiente en esa etapa. |
| Integración y despliegue del circuito de correo | Se conserva el remitente SES de Cognito. Despliegue: 36 altas, 13 modificaciones y cero destrucciones; circuito de correo, feedback, alarmas y HTTPS habilitados. | Publicación técnica; la recepción se verifica por separado. |
| Correcciones del arnés de pruebas | Ajustes de URL de API, comprobación S3 con permisos limitados, sufijo de foto y consulta de logs. 651 pruebas locales y cinco checks remotos, con ciclo AWS efímero. | Correcciones de contratos de prueba sin ampliar permisos de producción. |
| Corrección del worker de envío | Alias de TTL corregido en dos condiciones DynamoDB, con regresión. 653 pruebas locales; despliegue de 17 actualizaciones, sin altas ni borrados. | Corrige el fallo previo al envío; aceptación completa del arnés pendiente en esa etapa. |
| Ejecución fallida y corrección del escenario de supresión | El escenario de supresión falló por subaddressing y clasificación de BadRequestException. Se corrigieron la dirección sintética, el diagnóstico y los contratos del manifiesto. | Ejecución fallida con limpieza interrumpida; la aceptación requirió un ensayo posterior. |
| Aceptación sintética completa | Nueve escenarios del arnés correctos, incluyendo envío, rebote, queja, supresión, fallo de plantilla, idempotencia y token; limpieza estricta confirmada. | Servicios AWS reales y destinatarios sintéticos; la recepción externa se verifica con su propio recibo. |
| Entrega real a un destinatario | Un buzón corporativo autorizado recibió el mensaje en inbox con SPF/DKIM/DMARC pass; se abrió la galería HTTPS y se purgaron los datos temporales. | Evidencia de recepción y apertura en un destinatario. |
| Invitaciones administrativas por Cognito | Se conserva SES en Cognito; reemisión con AdminCreateUser/RESEND y recepción y acceso confirmados el 20 de octubre de 2026. | Flujo independiente de galerías; sin publicar contraseñas ni ampliar IAM. |
| Sincronización final de documentación y evidencia | Documentación y evidencias integradas con nueve checks correctos; cierre del circuito de correo manual. El criterio multiproveedor quedaba entonces pendiente. | El cierre documenta la implementación y conserva el alcance específico de cada recibo. |

El 23 de octubre de 2026 el equipo añadió la confirmación manual de recepción
en dos proveedores de correo distintos. Este hito posterior
completa el criterio multiproveedor y conserva el alcance individual del recibo automatizado.
