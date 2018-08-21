import {ModuleInfo} from "./config";
import * as utils from "./utils";
import * as path from "path";
import * as fs from "fs-extra";
import chalk from "chalk";
import {Norman} from "./norman";
import {ModuleInfoWithDeps} from "./server";


export default class ModuleFetcher {
  constructor(protected norman: Norman) {

  }


  get config() {
    return this.norman.config;
  }


  async start() {
    for (let module of this.config.modules) {
      try {
        await this.fetchModule(module);
      } catch (error) {
        console.error(`Failed to fetch module: ${error.message}`);
      }
    }

    // await this.norman.localNpmServer.setupLiveDeps();

    await this.installModules();
  }


  async fetchModule(module: ModuleInfo) {
    // do we actually need to fetch it again?
    if (!module.repository || fs.existsSync(module.path)) {
      return;
    }

    module.fetchDone = true;

    await utils.runCommand("git", [ "clone", module.repository, "-b", module.branch, module.path ]);
  }


  async installModules() {
    await this.norman.localNpmServer.walkDependencyTree(this.config.modules, async module => {
      if (fs.existsSync(path.join(module.path, "node_modules"))) {
        return;
      }

      await this.norman.localNpmServer.installModuleDeps(module);
    });
  }
}
