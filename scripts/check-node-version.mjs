import process from 'node:process';

const minimumMajor = 22;
const currentMajor = Number.parseInt(process.versions.node, 10);

if (!Number.isInteger(currentMajor) || currentMajor < minimumMajor) {
  console.error(
    `Node.js >= ${minimumMajor} is required for Wrangler 4.123.0; `
      + `found ${process.version}`,
  );
  process.exitCode = 1;
}
