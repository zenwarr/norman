import * as fs from "fs-extra";
import * as utils from "./utils";
import { Lockfile } from "./lockfile";
import { getNpmRc } from "./npmrc";
import { getServer } from "./server";
import { LocalModule } from "./local-module";


export namespace NpmRunner {
  export async function install(mod: LocalModule): Promise<void> {
    await run(mod, "install");

    await run(mod, "prune");
  }


  export function buildNpmEnv(mod: LocalModule): NodeJS.ProcessEnv {
    const server = getServer();

    let result = process.env;

    for (let key of getNpmRc().getCustomRegistries()) {
      if (key !== "default") {
        result[`npm_config_${ key }:registry`] = server.address;
      }
    }

    result.npm_config_registry = server.address;

    if (Lockfile.existsInModule(mod)) {
      result["npm_config_package-lock"] = "true";
    }

    return result;
  }


  export async function run(module: LocalModule, args: string | string[], options?: utils.SpawnOptions): Promise<string> {
    if (typeof args === "string") {
      args = [ args ];
    }

    await utils.cleanNpmCache();

    let lockfile: Lockfile | undefined;
    let lockfileModifyTs: number | undefined;
    if (Lockfile.existsInModule(module)) {
      lockfile = Lockfile.forModule(module);
      lockfile.updateIntegrity();
      lockfileModifyTs = fs.statSync(lockfile.filename).mtimeMs;
    }

    let result = await utils.runCommand(utils.getNpmExecutable(), args, {
      cwd: module.path,
      env: buildNpmEnv(module),
      ...options
    });

    if (lockfile) {
      let afterModifyTs = fs.statSync(lockfile.filename).mtimeMs;
      if (afterModifyTs !== lockfileModifyTs) {
        lockfile.updateResolveUrl();
      }
    }

    return result;
  }
}
