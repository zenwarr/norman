import { NpmRegistry } from "../registry";
import { getArgs } from "../arguments";
import { getProject } from "../project";
import { walkAllLocalModules } from "../deps/dry-dependency-tree";
import { fetchLocalModule } from "../fetch";
import { installModuleDepsIfNotInitialized } from "../deps/deps";
import { publishModuleIfChanged } from "../sync/publish";


export async function fetchCommand() {
  const args = getArgs();

  if (args.subCommand !== "fetch") {
    return;
  }

  await NpmRegistry.init();

  const config = getProject();

  for (let module of config.modules) {
    await fetchLocalModule(module);
  }

  if (!args.noInstall) {
    await walkAllLocalModules(async mod => {
      await installModuleDepsIfNotInitialized(mod);
      await publishModuleIfChanged(mod);
    });
  }
}
