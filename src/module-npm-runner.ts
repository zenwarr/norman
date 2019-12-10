import { ModuleOperator } from "./base";
import * as utils from "./utils";
import { Lockfile } from "./lockfile";
import { getNpmRc } from "./npmrc";
import { getServer } from "./server";


export class ModuleNpmRunner extends ModuleOperator {
  public async install(): Promise<void> {
    await utils.cleanNpmCache();

    await this.run("install");

    if (this.module.hasLockFile()) {
      const lockfile = Lockfile.forModule(this.module);
      lockfile.updateResolveUrl();
    }

    await this.run("prune");

    await utils.cleanNpmCache();
  }


  public buildNpmEnv(): NodeJS.ProcessEnv {
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


  protected async run(args: string | string[], options?: utils.SpawnOptions): Promise<string> {
    if (typeof args === "string") {
      args = [ args ];
    }

    return utils.runCommand(utils.getNpmExecutable(), args, {
      cwd: this.module.path,
      env: this.buildNpmEnv(),
      ...options
    });
  }
}
