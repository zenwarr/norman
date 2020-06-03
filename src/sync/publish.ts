import { LocalModule } from "../local-module";
import { getStateManager } from "../module-state-manager";
import { PublishDependenciesSubset } from "../subsets/publish-dependencies-subset";
import { buildModuleIfChanged } from "../build";
import { getNpmViewInfo, NpmViewInfo, setPackageVersion } from "./npm-view";
import * as prompts from "prompts";
import { shutdown } from "../shutdown";
import { NpmRunner } from "../module-npm-runner";
import * as path from "path";
import * as fs from "fs-extra";
import { getPackageReader } from "../package-reader";
import { getNpmInfoReader } from "../npm-info-reader";


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
    info = await getNpmInfoReader().getNpmInfo(mod);
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

async function publishModule(mod: LocalModule): Promise<string> {
  let publishedVersion: string | undefined;

  let info = await getNpmInfoReader().getNpmInfo(mod);

  if (info.isCurrentVersionPublished || !info.currentVersion) {
    let message = info.currentVersion
        ? `Version ${ info.currentVersion } of module "${ mod.checkedName.name }" is already published on npm registry. Please set another version: `
        : `Module "${ mod.checkedName.name }" has no version set in package.json. Please set its version: `;

    let response = await prompts({
      type: "text",
      name: "version",
      message
    });

    let newVersion: string | undefined = response.version;
    if (!newVersion) {
      shutdown(-1);
    }

    console.log("Setting package version...");
    await setPackageVersion(mod, newVersion);
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
    getNpmInfoReader().invalidate(mod);

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
export async function publishModuleIfChanged(mod: LocalModule): Promise<string | undefined> {
  if (await needsPublish(mod)) {
    return publishModule(mod);
  }

  return undefined;
}
