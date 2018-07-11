import {Config, ModuleInfo} from "./config";
import * as utils from "./utils";
import * as path from "path";
import * as fs from "fs-extra";
import chalk from "chalk";


export default class ModuleFetcher {
  constructor(protected config: Config) {

  }

  async start() {
    for (let module of this.config.modules) {
      try {
        await this.fetchModule(module);
      } catch (error) {
        console.error(`Failed to fetch module: ${error.message}`);
      }
    }

    for (let module of this.config.modules) {
      try {
        await this.relinkModule(module);
      } catch (error) {
        console.error(`Failed to relink module: ${error.message}`);
      }
    }
  }

  async fetchModule(module: ModuleInfo) {
    let modulePath = path.join(this.config.modulesDirectory, module.name);

    // do we actually need to fetch it again?
    if (fs.existsSync(modulePath)) {
      console.log(`Skip fetching ${module.name}, directory ${this.config.modulesDirectory} already exists`);
      return;
    }

    await utils.runCommand("git", [ "clone", module.repository, "-b", module.branch, modulePath ]);

    if (module.npmInstall) {
      await utils.runCommand("npm", [ "install" ], {
        cwd: modulePath
      });

      for (let buildCommand of module.buildCommands) {
        await utils.runCommand("npm", [ "run", buildCommand ], {
          cwd: modulePath
        });
      }
    }
  }

  async relinkModule(module: ModuleInfo) {
    if (!module.npmInstall) {
      // we did not installed node_modules, so no need to relink it
      return;
    }

    let modulePath = path.join(this.config.modulesDirectory, module.name, "node_modules");
    for (let depModule of this.config.modules) {
      let installedPath = path.join(modulePath, depModule.npmName.name);
      try {
        fs.statSync(installedPath);
        let depModulePath = path.join(this.config.modulesDirectory, depModule.name);
        console.log(chalk.green(`relinking module ${depModulePath} → ${installedPath}`));
        fs.removeSync(installedPath);
        fs.symlinkSync(depModulePath, installedPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}
