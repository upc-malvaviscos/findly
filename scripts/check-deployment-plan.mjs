import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync(0, 'utf8'));
const prohibited = new Set([
  'aws_vpc',
  'aws_nat_gateway',
  'aws_instance',
  'aws_db_instance',
  'aws_db_cluster',
  'aws_rds_cluster_instance',
  'aws_lb',
  'aws_eks_cluster',
]);
const failures = [];
for (const resource of plan.resource_changes ?? []) {
  if (resource.mode !== 'managed') continue;
  if (resource.change?.actions?.includes('delete'))
    failures.push(
      `Deletion or replacement requires separate review: ${resource.address}`,
    );
  if (prohibited.has(resource.type))
    failures.push(`Fixed-cost resource prohibited: ${resource.address}`);
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(
  'Deployment plan preserves existing resources and the serverless boundary.',
);
