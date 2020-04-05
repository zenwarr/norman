import * as chalk from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { getArgs } from "../arguments";
import { getProject } from "../project";
import { getStateManager } from "../module-state-manager";
import { LocalModule } from "../local-module";
import { PublishDependenciesSubset } from "../subsets/publish-dependencies-subset";
import { NpmRunner } from "../module-npm-runner";
import * as prompts from "prompts";
import { walkModuleDependants } from "../dry-dependency-tree";
import { Lockfile } from "../lockfile";
import { needsPublish } from "./fetch";
import { getRegistry, NpmRegistry } from "../registry";


export interface NpmViewInfo {
  isCurrentVersionPublished: boolean;

  /**
   * true if at least one version of this package is published on registry
   */
  isOnRegistry: boolean;
  currentVersion: string;
}


export async function arePublishDepsChanged(mod: LocalModule) {
  let stateManager = getStateManager();
  let subset = new PublishDependenciesSubset(mod);
  return stateManager.isSubsetChanged(mod, subset.getName(), subset);
}


async function getNpmViewResult(mod: LocalModule) {
  const output = await NpmRunner.run(mod, [ "view", "--json" ], {
    silent: true,
    collectOutput: true,
    ignoreExitCode: true
  });

  return JSON.parse(output);
}


export async function getNpmViewInfo(mod: LocalModule): Promise<NpmViewInfo> {
  let currentVersion = fs.readJSONSync(path.join(mod.path, "package.json")).version;

  let packageInfo = await getNpmViewResult(mod);
  if (packageInfo.error != null) {
    if (packageInfo.error.code === "E404") {
      return {
        isCurrentVersionPublished: false,
        isOnRegistry: false,
        currentVersion
      };
    } else {
      throw new Error("Failed to get package information: " + packageInfo.error.summary);
    }
  }

  let versions = packageInfo.versions;
  if (!versions || !Array.isArray(versions)) {
    throw new Error("No versions found");
  }

  return {
    isCurrentVersionPublished: versions.includes(currentVersion),
    isOnRegistry: true,
    currentVersion
  };
}


export async function publishModule(mod: LocalModule, info: NpmViewInfo): Promise<string> {
  let publishedVersion: string | undefined;

  if (info.isCurrentVersionPublished) {
    let response = await prompts({
      type: "text",
      name: "version",
      message: `Version ${ info.currentVersion } of module "${ mod.checkedName.name }" is already published on npm registry. Please set another version: `
    });

    let newVersion: string | undefined = response.version;
    if (!newVersion) {
      process.exit(-1);
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


async function isModuleShouldBeInstalledInto(parent: LocalModule, child: LocalModule) {
  const output = await NpmRunner.run(parent, [ "ls", child.checkedName.name, "--json" ], {
    silent: true,
    ignoreExitCode: true,
    collectOutput: true
  });

  let data = JSON.parse(output);
  if (data.error != null) {
    throw new Error(`Failed to check if module "${ child.checkedName.name }" installed into "${ parent.checkedName.name }": ${ data.error.summary }`);
  }

  return !!(data.dependencies && (data.dependencies)[child.checkedName.name] != null);
}


async function updateDependency(parent: LocalModule, child: LocalModule, childVersion: string) {
  let shouldBeInstalled = await isModuleShouldBeInstalledInto(parent, child);
  if (shouldBeInstalled) {
    await NpmRunner.run(parent, [ "install", `${ child.checkedName.name }@${ childVersion }` ]);

    if (Lockfile.existsInModule(parent)) {
      let lockfile = Lockfile.forModule(parent);
      lockfile.updateResolveUrl();
    }
  }
}


export async function publishIfNeeded(mod: LocalModule) {
  if (await needsPublish(mod)) {
    let info = await getNpmViewInfo(mod);
    let newVersion = await publishModule(mod, info);

    await walkModuleDependants(mod, async dep => {
      await updateDependency(dep, mod, newVersion);
    });
  }
}


export async function syncCommand() {
  let args = getArgs();
  let project = getProject();

  if (args.subCommand !== "sync") {
    return;
  }

  await NpmRegistry.init();

  try {
    let dir = process.cwd();
    let mod = project.modules.find(m => m.path === dir);
    if (!mod) {
      console.error(chalk.red("No local module found inside current working directory"));
      process.exit(-1);
    }

    if (!mod.useNpm) {
      console.log(chalk.red(`Cannot sync module: local module ${ mod.name } is not managed by npm`));
      process.exit(-1);
      return;
    }

    await publishIfNeeded(mod);
  } finally {
    getRegistry().stop();
  }
}
