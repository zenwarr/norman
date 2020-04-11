import { LocalModule } from "../local-module";
import { getStateManager } from "../module-state-manager";
import { PublishDependenciesSubset } from "../subsets/publish-dependencies-subset";
import { buildModuleIfChanged } from "../build";
import { getNpmViewInfo, NpmViewInfo } from "./npm-view";
import * as prompts from "prompts";
import { shutdown } from "../shutdown";
import { NpmRunner } from "../module-npm-runner";
import * as path from "path";
import * as fs from "fs-extra";


async function arePublishDepsChanged(mod: LocalModule) {
  let stateManager = getStateManager();
  let subset = new PublishDependenciesSubset(mod);
  return stateManager.isSubsetChanged(mod, subset.getName(), subset);
}


async function needsPublish(mod: LocalModule) {
  if (!mod.useNpm) {
    return false;
  }

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
        message: `Current version of module "${ mod.checkedName.name }" (${ info.currentVersion }) is not yet published on npm registry. Publish now?`,
        initial: true
      });

      if (answer.shouldPublish !== true) {
        shutdown(-1);
      }

      result = true;
    }
  }

  return result;
}

async function publishModule(mod: LocalModule, info: NpmViewInfo): Promise<string> {
  let publishedVersion: string | undefined;

  if (info.isCurrentVersionPublished) {
    let response = await prompts({
      type: "text",
      name: "version",
      message: `Version ${ info.currentVersion } of module "${ mod.checkedName.name }" is already published on npm registry. Please set another version: `
    });

    let newVersion: string | undefined = response.version;
    if (!newVersion) {
      shutdown(-1);
    }

    console.log("Setting package version...");
    await NpmRunner.run(mod, [ "version", newVersion, "--no-git-tag-version" ]);
    publishedVersion = newVersion;
  } else if (!info.isOnRegistry) {
    publishedVersion = info.currentVersion;
    console.log(`Module "${ mod.checkedName.name }" is not yet published on npm registry.`);
  } else {
    publishedVersion = info.currentVersion;
    console.log(`Version ${ info.currentVersion } of module "${ mod.checkedName.name }" is not yet published on npm registry`);
  }

  let ignoreCopied = false;
  let outsideIgnore = mod.outsideIgnoreFilePath;
  let insideIgnore = path.join(mod.path, ".npmignore");
  if (outsideIgnore) {
    fs.copyFileSync(outsideIgnore, insideIgnore);
    ignoreCopied = true;
  }

  try {
    await NpmRunner.run(mod, [ "publish" ]);
  } finally {
    if (ignoreCopied) {
      fs.unlinkSync(insideIgnore);
    }
  }

  let stateManager = getStateManager();
  let subset = new PublishDependenciesSubset(mod);
  stateManager.saveState(mod, subset.getName(), await stateManager.getActualState(mod));

  return publishedVersion;
}


/**
 * Publishes module if any publish dependencies are changed since last publish.
 * Returns updated version of this module if module was published.
 * Returns undefined if module was not published.
 */
export async function publishModuleIfChanged(mod: LocalModule) {
  if (await needsPublish(mod)) {
    let info = await getNpmViewInfo(mod);
    return publishModule(mod, info);
  }

  return undefined;
}
