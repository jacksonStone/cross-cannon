import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "dev";
const sourceRoot = path.resolve(".");
const targetRoot = "/private/tmp/cross-cannon-remix-dev";

if (!["dev", "build"].includes(mode)) {
  throw new Error(`Unsupported Remix temp mode: ${mode}`);
}

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

const entries = [
  "app",
  "data",
  "public",
  "scripts",
  "storage",
  "package.json",
  "package-lock.json",
  "README.md",
  "remix.config.js",
  "remix.env.d.ts",
  "tsconfig.json",
  "vite.config.ts"
];

for (const entry of entries) {
  const source = path.join(sourceRoot, entry);
  if (!(await exists(source))) {
    continue;
  }

  await cp(source, path.join(targetRoot, entry), {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(sourceRoot, file);
      return ![
        "node_modules",
        ".npm-cache",
        ".tmp",
        "build",
        ".cache"
      ].some((ignored) => relative === ignored || relative.startsWith(`${ignored}/`));
    }
  });
}

console.log(`Mirrored Cross Cannon to ${targetRoot}`);
await run("npm", ["install", "--cache", "./.npm-cache", "--prefer-offline", "--no-audit", "--no-fund"], targetRoot);

const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "file:./storage/crosscannon.db",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? ""
};

if (mode === "dev") {
  await run("npm", ["run", "dev:direct"], targetRoot, env);
} else {
  await run("npm", ["run", "build:direct"], targetRoot, env);
  await rm(path.join(sourceRoot, "build"), { recursive: true, force: true });
  await cp(path.join(targetRoot, "build"), path.join(sourceRoot, "build"), { recursive: true });
  console.log("Copied Remix build artifacts back to ./build");
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve();
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
