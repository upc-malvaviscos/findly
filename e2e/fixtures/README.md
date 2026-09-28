# Fixture facial sintética

`synthetic-adult-face.jpg` representa una persona adulta ficticia generada con
la herramienta imagegen de Codex el 28 de septiembre de 2026 para #70. No es una
fotografía aportada por una persona, no contiene identidad o datos de contacto,
y no procede de un conjunto de fotografías reales del proyecto.

La salida generada se codificó como JPEG 512×512 para el contrato de carga. Se
usa exclusivamente en eventos sintéticos de pruebas aisladas. El smoke debe
eliminar objetos, tokens, inscripciones y colección Rekognition; el `destroy`
Terraform no elimina por sí solo colecciones creadas por el handler.

La existencia del fixture no acredita que Rekognition lo acepte, ni una tasa de
precisión sobre personas reales. Esas aserciones requieren el run desplegado.
