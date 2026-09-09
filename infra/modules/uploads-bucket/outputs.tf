output "bucket_name" {
  description = "Nombre del bucket S3 de subidas."
  value       = aws_s3_bucket.uploads.id
}

output "bucket_arn" {
  description = "ARN del bucket S3 de subidas."
  value       = aws_s3_bucket.uploads.arn
}
