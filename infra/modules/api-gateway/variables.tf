variable "frontend_domain_url" {
  description = "Origen exacto del frontend autorizado por CORS en la API."
  type        = string
}
variable "project" {
  type    = string
  default = "findly"
}
variable "environment" { type = string }
variable "cost_center" {
  type    = string
  default = "findly"
}
variable "data_class" {
  type    = string
  default = "biometric"
}
variable "throttled_route_keys" {
  description = "Rutas públicas con throttling propio en el stage (ADR-018)."
  type        = list(string)
  default     = []
}
variable "throttled_route_burst_limit" {
  description = "Ráfaga máxima de peticiones para las rutas con throttling propio."
  type        = number
  default     = 10
}
variable "throttled_route_rate_limit" {
  description = "Peticiones por segundo sostenidas para las rutas con throttling propio."
  type        = number
  default     = 5
}
