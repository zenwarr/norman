import * as child_process from "child_process";
import chalk from "chalk";
import * as fs from "fs-extra";
import * as path from "path";


type ExtraRunOptions = {
  silent?: boolean;
  collectOutput?: boolean;
  ignoreExitCode?: boolean;
};

export type SpawnOptions = child_process.SpawnOptions & ExtraRunOptions;
export type ExecOptions = child_process.ExecOptions & ExtraRunOptions;


export async function runCommand(command: string, args: null, options?: ExecOptions): Promise<string>;
export async function runCommand(command: string, args: string[], options?: SpawnOptions): Promise<string>;
export async function runCommand(command: string, args: string[] | null, options?: SpawnOptions | ExecOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let silent = options && options.silent === true;

    if (!silent) {
      let inClause = options && options.cwd ? `(in ${options.cwd})` : "";
      if (args == null) {
        console.log(chalk.cyan(`→ ${command} ${inClause}`));
      } else {
        console.log(chalk.cyan(`→ ${command} ${args.join(" ")} ${inClause}`));
      }
    }

    let defOptions = options && options.collectOutput === true ? { } : {
      stdio: silent ? "ignore" : "inherit",
      stderr: silent ? "ignore" : "inherit"
    };

    let params = Object.assign(defOptions, options || { });

    let proc: child_process.ChildProcess;
    if (args == null) {
      proc = child_process.exec(command, params as ExecOptions);
    } else {
      proc = child_process.spawn(command, args, params as SpawnOptions);
    }

    let output = "";
    if (options && options.collectOutput) {
      proc.stdout.on("data", data => {
        output += data;
      });
    }

    proc.on("close", code => {
      if (!silent) {
        console.log(chalk.cyan("→ DONE"));
      }
      if (code === 0) {
        resolve(output);
      } else if (options && options.ignoreExitCode) {
        resolve(output);
      } else {
        logProcessExecuteError(code, command, args, options);

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


function logProcessExecuteError(exitCode: number, command: string, args: null | string[], options?: SpawnOptions | ExecOptions) {
  console.log(chalk.red("Failed to execute the following command:"));
  if (args == null) {
    console.log(chalk.redBright("  " + command));
  } else {
    const commandParams = args.join(" ");
    console.log(chalk.redBright(`  ${command} ${commandParams}`));
  }

  if (options && options.cwd) {
    console.log(chalk.redBright("  in directory:", options.cwd));
  }

  if (exitCode === 127) {
    if (args == null) {
      console.log(chalk.red(`Please make sure executable exists, or, in case or running npm script, make sure that script ${command} exists`));
    } else {
      console.log(chalk.red("Please make sure executable exists"));
    }
  }
}


export async function cleanNpmCache(): Promise<void> {
  await runCommand(getNpmExecutable(), [ "cache", "clean", "--force" ], {
    silent: true
  });
}


export function getPackageDeps(packagePath: string, includeDev: boolean = true): string[] {
  try {
    let pkgPath = path.join(packagePath, "package.json");
    let pkg = fs.readJSONSync(pkgPath, { encoding: "utf-8" });
    let deps = Object.keys(pkg.dependencies || {});
    if (includeDev) {
      deps = deps.concat(Object.keys(pkg.devDependencies || {}));
    }
    return deps;
  } catch (error) {
    console.log(chalk.yellow(`Failed to get dependencies for package at path [${packagePath}]: ${error.message}`));
    return [];
  }
}


export function isPackageInstalled(into: string, pkg: string): boolean {
  let installedPath = path.join(into, "node_modules", pkg);
  return fs.existsSync(installedPath);
}


export function getFirstMissingDependency(packagePath: string, includeDev: boolean = true): string | null {
  let deps = getPackageDeps(packagePath, includeDev);

  for (let dep of deps) {
    if (!isPackageInstalled(packagePath, dep)) {
      return dep;
    }
  }

  return null;
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


export function hasExecPermission(filename: string): boolean {
  if (process.platform === "win32") {
    return false;
  } else {
    try {
      fs.accessSync(filename, fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }
}


export function isSymlink(filename: string): boolean {
  return fs.lstatSync(filename).isSymbolicLink();
}


export function getNpmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
