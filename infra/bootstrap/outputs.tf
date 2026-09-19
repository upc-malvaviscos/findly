output "state_bucket_name" {
  description = "Bucket name to pass as -backend-config=bucket=... in each environment."
  value       = aws_s3_bucket.state.id
}
