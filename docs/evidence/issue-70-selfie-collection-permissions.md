# Issue 70: permisos de colección de SelfieIndexer

SelfieIndexer crea su colección Rekognition con las etiquetas obligatorias
Project, Environment, ManagedBy, CostCenter y DataClass. AWS requiere
`rekognition:TagResource`, además de `rekognition:CreateCollection`, cuando
CreateCollection recibe Tags.

Referencia: [API CreateCollection de AWS](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateCollection.html).

El módulo nuevo selfie-indexer añade TagResource al mismo statement y ARN
regional/de cuenta `collection/findly-event-*` que ya permite crear, indexar
y limpiar caras. No añade recursos comodín generales ni cambia el rol
persistente de CI, las credenciales o políticas de la cuenta.

El test IaC verifica que exista un único statement de tagging, compartido con
CreateCollection y limitado al ARN regional/de cuenta de las colecciones del
proyecto. Este check estático no acredita la autorización AWS efectiva ni la
ejecución de indexación: siguen pendientes el plan/apply autorizado y smoke.
