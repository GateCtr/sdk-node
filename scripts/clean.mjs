// scripts/clean.mjs — cross-platform clean (works on Windows, macOS, Linux)
import { rmSync, readdirSync } from "fs";
import { join } from "path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// Remove dist/
try {
  rmSync(join(root, "dist"), { recursive: true, force: true });
} catch {
  // already absent — fine
}

// Remove *.tsbuildinfo files in root
try {
  const files = readdirSync(root);
  for (const f of files) {
    if (f.endsWith(".tsbuildinfo")) {
      rmSync(join(root, f), { force: true });
    }
  }
} catch {
  // nothing to clean
}
