import { getRegistry, NpmRegistry } from "../registry";
import { getArgs } from "../arguments";
import { getProject } from "../project";
import { walkAllLocalModules } from "../dry-dependency-tree";
import { fetchLocalModule } from "../fetch";
import { installModuleDepsIfNotInitialized } from "../deps";
import { LocalModule } from "../local-module";
import { buildModuleIfChanged } from "../build";
import * as prompts from "prompts";
import { arePublishDepsChanged, getNpmViewInfo, NpmViewInfo, publishIfNeeded } from "./sync";


export async function needsPublish(mod: LocalModule) {
  let wasBuilt = await buildModuleIfChanged(mod);

  let publishDepsChanged = wasBuilt;
  if (!wasBuilt) {
    publishDepsChanged = await arePublishDepsChanged(mod);
  }

  let result = wasBuilt || publishDepsChanged;

  let info: NpmViewInfo | undefined;
  if (!result) {
    info = await getNpmViewInfo(mod);
    if (!info.isCurrentVersionPublished) {
      const answer = await prompts({
        type: "confirm",
        name: "shouldPublish",
        message: `Current version of module "${ mod.checkedName.name }" is not yet published on npm registry. Publish now?`,
        initial: true
      });

      if (answer.shouldPublish !== true) {
        process.exit(-1);
      }

      result = true;
    }
  }

  return result;
}


export async function fetchCommand() {
  const args = getArgs();

  if (args.subCommand !== "fetch") {
    return;
  }

  await NpmRegistry.init();

  try {
    const config = getProject();

    for (let module of config.modules) {
      await fetchLocalModule(module);
    }

    if (!args.noInstall) {
      await walkAllLocalModules(async mod => {
        await installModuleDepsIfNotInitialized(mod);
        await publishIfNeeded(mod);
      });
    }
  } finally {
    getRegistry().stop();
  }
}
