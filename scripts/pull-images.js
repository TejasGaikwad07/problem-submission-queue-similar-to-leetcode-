// Pre-pulls the sandbox images. Cross-platform (no bash needed): npm run judge:pull-images
const { spawnSync } = require("child_process");

const images = [
  process.env.JUDGE_IMAGE_CPP || "gcc:13",
  process.env.JUDGE_IMAGE_JAVASCRIPT || "node:20-alpine",
  process.env.JUDGE_IMAGE_PYTHON || "python:3.12-alpine",
];

let failed = false;
for (const image of images) {
  console.log(`Pulling ${image} ...`);
  const result = spawnSync("docker", ["pull", image], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`Failed to pull ${image}. Is Docker Desktop running?`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
