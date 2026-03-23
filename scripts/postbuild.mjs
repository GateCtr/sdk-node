import { writeFileSync } from "fs";

// Writes {"type":"commonjs"} to dist/cjs/package.json
// so Node.js resolves .js files in that directory as CJS
writeFileSync(
  new URL("../dist/cjs/package.json", import.meta.url),
  JSON.stringify({ type: "commonjs" }, null, 2)
);

console.log("✓ dist/cjs/package.json written");
