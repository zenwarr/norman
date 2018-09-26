import * as path from "path";
import * as fs from "fs-extra";
import * as utils from "./utils";
import chalk from "chalk";
import { ModuleBase } from "./base";
import { ModuleInfo } from "./module-info";


export class ModuleSynchronizer extends ModuleBase {
  /**
   * - Enumerate local dependencies of the module
   * - For each dependency, do the following:
   * -   Build the module if `--build-deps` is true and the module has changed since the previous build.
   * -   If the module is listed in `package.json`, but not installed, remember to run `npm install` in the end and go to the next module.
   * -   If the module is installed, check if it is actual:
   * -     Compare dependencies of the installed module with dependencies of the actual module.
   * -       If dependencies match, just copy source files to installed module and proceed to the next module.
   * -       If dependencies do not match, remove the installed module and remember to run `npm install`.
   */
  public async sync(rebuildDeps: boolean): Promise<void> {
    let localDependencies = this.module.getLocalDependencies(true);

    if (rebuildDeps) {
      await this.config.walkDependencyTree(localDependencies, async module => {
        await module.buildModuleIfChanged();
      });
    }

    let runInstall = false;

    await this.config.walkDependencyTree(localDependencies, async module => {
      // check if module is installed into this module node_modules
      // todo: the module can be installed into nested directory
      let installedPath = path.join(this.module.path, "node_modules", module.name);
      if (!fs.existsSync(installedPath)) {
        console.log(`Reinstalling dependencies because module ${module.name} is not installed`);
        runInstall = true;
        return;
      }

      // get deps of the installed modules
      let installedSubDeps = utils.getPackageDeps(installedPath, true).sort();
      let actualSubDeps = utils.getPackageDeps(module.path, true).sort();

      let depsEqual = installedSubDeps.length === actualSubDeps.length && installedSubDeps.every((dep, q) => dep === actualSubDeps[q]);
      if (depsEqual) {
        await (new ModuleSynchronizer(this.norman, module)).quickSyncTo(this.module);
      } else {
        console.log(`Reinstalling dependencies because module ${module.name} dependencies have changed`);
        fs.removeSync(installedPath);
        runInstall = true;
      }
    });

    if (runInstall) {
      await this.norman.localNpmServer.installModuleDeps(this.module);
    }
  }


  protected async quickSyncTo(syncToModule: ModuleInfo): Promise<void> {
    let syncTarget = path.join(syncToModule.path, "node_modules", this.module.name);

    let filesCopied = 0;

    await this.module.walkModuleFiles(async(filename: string, stat: fs.Stats) => {
      if (!this.module.isFileShouldBePublished(filename)) {
        return;
      }

      let target = path.join(syncTarget, path.relative(this.module.path, filename));

      if (!stat.isDirectory()) {
        let doCopy = false;

        let targetStat: fs.Stats | null = null;
        try {
          targetStat = fs.statSync(target);
          doCopy = stat.mtime.valueOf() > targetStat.mtime.valueOf();
        } catch (error) {
          doCopy = error.code === "ENOENT";
          if (error.code !== "ENOENT") {
            console.log(chalk.red(`Error while copying to ${target}: ${error.message}`));
          }
        }

        if (doCopy) {
          let parentDestDir = path.dirname(target);
          if (!fs.existsSync(parentDestDir)) {
            fs.mkdirpSync(parentDestDir);
          }

          utils.getRidOfIt(target);

          await this.module.copyFile(filename, target);

          ++filesCopied;
        }
      } else {
        let doCreate = false;

        let targetStat: fs.Stats | null = null;

        try {
          targetStat = fs.lstatSync(target);
        } catch (error) {
          // assume it does not exists
          doCreate = true;
        }

        if (targetStat) {
          if (targetStat.isDirectory()) {
            // skip
          } else {
            fs.unlinkSync(target);
            doCreate = true;
          }
        }

        if (doCreate) {
          fs.mkdirpSync(target);

          ++filesCopied;
        }
      }
    });

    let filesRemoved = await this.quickSyncRemove(syncTarget);

    if (filesCopied || filesRemoved) {
      let source = chalk.green(this.module.name);
      let target = chalk.green(syncToModule.name);
      console.log(`${source} -> ${target}: copied ${filesCopied}, removed ${filesRemoved}`);
    }
  }


  protected async quickSyncRemove(syncTarget: string): Promise<number> {
    let filesToRemove: [string, fs.Stats][] = [];

    await utils.walkDirectoryFiles(syncTarget, async(filename, stat) => {
      let relpath = path.relative(syncTarget, filename);

      let sourceFilename = path.join(this.module.path, relpath);
      if (!fs.existsSync(sourceFilename) || !this.module.isFileShouldBePublished(sourceFilename)) {
        filesToRemove.push([filename, stat]);
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
        console.log(`Failed to remove "${item[0]}]: ${error.message}`);
      }
    });

    return filesToRemove.length;
  }
}
