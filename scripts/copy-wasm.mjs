import { cp, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageJson = require.resolve("@litert-lm/core/package.json");
const source = path.join(path.dirname(packageJson), "wasm");
const destination = path.join(process.cwd(), "public", "litertlm");

await mkdir(destination, { recursive: true });
const entries = await readdir(source);

for (const entry of entries) {
  await cp(path.join(source, entry), path.join(destination, entry), {
    recursive: true,
  });
}

console.log(`Copied ${entries.length} LiteRT-LM runtime files to public/litertlm`);
