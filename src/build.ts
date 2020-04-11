import * as path from "path";
import { LocalModule } from "./local-module";
import { BuildDependenciesSubset } from "./subsets/build-dependencies-subset";
import { getStateManager } from "./module-state-manager";
import * as utils from "./utils";
import * as fs from "fs-extra";


/**
 * Builds module if any build dependencies have changed since last build.
 * Returns true if module has been built.
 */
export async function buildModuleIfChanged(mod: LocalModule) {
  const stateManager = getStateManager();

  const subset = new BuildDependenciesSubset(mod);
  if (await stateManager.isSubsetChanged(mod, subset.getName(), subset)) {
    await buildModule(mod);
    stateManager.saveState(mod, subset.getName(), await stateManager.getActualState(mod));
    return true;
  }

  return false;
}


async function buildModule(mod: LocalModule): Promise<void> {
  for (let buildCommand of mod.config.buildCommands) {
    if (hasNpmScript(mod, buildCommand)) {
      await utils.runCommand(utils.getNpmExecutable(), [ "run", buildCommand ], {
        cwd: mod.path
      });
    } else {
      await utils.runCommand(buildCommand, null, {
        cwd: mod.path
      });
    }
  }
}


function hasNpmScript(mod: LocalModule, scriptName: string): boolean {
  let packageJSON: any;
  try {
    packageJSON = fs.readJsonSync(path.join(mod.path, "package.json"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return false;
  }

  return Object.keys(packageJSON.scripts || {}).indexOf(scriptName) >= 0;
}
