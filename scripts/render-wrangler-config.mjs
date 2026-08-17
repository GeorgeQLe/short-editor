import { readFile, writeFile } from "node:fs/promises";

const outputPath = process.argv[2] ?? "infra/terraform/wrangler-bindings.json";
const destination = process.argv[3] ?? "apps/api/wrangler.generated.jsonc";
const terraform = JSON.parse(await readFile(outputPath, "utf8"));
const bindings = terraform.wrangler_bindings?.value ?? terraform.wrangler_bindings;
if (!bindings?.worker_name || !bindings.database?.database_id || !bindings.media?.bucket_name) {
  throw new Error("Terraform wrangler_bindings output is incomplete");
}
const base = JSON.parse(stripComments(await readFile("apps/api/wrangler.jsonc", "utf8")));
base.name = bindings.worker_name;
base.d1_databases = [{ ...bindings.database, migrations_dir: "migrations-d1" }];
base.r2_buckets = [{ binding: bindings.media.binding, bucket_name: bindings.media.bucket_name }];
base.queues = { producers: Object.values(bindings.queues).map(({ queue_id: _, ...queue }) => ({
  binding: queue.binding, queue: queue.queue_name
})) };
base.vars.PUBLIC_BASE_URL = bindings.public_base_url;
base.vars.ENVIRONMENT = bindings.environment;
base.vars.TURNSTILE_SITE_KEY = bindings.turnstile_site_key;
await writeFile(destination, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 });

function stripComments(value) {
  return value.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
