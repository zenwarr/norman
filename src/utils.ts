import * as child_process from "child_process";
import chalk from "chalk";
import * as fs from "fs-extra";
import * as path from "path";


export type SpawnOptions = child_process.SpawnOptions & { silent?: boolean };


export function runCommand(command: string, args: string[], options?: SpawnOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (options && options.silent !== true) {
      console.log(chalk.cyan(`→ ${command} ${args.join(" ")} ${options && options.cwd ? "(in " + options.cwd + ")" : ""}`));
    }

    let proc = child_process.spawn(command, args, Object.assign({
      stdio: options && options.silent === true ? "ignore" : "inherit"
    }, options || { }));

    proc.on("close", code => {
      if (options && options.silent !== true) {
        console.log(chalk.cyan("→ DONE"));
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on("error", error => {
      if (options && options.silent !== true) {
        console.log(chalk.red(`→ ERROR: ${error.message}`));
      }
      reject(error);
    });
  });
}


export function updateSymlink(to: string, from: string): void {
  let cleaner: ((path: string) => void)|null = null;

  try {
    let linkStat = fs.lstatSync(from);

    try {
      let realpath = fs.realpathSync(from);

      if (linkStat.isDirectory()) {
        // it is not a link but a directory
        cleaner = fs.removeSync;
      } else if (realpath !== to) {
        // link points to another directory (or it is not a link at all), remove it and update
        cleaner = fs.unlinkSync;
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        // oops, broken link!
        cleaner = fs.unlinkSync;
      } else {
        throw error;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (cleaner) {
    cleaner(from);
  }

  fs.ensureSymlinkSync(to, from);
}


export function randomString(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let text = "";
  for (let i = 0; i < 20; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}


export async function cleanNpmCache(): Promise<void> {
  return runCommand("npm", [ "cache", "clean", "--force" ], {
    silent: true
  });
}


export function getPackageDeps(packagePath: string, includeDev: boolean = true): string[] {
  try {
    let pkgPath = path.join(packagePath, "package.json");
    let pkg = fs.readJSONSync(pkgPath, { encoding: "utf-8" });
    let deps = Object.keys(pkg.dependencies);
    if (includeDev) {
      deps = deps.concat(Object.keys(pkg.devDependencies || {}));
    }
    return deps;
  } catch (error) {
    console.log(chalk.yellow(`Failed to get dependencies for package at path [${packagePath}]: ${error.message}`));
    return [];
  }
}
