# Instrucciones para agentes de Findly

## Propósito y límites

Findly es una demostración académica para que asistentes de un evento, con consentimiento explícito, encuentren sus fotografías. No implementar ni proponer vigilancia, vídeo en tiempo real, tratamiento de menores, envíos masivos, multirregión, RDS, EC2, NAT, VPC ni otros servicios de coste fijo.

Trata las imágenes, embeddings faciales, tokens de galería y datos de contacto como datos sensibles. Nunca incluyas secretos, ficheros `.env`, estados de Terraform, credenciales AWS ni datos biométricos reales en Git, pruebas, capturas o documentación.

La fuente de verdad es el backlog en `specs/`; el contexto de producto está en `README.md`; las decisiones se registran en `docs/adr/`; y las pruebas, capturas y salidas reproducibles pertenecen a `docs/evidence/`.

## Flujo obligatorio: research -> plan -> implement -> sync

Aplica las cuatro fases, en este orden, a toda tarea de cierta magnitud. Las ediciones puramente tipográficas u otros cambios triviales pueden omitir las fases que no aporten valor.

### 1. Research

Antes de editar, identifica la spec o specs que gobiernan el cambio y lee sus criterios de aceptación, restricciones, checklist y pitfalls. Revisa también las partes afectadas de `README.md`, `docs/adr/`, `docs/paper/` y el código o IaC existente. Conserva cualquier cambio local ajeno: inspección primero y edición únicamente dentro del alcance pedido.

Contrasta explícitamente:

- el flujo afectado de extremo a extremo (web, API, eventos, datos e IAM);
- privacidad, consentimiento, retención, borrado y mínimos privilegios;
- coste: serverless, on-demand y capa gratuita/sandbox definida;
- observabilidad: métricas, logs, alarmas y evidencia necesaria;
- contratos, claves DynamoDB, permisos y dependencias entre specs.

No inventes requisitos cuando una spec, ADR o contrato ya los define. Si hay un conflicto o falta una decisión arquitectónica relevante, detente antes de implementar y propone o solicita un ADR.

### 2. Plan

Presenta un plan breve y concreto antes de modificar código. Incluye:

1. objetivo y spec(s) de referencia;
2. archivos, recursos AWS y contratos que cambiarán;
3. orden de implementación, incluyendo migraciones o compatibilidad si aplica;
4. estrategia de pruebas y validación de extremo a extremo;
5. evidencia documental y ADR que se crearán o actualizarán;
6. riesgos de seguridad, privacidad, coste u operación, y su mitigación.

El plan debe ser lo bastante pequeño como para revisar cada paso, pero completo para que no deje cambios implícitos. Para cambios que alteren arquitectura, datos, permisos, coste o comportamiento público, espera confirmación del plan antes de empezar la fase de implementación. Para tareas mecánicas y acotadas, indica el plan y continúa.

### 3. Implement

Implementa solo lo planificado. Mantén TypeScript estricto: no uses `any`, supresiones de ESLint ni atajos que oculten errores. Prefiere módulos pequeños, contratos tipados y comentarios que expliquen decisiones no evidentes, no el funcionamiento literal.

Para infraestructura, usa Terraform reproducible y recursos etiquetados con `Project`, `Environment`, `ManagedBy`, `CostCenter` y `DataClass`. Aplica el principio de mínimo privilegio, bloquea el acceso público a buckets y evita salidas que expongan información sensible. No ejecutes despliegues o acciones destructivas en AWS sin que se hayan solicitado explícitamente.

Actualiza pruebas junto con la funcionalidad: unitarias/integración para lógica y contratos, E2E para recorridos de usuario y validaciones de IaC cuando corresponda. Añade una evidencia reproducible en `docs/evidence/` y actualiza la memoria o ADR si el cambio afecta decisiones, arquitectura o resultados.

### 4. Sync

Después de implementar y validar, sincroniza toda la documentación afectada con el estado real del sistema. Esta fase es obligatoria para cualquier tarea de cierta magnitud que no sea trivial.

Revisa y actualiza, cuando aplique:

- las specs en `specs/`, incluidos criterios de aceptación, checklists, dependencias y estado de implementación;
- los ADRs en `docs/adr/` cuando la implementación confirme, modifique o introduzca una decisión arquitectónica;
- el `README.md`, la memoria en `docs/paper/` y la evidencia en `docs/evidence/`;
- diagramas de arquitectura, flujos, contratos, modelos de datos y recursos AWS representados.
- la GitHub Issue en la que se ha trabajado: añade un comentario con alcance, PR, validaciones, evidencia y pendientes; ciérrala únicamente cuando todos sus criterios estén verificados.

La documentación debe describir exactamente lo implementado y validado, no el diseño anterior ni trabajo futuro presentado como hecho. Si existe una discrepancia que no se pueda resolver sin cambiar alcance o tomar una decisión, documéntala como pendiente y solicita la decisión necesaria antes de declararla sincronizada.

## Validación y entrega

Usa Node.js 22. Cuando estén disponibles, ejecuta los comandos definidos en la spec de fundación:

```sh
npm run lint
npm run test
npm run build
npm run verify
```

Ejecuta además `npm run test:e2e` cuando cambie un flujo de usuario. Para Terraform, valida formato, configuración y linting; para cambios de workflows, valida con `actionlint`. Si una comprobación no puede ejecutarse porque la base del repositorio aún no la incorpora, dilo claramente y valida la alternativa más próxima sin ocultarlo.

Al finalizar, informa de: cambio realizado, documentación sincronizada, specs/ADR afectados, comandos ejecutados y resultado, evidencia generada, y riesgos o trabajo pendiente. No afirmes que un requisito está completado sin una prueba o evidencia verificable.

## Convenciones de Git

Mantén commits pequeños con Conventional Commits. No borres, restaures ni sobrescribas cambios existentes que no pertenezcan a la tarea. Antes de una acción destructiva, identifica los objetivos exactos y solicita autorización.
