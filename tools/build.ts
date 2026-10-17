import { copyFile } from "node:fs/promises";

await Promise.all(
  ["index.html", "styles.css"].map((file) =>
    copyFile(new URL(`../${file}`, import.meta.url), new URL(`../dist/${file}`, import.meta.url)),
  ),
);
