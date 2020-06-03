import * as utils from "./utils";
import { getNpmRc } from "./npmrc";
import { getRegistry } from "./registry";
import { LocalModule } from "./local-module";


export namespace NpmRunner {
  export async function install(mod: LocalModule): Promise<void> {
    await run(mod, "install");
  }


  export function buildNpmEnv(): NodeJS.ProcessEnv {
    const registry = getRegistry();

    let result = { ...process.env };

    for (let key of getNpmRc().getCustomRegistries()) {
      if (key !== "default") {
        result[`npm_config_${ key }:registry`] = registry.address;
      }
    }

    result.npm_config_registry = registry.address;

    return result;
  }


  export async function run(module: LocalModule, args: string | string[], options?: utils.SpawnOptions): Promise<string> {
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
