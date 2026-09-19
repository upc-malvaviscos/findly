# Valores no sensibles. No añadas secretos, credenciales ni estados.
# Sustituye el sufijo del bucket por un nombre globalmente único de tu cuenta
# (por ejemplo findly-production-<ACCOUNT_ID>-eu-west-1) al aplicar.
aws_region          = "eu-west-1"
project             = "findly"
cost_center         = "findly"
data_class          = "biometric"
frontend_domain_url = "https://findly.example"
uploads_bucket_name = "findly-production-replace-with-account-id-eu-west-1"
