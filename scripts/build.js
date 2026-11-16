import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = resolve(projectRoot, "dist");
const publishedPaths = ["index.html", "styles.css", "src", "public/assets"];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const path of publishedPaths) {
  await cp(resolve(projectRoot, path), resolve(outputDirectory, path), {
    recursive: true,
  });
}

console.log(`Static site built in ${outputDirectory}`);
