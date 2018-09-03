import {ModuleInfo} from "./config";
import * as utils from "./utils";
import * as path from "path";
import * as fs from "fs-extra";
import {Norman} from "./norman";
import {ModuleStateManager} from "./module-state-manager";


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

    // await this.installModules();

    // await this.buildModules();
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
    await this.norman.walkDependencyTree(this.config.modules, async module => {
      if (fs.existsSync(path.join(module.path, "node_modules"))) {
        return;
      }

      await this.norman.localNpmServer.installModuleDeps(module);

      let stateManager = new ModuleStateManager(this.norman, module);

      for (let buildCommand of module.buildCommands) {
        await utils.runCommand("npm", [ "run", buildCommand ], {
          cwd: module.path
        });
      }

      await stateManager.saveActualState();
    });
  }


  async buildModuleIfChanged(module: ModuleInfo): Promise<void> {
    let stateManager = new ModuleStateManager(this.norman, module);
    if (await stateManager.isModuleChanged()) {
      for (let buildCommand of module.buildCommands) {
        await utils.runCommand("npm", [ "run", buildCommand ], {
          cwd: module.path
        });
      }

      await stateManager.saveActualState();
    }
  }
}
