import * as child_process from "child_process";
import chalk from "chalk";
import * as fs from "fs-extra";
import * as path from "path";


export type SpawnOptions = child_process.SpawnOptions & { silent?: boolean };
export type ExecOptions = child_process.ExecOptions & { silent?: boolean };


export async function runCommand(command: string, args: null, options?: ExecOptions): Promise<void>;
export async function runCommand(command: string, args: string[], options?: SpawnOptions): Promise<void>;
export async function runCommand(command: string, args: string[] | null, options?: SpawnOptions | ExecOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let silent = options && options.silent === true;

    if (!silent) {
      let inClause = options && options.cwd ? `(in ${options.cwd})` : "";
      if (args == null) {
        console.log(chalk.cyan(`→ ${command} ${inClause}`));
      } else {
        console.log(chalk.cyan(`→ ${command} ${args.join(" ")} ${inClause}`));
      }
    }

    let params = Object.assign({
      stdio: silent ? "ignore" : "inherit"
    }, options || { });

    let proc: child_process.ChildProcess;
    if (args == null) {
      proc = child_process.exec(command, params as ExecOptions);
    } else {
      proc = child_process.spawn(command, args, params as SpawnOptions);
    }

    proc.on("close", code => {
      if (!silent) {
        console.log(chalk.cyan("→ DONE"));
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on("error", error => {
      if (!silent) {
        console.log(chalk.red(`→ ERROR: ${error.message}`));
      }
      reject(error);
    });
  });
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


export async function walkDirectoryFiles(startDir: string, walker: (filename: string, stat: fs.Stats) => Promise<void>): Promise<void> {
  const handle = async(filename: string) => {
    let stat: fs.Stats;

    try {
      stat = fs.statSync(filename);
    } catch (error) {
      return;
    }

    await walker(filename, stat);

    if (stat.isDirectory()) {
      let items = fs.readdirSync(filename);
      for (let item of items) {
        await handle(path.join(filename, item));
      }
    }
  };

  await handle(startDir);
}


export function getRidOfIt(filename: string): void {
  let stat: fs.Stats;

  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  (stat.isDirectory() ? fs.rmdirSync : fs.unlinkSync)(filename);
}
