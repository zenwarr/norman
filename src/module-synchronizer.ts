import * as path from "path";
import * as fs from "fs-extra";
import * as utils from "./utils";
import * as chalk from "chalk";
import { ModuleOperator } from "./base";
import { ModuleInfo } from "./module-info";
import { walkDependencyTree, WalkerAction } from "./dependency-tree";
import { Lockfile } from "./lockfile";
import { ModuleNpmRunner } from "./module-npm-runner";


export class ModuleSynchronizer extends ModuleOperator {
  /**
   * - Synchronizes dependencies or the current module.
   * - For each dependency, do the following:
   * -   Build the module if `--build-deps` is true and the module has changed since the previous build.
   * -   If the module is listed in `package.json` of the current module, but not installed, remember to run `npm install` in the end and go to the next module.
   * -   If the module is installed, check if it is actual:
   * -     Compare dependencies of the installed module with dependencies of the actual module.
   * -     Dependencies are considered matched if no dependencies were removed, added or upgraded.
   * -       If dependencies match, just copy source files to installed module (quick sync).
   * -       If dependencies do not match, remove the installed module from `node_modules` of the current module and run `npm install`.
   */
  public async sync(rebuildDeps: boolean): Promise<void> {
    let localDependencies = this.module.getLocalDependencies(true);

    if (rebuildDeps) {
      await walkDependencyTree(localDependencies, async module => {
        await module.buildModuleIfChanged();
      });
    }

    let runInstall = false;

    if (!fs.existsSync(path.join(this.module.path, "node_modules"))) {
      runInstall = true;
    } else {
      await walkDependencyTree(localDependencies, async module => {
        let installedDepPath = path.join(this.module.path, "node_modules", module.name);

        // check if the dependency is installed into node_modules of the current module
        if (!fs.existsSync(installedDepPath)) {
          console.log(`Reinstalling dependencies because module "${ module.name }" is not installed`);
          runInstall = true;
          return WalkerAction.Stop;
        }

        // get deps of the installed local module
        let installedSubDeps = utils.getPackageDeps(installedDepPath, true).sort();
        let actualSubDeps = utils.getPackageDeps(module.path, true).sort();

        let depsEqual = installedSubDeps.length === actualSubDeps.length && installedSubDeps.every((dep, q) => dep === actualSubDeps[q]);
        if (depsEqual) {
          await (new ModuleSynchronizer(module)).quickSyncTo(this.module);
        } else {
          console.log(`Reinstalling dependencies because dependencies of module "${ module.name }" have changed`);
          fs.removeSync(installedDepPath);
          runInstall = true;
          return WalkerAction.Stop;
        }

        return WalkerAction.Continue;
      });

      if (!runInstall) {
        let firstMissing = utils.getFirstMissingDependency(this.module.path);
        if (firstMissing != null) {
          console.log(`Reinstalling dependencies because module "${ firstMissing }" is not installed`);
          runInstall = true;
        }
      }
    }

    if (runInstall) {
      if (this.module.hasLockFile()) {
        const lockfile = Lockfile.forModule(this.module);
        lockfile.updateIntegrity();
      }

      const runner = new ModuleNpmRunner(this.module);
      await runner.install();
    }
  }


  /**
   * Performs quick synchronization (without using npm) of files in this module inside `syncToModule` module.
   */
  protected async quickSyncTo(syncToModule: ModuleInfo): Promise<void> {
    let syncTarget = path.join(syncToModule.path, "node_modules", this.module.name);
    if (utils.isSymlink(syncTarget)) {
      console.log(chalk.yellow(`Skipping sync into "${ syncTarget }" because it is a linked dependency`));
      return;
    }

    let filesCopied = await this.quickSyncCopy(syncTarget);
    let filesRemoved = await this.quickSyncRemove(syncTarget);

    if (filesCopied || filesRemoved) {
      let source = chalk.green(this.module.name);
      let target = chalk.green(syncToModule.name);
      console.log(`${ source } -> ${ target }: copied ${ filesCopied }, removed ${ filesRemoved }`);
    }
  }


  /**
   * Finds files that should be copied from source directory to target
   */
  private async quickSyncCopy(syncTarget: string): Promise<number> {
    let filesCopied = 0;

    await this.module.walkModuleFiles(async(filename: string, stat: fs.Stats) => {
      if (!this.module.isFileShouldBePublished(filename)) {
        return;
      }

      let target = path.join(syncTarget, path.relative(this.module.path, filename));

      let isCopied: boolean;
      if (!stat.isDirectory()) {
        isCopied = await this.quickSyncFile(filename, stat, target);
      } else {
        isCopied = await this.quickSyncDirectory(filename, target);
      }

      if (isCopied) {
        ++filesCopied;
      }
    });

    return filesCopied;
  }


  private async quickSyncFile(source: string, sourceStat: fs.Stats, target: string): Promise<boolean> {
    try {
      const targetStat = fs.statSync(target);

      // do not copy the file if existing target file has newer or the same modification time
      if (sourceStat.mtime.valueOf() <= targetStat.mtime.valueOf()) {
        return false;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.log(chalk.red(`Error while copying to ${ target }: ${ error.message }`));
        return false;
      }
    }

    let parentDestDir = path.dirname(target);
    if (!fs.existsSync(parentDestDir)) {
      fs.mkdirpSync(parentDestDir);
    }

    let isTargetExecutable = utils.hasExecPermission(target);

    utils.getRidOfIt(target);
    await this.module.copyFile(source, target, isTargetExecutable);

    return true;
  }


  private async quickSyncDirectory(source: string, target: string): Promise<boolean> {
    let targetStat: fs.Stats | null = null;

    try {
      targetStat = fs.lstatSync(target);
    } catch (error) {
      // assume it does not exists, keep silent about errors and try to create the directory
    }

    if (targetStat) {
      if (targetStat.isDirectory()) {
        // nothing to do, this is already a directory
        return false;
      } else {
        // this is a file, but we need a directory
        fs.unlinkSync(target);
      }
    }

    fs.mkdirpSync(target);
    return true;
  }


  private async quickSyncRemove(syncTarget: string): Promise<number> {
    let filesToRemove: [ string, fs.Stats ][] = [];

    await utils.walkDirectoryFiles(syncTarget, async(filename, stat) => {
      let relpath = path.relative(syncTarget, filename);

      let sourceFilename = path.join(this.module.path, relpath);
      if (!fs.existsSync(sourceFilename) || !this.module.isFileShouldBePublished(sourceFilename)) {
        filesToRemove.push([ filename, stat ]);
      }
    });

    filesToRemove.forEach(item => {
      try {
        if (item[1].isDirectory()) {
          fs.removeSync(item[0]);
        } else {
          fs.unlinkSync(item[0]);
        }
      } catch (error) {
        console.log(`Failed to remove "${ item[0] }]: ${ error.message }`);
      }
    });

    return filesToRemove.length;
  }
}
