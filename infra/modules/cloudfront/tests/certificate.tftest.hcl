mock_provider "aws" {}

variables {
  bucket_name = "findly-demo-web-test"
  environment = "demo"
}

run "demo_default_certificate" {
  command = plan
  assert {
    condition     = aws_cloudfront_distribution.web.viewer_certificate[0].cloudfront_default_certificate
    error_message = "Demo without a domain must use the AWS certificate."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.web.aliases) == 0
    error_message = "Default-domain demo must not configure aliases."
  }
}

run "custom_certificate" {
  command = plan
  variables {
    custom_domain_name  = "demo.example.com"
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }
  assert {
    condition     = aws_cloudfront_distribution.web.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    error_message = "Custom domains must preserve the minimum TLS policy."
  }
}

run "production_requires_domain" {
  command = plan
  variables {
    environment = "production"
  }
  expect_failures = [aws_cloudfront_distribution.web]
}

run "orphan_certificate_rejected" {
  command = plan
  variables {
    acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  }
  expect_failures = [aws_cloudfront_distribution.web]
}

run "custom_domain_requires_certificate" {
  command = plan
  variables {
    custom_domain_name = "demo.example.com"
  }
  expect_failures = [aws_cloudfront_distribution.web]
}
