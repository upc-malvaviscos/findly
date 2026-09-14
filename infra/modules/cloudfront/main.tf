terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

locals {
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    CostCenter  = var.cost_center
    DataClass   = var.data_class
  }
  has_custom_domain = var.custom_domain_name != ""
  # Politica AWS-managed "CachingOptimized", estandar para hosting estatico.
  caching_optimized_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
}

resource "aws_s3_bucket" "web" {
  bucket = var.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "findly-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = local.has_custom_domain ? [var.custom_domain_name] : []
  # El workflow de despliegue (spec 14 / issue #15) localiza la
  # distribucion por este Comment para invalidar su cache tras cada
  # despliegue: `--query "...[?Comment=='findly-{entorno}']"`.
  comment = "findly-${var.environment}"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "findly-web-bucket"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "findly-web-bucket"
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = local.caching_optimized_policy_id
  }

  # La SPA enruta en el cliente (App.tsx); sin este mapeo, recargar una
  # ruta como /gallery devolveria 403/404 de S3 en vez de servir index.html.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # La spec 03 exige TLSv1.2_2021, pero ese minimo solo es configurable con
  # un certificado ACM propio (SNI); el certificado por defecto de
  # *.cloudfront.net no lo admite. Ningun spec de este proyecto define
  # todavia un dominio propio ni una zona Route53 — ver custom_domain_name.
  dynamic "viewer_certificate" {
    for_each = local.has_custom_domain ? [1] : []
    content {
      acm_certificate_arn      = var.acm_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }
  dynamic "viewer_certificate" {
    for_each = local.has_custom_domain ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }

  tags = local.tags
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
          }
        }
      }
    ]
  })
}
