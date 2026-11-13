import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requiredFiles = ["dist/index.html", "dist/app.js", "dist/styles.css"];

for (const relativePath of requiredFiles) {
  await access(path.join(projectRoot, relativePath));
}

console.log(`PeerArena build verified: ${requiredFiles.join(", ")}`);
console.log("Build target: static dist output; backend deployment remains a separate configured service.");
