import * as utils from "./utils";
import { Lockfile } from "./lockfile";
import { getNpmRc } from "./npmrc";
import { getServer } from "./server";
import { ModuleInfo } from "./module-info";


export namespace NpmRunner {
  export async function install(module: ModuleInfo): Promise<void> {
    await utils.cleanNpmCache();

    let lockfile: Lockfile | undefined;
    if (module.hasLockFile()) {
      lockfile = Lockfile.forModule(module);
      lockfile.updateIntegrity();
    }

    await run(module, "install");

    if (lockfile) {
      lockfile.updateResolveUrl();
    }

    await run(module, "prune");

    await utils.cleanNpmCache();
  }


  export function buildNpmEnv(): NodeJS.ProcessEnv {
    const server = getServer();

    let result = process.env;

    for (let key of getNpmRc().getCustomRegistries()) {
      if (key !== "default") {
        result[`npm_config_${ key }:registry`] = server.address;
      }
    }

    result.npm_config_registry = server.address;

    return result;
  }


  export async function run(module: ModuleInfo, args: string | string[], options?: utils.SpawnOptions): Promise<string> {
    if (typeof args === "string") {
      args = [ args ];
    }

    return utils.runCommand(utils.getNpmExecutable(), args, {
      cwd: module.path,
      env: buildNpmEnv(),
      ...options
    });
  }
}
