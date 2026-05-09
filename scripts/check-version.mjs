import { readFileSync } from "node:fs";

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag?.startsWith("v")) {
  console.error(`expected tag like v1.2.3, got ${tag}`);
  process.exit(1);
}
const tagVersion = tag.slice(1);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const mf = JSON.parse(readFileSync("com.nshopik.agentichooks.sdPlugin/manifest.json", "utf8"));
const expectedManifest = `${tagVersion}.0`;
const errs = [];
if (pkg.version !== tagVersion) {
  errs.push(`package.json version=${pkg.version}, expected ${tagVersion}`);
}
if (mf.Version !== expectedManifest) {
  errs.push(`manifest Version=${mf.Version}, expected ${expectedManifest}`);
}
if (errs.length) {
  for (const e of errs) console.error(e);
  process.exit(1);
}
console.log(`version check OK: tag=${tag}, package=${pkg.version}, manifest=${mf.Version}`);
