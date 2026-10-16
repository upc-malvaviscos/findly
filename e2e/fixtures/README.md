# Fixtures faciales sintéticas

`synthetic-adult-face.jpg` representa una persona adulta ficticia generada con
la herramienta imagegen de Codex el 28 de septiembre de 2026 para #70. No es una
fotografía aportada por una persona, no contiene identidad o datos de contacto,
y no procede de un conjunto de fotografías reales del proyecto.

`synthetic-adult-face-2.jpg` representa una segunda persona adulta ficticia,
distinta de la anterior, generada igualmente con una herramienta de imagegen
el 16 de octubre de 2026 para el escenario "bajo umbral" de #87 (dos personas
distintas nunca deben matchear por similitud). Tampoco es una fotografía
aportada por una persona ni procede de un conjunto de fotografías reales del
proyecto.

Las salidas generadas se codificaron como JPEG para el contrato de carga. Se
usan exclusivamente en eventos sintéticos de pruebas aisladas. El smoke debe
eliminar objetos, tokens, inscripciones y colección Rekognition; el `destroy`
Terraform no elimina por sí solo colecciones creadas por el handler.

La existencia de un fixture no acredita que Rekognition lo acepte, ni una tasa
de precisión sobre personas reales. Esas aserciones requieren el run desplegado.
