import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { awsCommand as aws } from './lib/aws-command.mjs';
import {
  demoConfiguration,
  validateDestroyPlan,
} from './lib/demo-controls.mjs';
import {
  demoCollectionIds,
  emptyDemoBucket,
  quiesceDemo,
} from './lib/demo-cleanup.mjs';

const config = demoConfiguration(process.env);
assert.equal(
  aws('sts', 'get-caller-identity').Account,
  config.account,
  'Credential account mismatch',
);
const inventory = validateDestroyPlan(
  JSON.parse(readFileSync(process.argv[2], 'utf8')),
  config,
);
// Inventory is temporary runner-private data, never uploaded as an artifact.
writeFileSync(process.argv[3], JSON.stringify(inventory), { mode: 0o600 });
const collections = demoCollectionIds(aws, config);
console.log(
  `Verified demo inventory: ${inventory.resources.length} resources, ${inventory.buckets.length} buckets, ${collections.length} collections.`,
);
await quiesceDemo(aws, inventory, config, setTimeout);
for (const bucket of inventory.buckets)
  await emptyDemoBucket(aws, bucket, config);
for (const CollectionId of demoCollectionIds(aws, config))
  aws('rekognition', 'delete-collection', { CollectionId });
assert.equal(demoCollectionIds(aws, config).length, 0);
console.log(
  'Demo producers stopped and owned data cleaned. Generate and validate the final destroy plan before applying.',
);
