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
    // do we actually need to fetch it again?
    if (fs.existsSync(module.path)) {
      console.log(`Skip fetching ${module.name}, directory ${this.config.modulesDirectory} already exists`);
      return;
    }

    await utils.runCommand("git", [ "clone", module.repository, "-b", module.branch, module.path ]);

    if (module.npmInstall) {
      await utils.runCommand("npm", [ "install" ], {
        cwd: module.path
      });

      for (let buildCommand of module.buildCommands) {
        await utils.runCommand("npm", [ "run", buildCommand ], {
          cwd: module.path
        });
      }
    }
  }

  async relinkModule(module: ModuleInfo) {
    if (!module.npmInstall) {
      // we did not installed node_modules, so no need to relink it
      return;
    }

    let modulePath = path.join(module.path, "node_modules");
    for (let depModule of this.config.modules) {
      let installedPath = path.join(modulePath, depModule.npmName.name);
      try {
        fs.statSync(installedPath);
        console.log(chalk.green(`relinking module ${module.path} → ${installedPath}`));
        fs.removeSync(installedPath);
        fs.symlinkSync(module.path, installedPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}
