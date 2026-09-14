output "bucket_name" {
  description = "Nombre del bucket S3 del sitio estatico."
  value       = aws_s3_bucket.web.id
}

output "distribution_id" {
  description = "Id de la distribucion CloudFront."
  value       = aws_cloudfront_distribution.web.id
}

output "distribution_domain_name" {
  description = "Dominio *.cloudfront.net de la distribucion."
  value       = aws_cloudfront_distribution.web.domain_name
}
