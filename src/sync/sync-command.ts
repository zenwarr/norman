import * as chalk from "chalk";
import { getProject } from "../project";
import { NpmRegistry } from "../registry";
import { shutdown } from "../shutdown";
import { publishModuleIfChanged } from "./publish";
import { updateModuleInDependants } from "./update-deps";
import { installModuleDepsIfNotInitialized } from "../deps/deps";


export async function syncCommand() {
  let project = getProject();

  await NpmRegistry.init();

  let dir = process.cwd();
  let mod = project.modules.find(m => m.path === dir);
  if (!mod) {
    console.error(chalk.red("No local module found inside current working directory"));
    shutdown(-1);
  }

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
