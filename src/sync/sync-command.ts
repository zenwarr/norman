import * as chalk from "chalk";
import { NpmRegistry } from "../registry";
import { shutdown } from "../shutdown";
import { publishModuleIfChanged } from "./publish";
import { updateModuleInDependants } from "./update-deps";
import { installModuleDepsIfNotInitialized } from "../deps/deps";
import { getCwdModule } from "../cwd-module";


export async function syncCommand() {
  await NpmRegistry.init();

  let mod = getCwdModule();

  if (!mod.useNpm) {
    console.log(chalk.red(`Cannot sync module: local module ${ mod.name } is not managed by npm`));
    shutdown(-1);
  }

  await installModuleDepsIfNotInitialized(mod);

  let publishedVersion = await publishModuleIfChanged(mod);
  if (publishedVersion) {
    await updateModuleInDependants(publishedVersion, mod);
  }
}
