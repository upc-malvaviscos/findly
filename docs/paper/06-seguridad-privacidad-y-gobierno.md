# 6. Seguridad, privacidad y gobierno

Detallar consentimiento, minimización, IAM de mínimo privilegio, acceso privado a objetos, autenticación administrativa, derecho de retirada y eliminación de biometría.

ADR-013 conserva únicamente las referencias necesarias para reintentar la
limpieza; no guarda contacto, imagen ni embedding. registrationId, tokenHash
y FaceIds son identificadores sensibles y se restringen a la tabla y roles
del entorno, sin incluirlos en logs ni respuestas públicas. No se presenta
el localizador como anónimo por carecer de correo electrónico.

ADR-014 impide sobrescribir la selfie con la misma URL firmada. ADR-015 impide
que handlers de un entorno consulten o eliminen colecciones de otro mediante
nombres y ARNs específicos. Las colecciones legacy requieren una operación
de migración revisada; no se borran automáticamente al desplegar el cambio.
