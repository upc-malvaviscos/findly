variable "table_name" { type = string }
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
variable "enable_point_in_time_recovery" {
  type    = bool
  default = false
}
