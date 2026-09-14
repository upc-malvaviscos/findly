output "provider_arn" {
  description = "ARN del proveedor OIDC de GitHub Actions."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "role_arn" {
  description = "ARN del rol asumible por GitHub Actions vía OIDC."
  value       = aws_iam_role.github_ci_cd.arn
}
