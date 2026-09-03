# 2. Contexto, objetivos y alcance

Findly aborda la localización privada de fotografías de eventos para asistentes que han otorgado consentimiento biométrico explícito y han proporcionado una selfie autorizada. Los actores son el asistente, que gestiona su inscripción y galería temporal, y el organizador autenticado, que carga fotografías del evento.

El MVP mide una inscripción satisfactoria superior al 98 %, un procesamiento de selfie inferior a tres segundos, una respuesta p95 de galería inferior a 500 ms y un umbral de similitud de Rekognition de al menos 95.0 %. Se limita a una única región AWS y a una arquitectura serverless de coste fijo cero en capa gratuita o sandbox.

Quedan fuera del alcance la vigilancia o el vídeo en tiempo real, imágenes no autorizadas, menores sin consentimiento documentado del tutor, alta disponibilidad o multirregión, RDS, EC2, VPC, NAT, EKS y comunicaciones masivas por correo o SMS.
