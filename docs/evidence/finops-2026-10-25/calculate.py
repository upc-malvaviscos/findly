#!/usr/bin/env python3
"""Offline, stdlib-only estimate from inputs.json. Run: python3 calculate.py [inputs.json] [output.csv]."""
import csv, json, math, sys
from pathlib import Path
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name('inputs.json')
out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_name('costs.csv')
d = json.loads(source.read_text())
p, a = d['prices'], d['assumptions']

def tier_cost(units, tiers):
    remaining, total, lower = units, 0.0, 0.0
    for upper, rate in tiers:
        width = remaining if upper is None else max(0, min(remaining, upper-lower))
        total += width * rate
        remaining -= width
        if upper is None or remaining <= 0: break
        lower = upper
    return total

def calc(s):
    A,N,L = s['attendees'],s['photos'],s['late_registrations']
    visitors = A + 2 # attendees plus two organizer sessions, assumed
    pages = math.ceil(N/a['late_backfill_page_size']) if N else 0
    passes = N*(1+L) # new-photo processing and one full existing-photo pass per late registration
    # Every selfie indexes one retained face; each photo pass indexes one temporary face and searches once per detected face.
    group1 = A + passes*(1+a['average_faces_per_event_photo'])
    rek = tier_cost(group1,p['rekognition_group1']['tiers']) + A*p['rekognition_face_vector_month']['rate']
    matches = A*a['matches_per_attendee_storage']
    # Query reads are rounded to 4 KiB independently per backfill page (strongly consistent), plus one registration Get/page.
    page_sizes=[]
    for _ in range(L):
        for offset in range(0,N,a['late_backfill_page_size']):
            page_sizes.append(min(a['late_backfill_page_size'],N-offset))
    backfill_query_rru=sum(math.ceil(n*a['query_photo_item_bytes']/4096) for n in page_sizes)
    ddb_reads = backfill_query_rru + len(page_sizes) + matches*a['ddb_transactional_condition_read_ru_per_match'] + matches*0.5
    ddb_writes = N + A + matches*a['ddb_match_transaction_put_wru_per_match_pair']
    ddb_storage_gb = (N*a['photo_metadata_bytes'] + A*a['registration_metadata_bytes'] + matches*2*a['match_item_bytes'])/1024**3
    ddb = ddb_reads*p['dynamodb_read_request_unit']['rate'] + ddb_writes*p['dynamodb_write_request_unit']['rate'] + ddb_storage_gb*p['dynamodb_storage_gb_month']['rate']
    downloads = A*a['downloads_per_attendee']
    frontend_requests = visitors*a['frontend_https_requests_per_visitor']
    frontend_miss_requests = frontend_requests*(1-a['cloudfront_cache_hit_ratio'])
    frontend_s3_origin_gets = frontend_miss_requests # one origin object GET per miss, simplified
    s3_puts = N + A + a['monthly_frontend_deploy_puts']
    s3_gets = downloads + passes + A + frontend_s3_origin_gets # downloads, IndexFaces source reads, and CloudFront origin misses
    s3_store_gb = (N*a['image_mib'] + A*a['selfie_mib'] + a['frontend_s3_origin_mib'])*a['retention_months']/1024
    s3 = s3_store_gb*p['s3_standard_gb_month']['rate'] + s3_puts/1000*p['s3_put_per_1000']['rate'] + s3_gets*p['s3_get_request']['rate']
    s3_egress_gb = downloads*a['image_mib']/1024
    s3_egress = s3_egress_gb*p['internet_egress_gb']['rate']
    cf_gb = visitors*a['frontend_static_mib_per_visitor']/1024
    cf_requests_cost = frontend_requests*p['cloudfront_https_request']['rate']
    cf_egress_cost = cf_gb*p['cloudfront_europe_egress_gb']['rate']
    cognito = a['cognito_mau']*p['cognito_essentials_mau']['rate']
    api = A*a['api_requests_per_attendee'] + N*a['api_requests_per_photo'] + a['api_fixed_requests'] + A*a['gallery_email_status_api_calls_per_email']
    api_cost = api*p['api_gateway_http_request']['rate']
    backfill_inv = L*pages
    email_worker_inv = A
    purge_inv = a['retention_purger_monthly_invocations']
    lambda_inv = api + N + A + backfill_inv + email_worker_inv + purge_inv
    lambda_gbs = (api*a['api_lambda_ms']*a['api_lambda_memory_mb']/1024/1000 + N*a['photo_lambda_ms_per_photo_pass']*a['photo_lambda_memory_mb']/1024/1000 + L*N*a['photo_lambda_ms_per_photo_pass']*a['photo_lambda_memory_mb']/1024/1000 + A*a['enrollment_lambda_ms_per_attendee']*a['enrollment_lambda_memory_mb']/1024/1000 + backfill_inv*a['backfill_lambda_fixed_ms_per_page']*a['backfill_lambda_memory_mb']/1024/1000 + email_worker_inv*a['gallery_email_worker_ms']*a['gallery_email_worker_memory_mb']/1024/1000 + purge_inv*a['retention_purger_ms']*a['retention_purger_memory_mb']/1024/1000)
    lam = lambda_inv*p['lambda_request']['rate'] + lambda_gbs*p['lambda_gb_second']['rate']
    standard_sqs_requests = 3*(N + backfill_inv)
    fifo_sqs_requests = A*a['gallery_email_sqs_requests_per_email']
    sqs = standard_sqs_requests*p['sqs_standard_request']['rate'] + fifo_sqs_requests*p['sqs_fifo_request']['rate']
    ses = A*p['ses_email']['rate'] # one email per participant, direct classic SendEmail PAYG assumed; no attachments
    sns = a['sns_sends_per_month']*p['sns_api_request']['rate']
    cw = s['log_ingest_gb']*(p['cloudwatch_log_ingest_gb']['rate']+p['cloudwatch_log_storage_gb_month']['rate']*a['retention_months']) + s['cloudwatch_alarms']*p['cloudwatch_alarm_metric_month']['rate'] + s['cloudwatch_custom_metrics']*p['cloudwatch_custom_metric_month']['rate']
    scheduler = purge_inv*p['scheduler_invocation']['rate']
    parts={'Rekognition':rek,'S3':s3,'S3 egress Internet':s3_egress,'CloudFront':cf_requests_cost+cf_egress_cost,'Cognito':cognito,'DynamoDB':ddb,'Lambda':lam,'API Gateway HTTP':api_cost,'SQS Standard':standard_sqs_requests*p['sqs_standard_request']['rate'],'SQS FIFO':fifo_sqs_requests*p['sqs_fifo_request']['rate'],'SES':ses,'SNS':sns,'CloudWatch':cw,'EventBridge Scheduler':scheduler}
    result={'scenario':s['name'],'attendees':A,'photos':N,'late_registrations':L,'cognito_assumed_mau':a['cognito_mau'],'rekognition_group1_units_including_selfies':group1,'ddb_read_request_units':ddb_reads,'ddb_write_request_units':ddb_writes,'ddb_storage_GiB':ddb_storage_gb,'s3_storage_GiB_month':s3_store_gb,'s3_put_requests':s3_puts,'s3_get_requests':s3_gets,'s3_photo_downloads':downloads,'s3_photo_egress_GiB':s3_egress_gb,'cloudfront_https_requests':frontend_requests,'cloudfront_transfer_GiB':cf_gb,'cloudfront_origin_get_requests':frontend_s3_origin_gets,'api_gateway_http_requests':api,'lambda_invocations_assumed':lambda_inv,'lambda_GB_seconds':lambda_gbs,'sqs_standard_requests':standard_sqs_requests,'sqs_fifo_requests':fifo_sqs_requests,'ses_recipients':A,'scheduler_invocations':purge_inv,'cloudwatch_logs_ingested_GiB':s['log_ingest_gb'],'cloudwatch_alarms':s['cloudwatch_alarms'],'cloudwatch_custom_metrics':s['cloudwatch_custom_metrics']}
    result.update({f'cost_{k.replace(" ","_").replace("/","_")}':v for k,v in parts.items()})
    result['total_modeled_services_usd']=sum(parts.values())
    return result
rows=[calc(s) for s in d['scenarios']]
with out.open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');w.writeheader();w.writerows(rows)
for r in rows: print(r['scenario'],f"${r['total_modeled_services_usd']:.4f}",' / '.join(f"{k}=${v:.4f}" for k,v in r.items() if k.startswith('cost_')))
print('CSV:',out)
